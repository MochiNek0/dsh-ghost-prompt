import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  partialFromOutput,
  suggestionFromOutput,
  answerableKey,
  transcriptOf,
  frameTranscript,
  addUsage,
  apply,
  ownTargets,
  chunksOf,
  usageFromOpenAI,
  errorMessage,
  streamChatCompletions,
  SUGGEST_ROUTE,
} from '../dist/index.js'
import { createServer } from 'node:http'

let seq = 0
const user = (text) => ({ type: 'user/message', seq: ++seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const reply = (text) => ({ type: 'assistant/message', seq: ++seq, data: { message: { content: [{ type: 'text', text }] } } })
const toolStep = (name) => ({ type: 'assistant/message', seq: ++seq, data: { message: { content: [{ type: 'tool-call', name }] } } })
const turnStart = () => ({ type: 'turn/start', seq: ++seq, data: {} })
const turnEnd = (kind = 'completed') => ({ type: 'turn/end', seq: ++seq, data: { reason: { kind } } })

test('a closing quote stays unless the whole line was quoted', () => {
  assert.equal(suggestionFromOutput('把标题改成「首页」'), '把标题改成「首页」')
  assert.equal(suggestionFromOutput('run `npm test`'), 'run `npm test`')
  assert.equal(suggestionFromOutput('rename it to "foo"'), 'rename it to "foo"')
  assert.equal(suggestionFromOutput('"yes, go ahead"'), 'yes, go ahead')
  assert.equal(suggestionFromOutput('「好的，继续」'), '好的，继续')
  assert.equal(suggestionFromOutput('User: "commit this"'), 'commit this')
  assert.equal(suggestionFromOutput('用户：跑一下测试'), '跑一下测试')
})

test('NONE and empty output give no suggestion', () => {
  assert.equal(suggestionFromOutput('NONE'), null)
  assert.equal(suggestionFromOutput('none.'), null)
  assert.equal(suggestionFromOutput('   \n'), null)
  assert.equal(suggestionFromOutput('None of these work, try again'), 'None of these work, try again')
})

test('only the first line counts, and long lines are capped', () => {
  assert.equal(suggestionFromOutput('run the tests\nbecause the user wants to'), 'run the tests')
  const long = suggestionFromOutput('x'.repeat(400))
  assert.equal(long.length, 300)
  assert.ok(long.endsWith('…'))
})

test('a partial that could still become NONE shows nothing', () => {
  assert.equal(partialFromOutput('N'), '')
  assert.equal(partialFromOutput('NON'), '')
  assert.equal(partialFromOutput('"ye'), 'ye')
  assert.equal(partialFromOutput('No, keep'), 'No, keep')
})

test('answerableKey finds the final reply of a completed turn', () => {
  const final = reply('Done. Add tests?')
  const events = [turnStart(), user('fix it'), toolStep('edit'), final, turnEnd()]
  assert.equal(answerableKey(events), final.seq)
})

test('answerableKey refuses running, failed and tool-ending turns', () => {
  assert.equal(answerableKey([turnStart(), user('fix it'), reply('working')]), undefined)
  assert.equal(answerableKey([turnStart(), user('fix it'), reply('oops'), turnEnd('error')]), undefined)
  assert.equal(answerableKey([turnStart(), user('fix it'), toolStep('edit'), turnEnd()]), undefined)
  assert.equal(answerableKey([turnStart(), user('a'), reply('b'), turnEnd(), user('next')]), undefined)
  assert.equal(answerableKey([]), undefined)
})

test('transcriptOf merges assistant steps and keeps order', () => {
  const t = transcriptOf([user('fix it'), toolStep('edit'), reply('done'), user('thanks'), reply('np')])
  assert.deepEqual(t, [
    { role: 'user', text: 'fix it' },
    { role: 'assistant', text: '[called tool: edit]\ndone' },
    { role: 'user', text: 'thanks' },
    { role: 'assistant', text: 'np' },
  ])
})

test('transcriptOf with a budget frames exactly like the full transcript', () => {
  const events = []
  for (let i = 0; i < 200; i++) events.push(user(`question ${i} `.repeat(20)), reply(`answer ${i} `.repeat(40)))
  for (const budget of [1000, 3000, 8000, 20000]) {
    const full = frameTranscript(transcriptOf(events), budget)
    const tail = transcriptOf(events, budget)
    assert.ok(tail.length < 400, `budget ${budget} kept ${tail.length} entries`)
    assert.equal(frameTranscript(tail, budget), full)
  }
})

test('transcriptOf keeps looking for a user message past the budget', () => {
  const events = [user('start')]
  for (let i = 0; i < 50; i++) events.push(toolStep('edit'), reply(`step ${i} `.repeat(100)))
  const t = transcriptOf(events, 1000)
  assert.equal(t[0].role, 'user')
})

test('addUsage sums reported calls and counts unreported ones', () => {
  const totals = { calls: 0, reported: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0 }
  addUsage(totals, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900 })
  addUsage(totals, { inputTokens: 50, outputTokens: 5, reasoningTokens: 3, cacheWriteTokens: 20 })
  addUsage(totals, undefined)
  assert.deepEqual(totals, { calls: 3, reported: 2, inputTokens: 150, cacheReadTokens: 900, cacheWriteTokens: 20, outputTokens: 15, reasoningTokens: 3 })
})

const own = (patch) => ({ id: 'modelscope', preset: 'modelscope', name: '', baseURL: '', models: [], extraBody: '', ...patch })
const keys = { modelscope: 'k', siliconflow: 'k', 'custom-a': 'k', 'custom-b': 'k' }

test('ownTargets keeps provider and model order and merges request fields', () => {
  const targets = ownTargets([
    own({ models: ['Qwen/Qwen3.5-35B-A3B', 'nex-agi/Nex-N2.5-mini'] }),
    own({ id: 'siliconflow', preset: 'siliconflow', models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V4-Flash'] }),
    own({ id: 'custom-a', preset: 'custom', baseURL: 'https://x.test/v1/', models: ['m'], extraBody: '{"top_p":0.5}' }),
  ], keys)
  assert.deepEqual(targets.map((t) => `${t.route.provider}/${t.route.model}`), [
    'np:modelscope/Qwen/Qwen3.5-35B-A3B',
    'np:modelscope/nex-agi/Nex-N2.5-mini',
    'np:siliconflow/Qwen/Qwen2.5-7B-Instruct',
    'np:siliconflow/deepseek-ai/DeepSeek-V4-Flash',
    'np:custom-a/m',
  ])
  assert.deepEqual(targets[0].body, { enable_thinking: false })
  assert.deepEqual(targets[2].body, {})
  assert.deepEqual(targets[3].body, { enable_thinking: false })
  assert.equal(targets[4].baseURL, 'https://x.test/v1')
  assert.equal(targets[4].providerName, 'x.test')
  assert.deepEqual(targets[4].body, { top_p: 0.5 })
})

test('ownTargets skips providers without a key, URL or model, and rejects bad JSON', () => {
  assert.deepEqual(ownTargets([own({ id: 'agnes', preset: 'agnes', models: ['m'] })], { agnes: ' ' }), [])
  assert.deepEqual(ownTargets([own({ models: [] }), own({ id: 'custom-a', preset: 'custom', models: ['m'] })], keys), [])
  assert.throws(() => ownTargets([own({ models: ['m'], extraBody: '[1]' })], keys), /JSON object/)
})

test('chunksOf and usageFromOpenAI map OpenAI stream chunks to dsh chunks', () => {
  assert.deepEqual(chunksOf({ choices: [{ delta: { reasoning_content: 'hm', content: 'hi' } }] }), [
    { type: 'reasoning-delta', text: 'hm' },
    { type: 'text-delta', index: 0, text: 'hi' },
  ])
  assert.deepEqual(chunksOf({ choices: [{ delta: {}, finish_reason: 'stop' }] }), [{ type: 'finish', reason: { kind: 'stop' } }])
  assert.deepEqual(usageFromOpenAI({ prompt_tokens: 100, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 60 } }),
    { inputTokens: 40, cacheReadTokens: 60, cacheWriteTokens: 0, outputTokens: 7, reasoningTokens: 0 })
  assert.equal(usageFromOpenAI({ prompt_tokens: 10, prompt_cache_hit_tokens: 4 }).inputTokens, 6)
})

test('errorMessage digs out the provider message', () => {
  assert.equal(errorMessage(429, '{"error":{"message":"quota exceeded"}}'), 'HTTP 429: quota exceeded')
  assert.equal(errorMessage(401, '{"errors":{"message":"bad token"}}'), 'HTTP 401: bad token')
  assert.equal(errorMessage(500, 'oops'), 'HTTP 500: oops')
})

/** A fake OpenAI-compatible endpoint: `handle` answers each request. */
async function fakeEndpoint(t, handle) {
  const requests = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const part of req) raw += part
    requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) })
    handle(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  return { baseURL: `http://127.0.0.1:${server.address().port}/v1`, requests }
}

const sse = (res, lines) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const line of lines) res.write(`data: ${typeof line === 'string' ? line : JSON.stringify(line)}\n\n`)
  res.end()
}

test('streamChatCompletions sends the request and parses the stream', async (t) => {
  const endpoint = await fakeEndpoint(t, (req, res) => sse(res, [
    { choices: [{ delta: { content: 'run ' } }] },
    { choices: [{ delta: { content: 'the tests' }, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } },
    '[DONE]',
  ]))
  const [target] = ownTargets([own({ preset: 'custom', id: 'custom-a', baseURL: endpoint.baseURL, models: ['m'], extraBody: '{"enable_thinking":false}' })], keys)
  const chunks = []
  for await (const chunk of streamChatCompletions(target, 'sys', 'hello', 64, AbortSignal.timeout(5000))) chunks.push(chunk)
  assert.equal(chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), 'run the tests')
  assert.equal(chunks.find((c) => c.type === 'usage').usage.inputTokens, 12)
  const [request] = endpoint.requests
  assert.equal(request.url, '/v1/chat/completions')
  assert.equal(request.auth, 'Bearer k')
  assert.equal(request.body.model, 'm')
  assert.equal(request.body.max_tokens, 64)
  assert.equal(request.body.enable_thinking, false)
  assert.deepEqual(request.body.messages.map((m) => m.role), ['system', 'user'])
})

/** Just enough of a dsh context to drive the suggest route. */
function fakeHost(config, session) {
  const routes = new Map()
  const warnings = []
  const ctx = {
    logger: () => ({ warn: (m) => warnings.push(m), debug() {} }),
    effect: (fn) => fn(),
    on() {},
    inject: (_, fn) => fn(ctx),
    connection: { fetch: { register: (route) => routes.set(route.path, route) } },
    sessions: { get: (id) => (id === session.id ? session : undefined) },
    llm: { prepareCall: () => { throw new Error('dsh models must not be used') } },
  }
  apply(ctx, config)
  const suggest = async () => {
    const response = await routes.get(SUGGEST_ROUTE).fetch(new Request('http://x/', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, generate: true }),
    }))
    return (await response.json()).suggestion
  }
  return { suggest, warnings }
}

const answerable = (id) => {
  const events = [turnStart(), user('fix it'), reply('Done. Add tests?'), turnEnd()]
  return { id, snapshotEvents: () => events, requestHeader: () => ({ config: {} }) }
}

const baseConfig = { enabled: true, source: 'own', ownProvider: '', ownModel: '', apiKeys: keys, provider: '', model: '', maxContextChars: 8000, maxOutputTokens: 64, timeoutMs: 5000, acceptKey: 'arrow' }

test('a failing own model hands over to the next one, and is skipped afterwards', async (t) => {
  const broke = await fakeEndpoint(t, (req, res) => {
    res.writeHead(429, { 'content-type': 'application/json' })
    res.end('{"error":{"message":"quota exceeded"}}')
  })
  const works = await fakeEndpoint(t, (req, res) => sse(res, [{ choices: [{ delta: { content: 'yes, add tests\n' } }] }]))
  const config = {
    ...baseConfig,
    ownProviders: [
      own({ id: 'custom-a', preset: 'custom', baseURL: broke.baseURL, models: ['a'] }),
      own({ id: 'custom-b', preset: 'custom', baseURL: works.baseURL, models: ['b'] }),
    ],
  }
  const session = answerable('s1')
  const host = fakeHost(config, session)
  assert.equal(await host.suggest(), 'yes, add tests')
  assert.match(host.warnings.join('\n'), /quota exceeded/)
  // A newer turn: the failed model is cooling down, so only the working one is called.
  session.snapshotEvents().push(turnStart(), user('ok'), reply('Added. Commit?'), turnEnd())
  assert.equal(await host.suggest(), 'yes, add tests')
  assert.equal(broke.requests.length, 1)
  assert.equal(works.requests.length, 2)
})

test('when every own model fails there is no suggestion and no dsh fallback', async (t) => {
  const broke = await fakeEndpoint(t, (req, res) => {
    res.writeHead(401)
    res.end('bad key')
  })
  const host = fakeHost({ ...baseConfig, ownProviders: [own({ id: 'custom-a', preset: 'custom', baseURL: broke.baseURL, models: ['a'] })] }, answerable('s2'))
  assert.equal(await host.suggest(), null)
  assert.match(host.warnings.join('\n'), /every own model failed/)
})

test('with source dsh, configured own models are never called', async (t) => {
  const endpoint = await fakeEndpoint(t, (req, res) => sse(res, [{ choices: [{ delta: { content: 'nope\n' } }] }]))
  const host = fakeHost({ ...baseConfig, source: 'dsh', ownProviders: [own({ id: 'custom-a', preset: 'custom', baseURL: endpoint.baseURL, models: ['a'] })] }, answerable('s3'))
  assert.equal(await host.suggest(), null)
  assert.equal(endpoint.requests.length, 0)
})

test('a picked own model is the only one called, and retried right after a failure', async (t) => {
  const first = await fakeEndpoint(t, (req, res) => sse(res, [{ choices: [{ delta: { content: 'from a\n' } }] }]))
  let fail = true
  const picked = await fakeEndpoint(t, (req, res) => {
    if (fail) {
      res.writeHead(500)
      return res.end('down')
    }
    sse(res, [{ choices: [{ delta: { content: 'from b\n' } }] }])
  })
  const session = answerable('s4')
  const host = fakeHost({
    ...baseConfig,
    ownProvider: 'custom-b',
    ownModel: 'b',
    ownProviders: [
      own({ id: 'custom-a', preset: 'custom', baseURL: first.baseURL, models: ['a'] }),
      own({ id: 'custom-b', preset: 'custom', baseURL: picked.baseURL, models: ['b'] }),
    ],
  }, session)
  assert.equal(await host.suggest(), null)
  fail = false
  session.snapshotEvents().push(turnStart(), user('ok'), reply('Added. Commit?'), turnEnd())
  assert.equal(await host.suggest(), 'from b')
  assert.equal(first.requests.length, 0)
  assert.equal(picked.requests.length, 2)
})
