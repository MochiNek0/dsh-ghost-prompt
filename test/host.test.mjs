import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  partialFromOutput,
  suggestionFromOutput,
  answerableKey,
  transcriptOf,
  frameTranscript,
  addUsage,
} from '../dist/index.js'

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
