import Schema from '@deepseek-ai/schemastery'
import { createRequire } from 'node:module'

/**
 * Host half of dsh-ghost-prompt.
 *
 * Latency is the whole game here, so a prediction starts the moment the
 * turn's final assistant message is logged (one with no tool calls) — before
 * `turn/end`, and without waiting for the browser to notice the turn ended.
 * That early start only runs for sessions a browser asked about recently
 * ({@link WATCH_MS}): a headless run, a scheduled job or a goal round has
 * nobody to read the suggestion and would only burn tokens.
 *
 * The browser half reads {@link SUGGEST_ROUTE} as an NDJSON stream, so the
 * ghost text grows token by token, and the model call is cut off as soon as
 * its first line is complete.
 */
export const name = 'next-prompt'
export const inject = ['llm', 'sessions']

const PLUGIN_VERSION: string = (() => {
  try {
    return createRequire(import.meta.url)('../package.json').version
  } catch {
    return '0.0.0'
  }
})()

export const SUGGEST_ROUTE = '/api/next-prompt/suggest'
export const MODELS_ROUTE = '/api/next-prompt/models'
export const BENCH_ROUTE = '/api/next-prompt/bench'

/**
 * A fixed, typical turn for the speed test: a finished task plus an offer.
 * One per UI language, so the sample prediction reads in the user's language.
 */
const BENCH_TRANSCRIPTS: Record<'zh' | 'en', Transcript[]> = {
  zh: [
    { role: 'user', text: '帮我给 utils/date.ts 里的 formatRelative 函数加上中文本地化支持' },
    { role: 'assistant', text: '[called tool: read_file]\n[called tool: str_replace_editor]\n已经给 formatRelative 加上了 locale 参数，默认 zh-CN，会输出「3 分钟前」「昨天」这样的文本；英文仍然可用。要我顺便补上单元测试吗？' },
  ],
  en: [
    { role: 'user', text: 'Add Chinese localization to the formatRelative function in utils/date.ts' },
    { role: 'assistant', text: '[called tool: read_file]\n[called tool: str_replace_editor]\nformatRelative now takes a locale parameter (default zh-CN) and outputs text like "3 分钟前" and "昨天"; English still works. Want me to add unit tests too?' },
  ],
}

/** How long a browser's interest in a session keeps early starts on for it. */
const WATCH_MS = 30 * 60_000

/** Every field, unmarked. Defaults here are what a fresh install runs with. */
const configFields = () => ({
  enabled: Schema.boolean().default(true),
  provider: Schema.string().default(''),
  model: Schema.string().default(''),
  maxContextChars: Schema.natural().min(1000).max(100000).default(8000),
  maxOutputTokens: Schema.natural().min(16).max(4096).default(512),
  timeoutMs: Schema.natural().min(1000).max(120000).default(30000),
})

/** Field descriptions keyed by dsh locale id; English is the required fallback. */
const configDescriptions: Record<'en' | 'zh', Record<keyof ReturnType<typeof configFields>, string>> = {
  en: {
    enabled: 'After each turn, predict what you will type next and show it as grey text in the composer; press → to accept.',
    provider: 'Model provider for predictions. Leave empty to follow the model the session is using.',
    model: 'Model id for predictions; set together with provider. Leave empty to follow the session.',
    maxContextChars: 'Most recent conversation sent to the prediction model, in characters, cut from the newest message back. Smaller is faster.',
    maxOutputTokens: 'Output token limit for a prediction call (a reasoning model\'s thinking counts too).',
    timeoutMs: 'Timeout of one prediction, in milliseconds.',
  },
  zh: {
    enabled: '每轮对话结束后预测你接下来想输入的内容，显示为输入框里的灰色提示，按 → 接受。',
    provider: '预测用的模型提供方。留空则跟随当前会话正在使用的模型。',
    model: '预测用的模型 id，需与 provider 一起设置。留空则跟随当前会话。',
    maxContextChars: '送给预测模型的最近对话上限（字符数），从最新消息往前截取。越小越快。',
    maxOutputTokens: '预测调用的输出 token 上限（推理模型的思考也计入）。',
    timeoutMs: '单次预测的超时（毫秒）。',
  },
}

/**
 * The entry's Config, every field live-editable: on dsh >= 0.1.7 the settings
 * form writes through and each read below sees the new value without a restart.
 */
export const Config = Schema.object(
  (() => {
    const marked: Record<string, any> = {}
    for (const [key, schema] of Object.entries(configFields())) {
      marked[key] = (schema as any).volatile()
    }
    return marked
  })(),
).i18n(configDescriptions)

export interface Config {
  enabled: boolean
  provider: string
  model: string
  maxContextChars: number
  maxOutputTokens: number
  timeoutMs: number
}

type Live<T> = T | { get(): T }
type RawConfig = { [K in keyof Config]: Live<Config[K]> }

function readLive<T>(value: Live<T>): T {
  return value !== null &&
    typeof value === 'object' &&
    typeof (value as { get?: unknown }).get === 'function'
    ? (value as { get(): T }).get()
    : (value as T)
}

/** Flatten the entry config to plain values, read fresh at each call. */
function liveConfig(raw: RawConfig): Config {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw ?? {})) out[key] = readLive(value)
  return out as unknown as Config
}

const SYSTEM_PROMPT = [
  'You predict the next message the USER will type to an AI coding assistant.',
  'You are given the recent conversation. Write the single message the user is most likely to send next, exactly as they would type it.',
  'Rules:',
  '- Write from the user\'s point of view, addressed to the assistant (e.g. "run the tests", "commit this", "yes, go ahead").',
  '- Match the language and tone the user has been writing in. If the user writes Chinese, answer in Chinese.',
  '- Keep it short: one sentence, at most about 20 words or 40 CJK characters.',
  '- Prefer the obvious next step: answering a question the assistant just asked, approving a proposed plan, verifying or continuing the work.',
  '- Never repeat a request the user already made, and never invent facts, file names or numbers not in the conversation.',
  '- If no next message is reasonably predictable, output exactly: NONE',
  'Output only the message text on one line. No quotes, no prefix like "User:", no explanation, no Markdown.',
].join('\n')

/** Reasoning levels that skip or minimise thinking, cheapest first. */
const FAST_EFFORTS = ['off', 'none', 'disabled', 'minimal', 'low']

type SessionEvent = { type: string; seq: number; data: any }

type Transcript = { role: 'user' | 'assistant'; text: string }

const PER_MESSAGE_CHARS = 2400

/** Keep the head and the tail of an oversized message; the middle matters least. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const half = Math.floor((max - 5) / 2)
  return `${text.slice(0, half)}\n…\n${text.slice(-half)}`
}

/** Text of one user-authored `user/message`; other sources (context, steering echoes) are skipped. */
function userText(event: SessionEvent): string | undefined {
  if (event.data?.source?.kind !== 'user') return undefined
  const text = (event.data.content ?? [])
    .filter((block: any) => block?.type === 'text')
    .map((block: any) => String(block.text ?? ''))
    .join('\n')
    .trim()
  return text || undefined
}

/** Visible text of one `assistant/message`, with tool calls reduced to their names. */
function assistantText(event: SessionEvent): string | undefined {
  const parts: string[] = []
  for (const block of event.data?.message?.content ?? []) {
    if (block?.type === 'text' && String(block.text ?? '').trim()) parts.push(String(block.text).trim())
    else if (block?.type === 'tool-call' && block.name) parts.push(`[called tool: ${block.name}]`)
  }
  return parts.length ? parts.join('\n') : undefined
}

/** Whether an `assistant/message` is the reply that closes its turn: complete, no tool calls. */
function isFinalReply(event: SessionEvent): boolean {
  if (event.type !== 'assistant/message' || event.data?.interrupted) return false
  const content: any[] = event.data?.message?.content ?? []
  return content.some((b) => b?.type === 'text' && String(b.text ?? '').trim()) &&
    !content.some((b) => b?.type === 'tool-call')
}

/** Fold the log into alternating user/assistant entries, consecutive assistant steps merged. */
function transcriptOf(events: readonly SessionEvent[]): Transcript[] {
  const out: Transcript[] = []
  for (const event of events) {
    const role = event.type === 'user/message' ? 'user' : event.type === 'assistant/message' ? 'assistant' : undefined
    if (!role) continue
    const text = role === 'user' ? userText(event) : assistantText(event)
    if (!text) continue
    const last = out[out.length - 1]
    if (last?.role === role) last.text += `\n${text}`
    else out.push({ role, text })
  }
  return out
}

/** Newest-first packing under the char budget; the final assistant reply always fits (clipped). */
function frameTranscript(transcript: Transcript[], budget: number): string {
  const lines: string[] = []
  let used = 0
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i]
    const text = clip(entry.text, PER_MESSAGE_CHARS)
    const line = `<${entry.role}>\n${text}\n</${entry.role}>`
    if (lines.length > 0 && used + line.length > budget) break
    lines.unshift(line)
    used += line.length
  }
  return [
    'Recent conversation, oldest first:',
    '',
    lines.join('\n\n'),
    '',
    'Predict the user\'s next message.',
  ].join('\n')
}

const LEADING_JUNK = /^(?:(?:user|用户)\s*[:：]\s*)?["'“”‘’`「『]*/i
const TRAILING_QUOTES = /["'“”‘’`」』]+$/

/**
 * The displayable prefix of a still-streaming first line: leading prefix and
 * quotes stripped, and nothing at all while it could still turn into NONE.
 */
function partialFromOutput(raw: string): string {
  const line = raw.trimStart().split(/\r?\n/)[0].replace(LEADING_JUNK, '').replace(TRAILING_QUOTES, '')
  if ('NONE'.startsWith(line.trim().toUpperCase())) return ''
  return line
}

/** The final suggestion from the first line of model output; `null` for NONE or junk. */
function suggestionFromOutput(raw: string): string | null {
  let line = partialFromOutput(raw).replace(TRAILING_QUOTES, '').trim()
  if (!line || /^none\.?$/i.test(line)) return null
  if (line.length > 300) line = `${line.slice(0, 299)}…`
  return line
}

type Timing = {
  route: { provider: string; model: string }
  /** Route resolution before the request leaves. */
  prepareMs: number
  /** First streamed token of any kind (reasoning included). */
  firstTokenMs: number | null
  /** First visible answer token: what the ghost waits for. */
  firstTextMs: number | null
  totalMs: number
  /** Thinking the model did before answering; pure latency here. */
  reasoningChars: number
  effort: string | null
}

type Pending = {
  /** Seq of the final assistant reply this suggestion answers. */
  key: number
  controller: AbortController
  /** Displayable text so far; equals the suggestion once `done`. */
  partial: string
  done: boolean
  suggestion: string | null
  listeners: Set<() => void>
}

/** Sessions remembered at once; one entry each, so this bounds memory. */
const CACHE_LIMIT = 200

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export function apply(ctx: any, rawConfig: RawConfig) {
  const logger = ctx.logger?.('next-prompt') || console
  const config = () => liveConfig(rawConfig)
  const cache = new Map<string, Pending>()
  /** The last few real predictions' timings, newest last, for the settings card. */
  const timings: Timing[] = []
  const recordTiming = (timing: Timing) => {
    timings.push(timing)
    if (timings.length > 20) timings.shift()
  }
  /** sessionId → last time a browser asked about it. */
  const watched = new Map<string, number>()

  ctx.effect(() => () => {
    for (const pending of cache.values()) pending.controller.abort(new Error('next-prompt disposed'))
    cache.clear()
  }, 'next-prompt: cache')

  /** Subagent sessions are driven by their parent, not typed into. */
  const isSubagent = (events: readonly SessionEvent[]) => {
    const head = events[0] as any
    return head?.type === 'session' && Number(head.data?.delegationDepth ?? head.delegationDepth ?? 0) > 0
  }

  /**
   * The final-reply seq the user would be answering now, or `undefined` when
   * there is none: no turn yet, one still running, or the last one ended in an
   * error / cancel / block (a prediction there would guess at a failure).
   */
  const answerableKey = (events: readonly SessionEvent[]): number | undefined => {
    let i = events.length - 1
    for (; i >= 0; i--) {
      const event = events[i]
      if (event.type === 'turn/end') {
        if (event.data?.reason?.kind !== 'completed') return undefined
        break
      }
      if (event.type === 'turn/start' || event.type === 'user/message') return undefined
    }
    for (; i >= 0; i--) {
      if (events[i].type === 'assistant/message') return isFinalReply(events[i]) ? events[i].seq : undefined
      if (events[i].type === 'turn/start') return undefined
    }
    return undefined
  }

  /**
   * One prediction call on an explicit route. Shared by real predictions and
   * the speed test, so the test measures exactly what users wait for.
   */
  const runModel = async (
    route: { provider: string; model: string },
    input: string,
    sessionId: string | undefined,
    signal: AbortSignal,
    onPartial: (text: string) => void,
  ): Promise<{ suggestion: string | null; timing: Timing }> => {
    const current = config()
    const started = Date.now()
    const timing: Timing = { route, prepareMs: 0, firstTokenMs: null, firstTextMs: null, totalMs: 0, reasoningChars: 0, effort: null }
    const callSignal = AbortSignal.any([signal, AbortSignal.timeout(current.timeoutMs)])
    // No `stop` / `temperature`: the pi-ai adapter rejects `stop`, some
    // routes accept only temperature 1, and every option must be set here —
    // dsh refuses a call whose options drift from what was prepared.
    const call = await ctx.llm.prepareCall(
      { ...route, maxTokens: current.maxOutputTokens },
      callSignal,
      (controls: any, model: any) => {
        // Thinking is pure latency for a one-line guess: take the cheapest level offered.
        const efforts: string[] = (model?.reasoning?.efforts ?? []).map((e: any) => e?.id)
        const effort = FAST_EFFORTS.find((id) => efforts.includes(id)) ?? efforts[0]
        return effort === undefined ? { ...controls } : { ...controls, reasoningEffort: effort }
      },
    )
    timing.prepareMs = Date.now() - started
    timing.effort = call.config?.reasoningEffort ?? null
    const texts = new Map<number, string>()
    const joined = () => [...texts.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text).join('')
    let finish: any
    // Our own controller, so a complete first line can stop the call early.
    const stop = new AbortController()
    const streamSignal = AbortSignal.any([callSignal, stop.signal])
    try {
      for await (const chunk of call.stream({
        ...call.config,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
        ...(sessionId ? { sessionId } : {}),
        signal: streamSignal,
      })) {
        callSignal.throwIfAborted()
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') timing.firstTokenMs ??= Date.now() - started
        if (chunk.type === 'reasoning-delta') timing.reasoningChars += String(chunk.text ?? '').length
        if (chunk.type === 'text-delta') {
          timing.firstTextMs ??= Date.now() - started
          texts.set(chunk.index, (texts.get(chunk.index) ?? '') + chunk.text)
          const text = joined()
          onPartial(partialFromOutput(text))
          // The answer is one line; anything after the first newline is discarded anyway.
          if (/\S[^\n]*\n/.test(text)) {
            stop.abort()
            break
          }
        } else if (chunk.type === 'finish') finish = chunk.reason
      }
    } catch (error) {
      if (!stop.signal.aborted || callSignal.aborted) throw error
    }
    if (!stop.signal.aborted && (finish?.kind === 'error' || finish?.kind === 'aborted')) {
      throw new Error(finish.failure?.message ?? `model call ${finish.kind}`)
    }
    timing.totalMs = Date.now() - started
    return { suggestion: suggestionFromOutput(joined()), timing }
  }

  const generate = async (
    session: any,
    events: readonly SessionEvent[],
    signal: AbortSignal,
    onPartial: (text: string) => void,
  ): Promise<string | null> => {
    const current = config()
    const transcript = transcriptOf(events)
    if (!transcript.some((entry) => entry.role === 'user')) return null
    if (transcript[transcript.length - 1]?.role !== 'assistant') return null
    const header = session.requestHeader?.()?.config
    const route = current.provider && current.model
      ? { provider: current.provider, model: current.model }
      : header?.provider && header?.model
        ? { provider: header.provider, model: header.model }
        : undefined
    if (!route) throw new Error('no model: the session has no logged route and no prediction model is configured')
    const { suggestion, timing } = await runModel(route, frameTranscript(transcript, current.maxContextChars), session.id, signal, onPartial)
    recordTiming(timing)
    logger.debug?.(`session "${session.id}": ${JSON.stringify(timing)}`)
    return suggestion
  }

  /** Start (or keep) the prediction for one final reply. */
  const start = (sessionId: string, session: any, events: readonly SessionEvent[], key: number): Pending => {
    const existing = cache.get(sessionId)
    if (existing?.key === key) return existing
    existing?.controller.abort(new Error('superseded by a newer turn'))
    const controller = new AbortController()
    const pending: Pending = { key, controller, partial: '', done: false, suggestion: null, listeners: new Set() }
    const notify = () => {
      for (const listener of pending.listeners) listener()
    }
    cache.delete(sessionId)
    cache.set(sessionId, pending)
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value as string
      cache.get(oldest)?.controller.abort(new Error('evicted'))
      cache.delete(oldest)
    }
    generate(session, events, controller.signal, (text) => {
      if (text === pending.partial || controller.signal.aborted) return
      pending.partial = text
      notify()
    })
      .catch((error) => {
        if (!controller.signal.aborted) logger.warn(`session "${sessionId}": prediction failed: ${String(error?.message ?? error)}`)
        return null
      })
      .then((suggestion) => {
        pending.suggestion = suggestion
        pending.partial = suggestion ?? ''
        pending.done = true
        notify()
        pending.listeners.clear()
      })
    return pending
  }

  /** Early start: the turn's final reply just landed in a session a browser is watching. */
  ctx.on('session/event', (session: any, event: SessionEvent) => {
    if (!isFinalReply(event)) return
    const seen = watched.get(session.id)
    if (seen === undefined || Date.now() - seen > WATCH_MS) return
    if (!config().enabled) return
    const events: SessionEvent[] = session.snapshotEvents()
    if (isSubagent(events)) return
    start(session.id, session, events, event.seq)
  })

  /** The pending prediction for a session's latest turn, starting it only when `generate` is set. */
  const lookup = (sessionId: string, generate: boolean): Pending | undefined => {
    watched.set(sessionId, Date.now())
    const session = ctx.sessions.get(sessionId)
    if (!session) return undefined
    const events: SessionEvent[] = session.snapshotEvents()
    if (isSubagent(events)) return undefined
    const key = answerableKey(events)
    if (key === undefined) return undefined
    const pending = cache.get(sessionId)
    if (pending?.key === key) return pending
    return generate ? start(sessionId, session, events, key) : undefined
  }

  /** NDJSON: `{"partial":…}` lines as the text grows, then one `{"done":true,"suggestion":…}`. */
  const streamResponse = (pending: Pending | undefined): Response => {
    const encoder = new TextEncoder()
    let unsubscribe = () => {}
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
        if (!pending) {
          send({ done: true, suggestion: null })
          controller.close()
          return
        }
        let sent = ''
        const push = () => {
          if (pending.done) {
            send({ done: true, suggestion: pending.suggestion })
            unsubscribe()
            controller.close()
            return
          }
          if (pending.partial && pending.partial !== sent) {
            sent = pending.partial
            send({ partial: sent })
          }
        }
        pending.listeners.add(push)
        unsubscribe = () => pending.listeners.delete(push)
        push()
      },
      cancel() {
        unsubscribe()
      },
    })
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        // no-transform keeps a compression layer from buffering the stream.
        'cache-control': 'no-store, no-transform',
        'x-accel-buffering': 'no',
      },
    })
  }

  const listModels = async () => {
    const providers: { id: string; name: string }[] = ctx.llm.listProviders?.() ?? []
    const out: { provider: string; providerName: string; model: string; name: string }[] = []
    await Promise.all(providers.map(async (provider) => {
      try {
        const models: { id: string; name: string }[] = await ctx.llm.listModels(provider.id)
        for (const model of models) {
          out.push({ provider: provider.id, providerName: provider.name, model: model.id, name: model.name || model.id })
        }
      } catch (error: any) {
        logger.debug?.(`listModels(${provider.id}) failed: ${String(error?.message ?? error)}`)
      }
    }))
    const order = new Map(providers.map((p, i) => [p.id, i]))
    out.sort((a, b) => (order.get(a.provider)! - order.get(b.provider)!))
    return out
  }

  // Routes wait in a child fiber: a missing `connection` in the top-level
  // `inject` would keep the entry pending and fail the whole web boot.
  ctx.inject(['connection'], (cctx: any) => {
    if (typeof cctx.connection?.fetch?.register !== 'function') return
    cctx.effect(() => cctx.connection.fetch.register({
      path: SUGGEST_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        let body: any
        try {
          body = await request.json()
        } catch {
          return jsonResponse(400, { error: 'expected a JSON body' })
        }
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
        if (!sessionId) return jsonResponse(400, { error: 'sessionId is required' })
        if (!config().enabled) {
          return body?.stream === true
            ? streamResponse(undefined)
            : jsonResponse(200, { enabled: false, suggestion: null })
        }
        try {
          const pending = lookup(sessionId, body?.generate === true)
          if (body?.stream === true) return streamResponse(pending)
          if (pending && !pending.done) {
            await new Promise<void>((resolve) => pending.listeners.add(() => pending.done && resolve()))
          }
          return jsonResponse(200, { enabled: true, suggestion: pending?.suggestion ?? null })
        } catch (error: any) {
          return jsonResponse(500, { error: String(error?.message ?? error) })
        }
      },
    }), 'next-prompt: suggest route')
    cctx.effect(() => cctx.connection.fetch.register({
      path: MODELS_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          return jsonResponse(200, { version: PLUGIN_VERSION, models: await listModels() })
        } catch (error: any) {
          return jsonResponse(500, { error: String(error?.message ?? error) })
        }
      },
    }), 'next-prompt: models route')
    // Speed test for the settings card: one real prediction call on a fixed
    // conversation, plus the timings of the last real predictions.
    cctx.effect(() => cctx.connection.fetch.register({
      path: BENCH_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        let body: any = {}
        try {
          body = await request.json()
        } catch {}
        const current = config()
        const provider = String(body?.provider ?? '')
        const model = String(body?.model ?? '')
        // No route: the card only wants the recent real timings.
        if (!provider || !model) return jsonResponse(200, { recent: timings })
        try {
          const { suggestion, timing } = await runModel(
            { provider, model },
            frameTranscript(BENCH_TRANSCRIPTS[body?.lang === 'en' ? 'en' : 'zh'], current.maxContextChars),
            undefined,
            AbortSignal.timeout(current.timeoutMs),
            () => {},
          )
          return jsonResponse(200, { suggestion, timing, recent: timings })
        } catch (error: any) {
          return jsonResponse(200, { error: String(error?.message ?? error), recent: timings })
        }
      },
    }), 'next-prompt: bench route')
  })
}
