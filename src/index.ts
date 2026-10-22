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
export const DISMISS_ROUTE = '/api/next-prompt/dismiss'
export const WATCH_ROUTE = '/api/next-prompt/watch'

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

/** How long a failed own model is skipped before it is tried again. */
const COOLDOWN_MS = 10 * 60_000

/** Provider id prefix that marks a route as one of the plugin's own models. */
export const OWN_PREFIX = 'np:'

export type PresetId = 'modelscope' | 'siliconflow' | 'agnes' | 'deepseek' | 'spark'

type Preset = {
  name: string
  baseURL: string
  /** Where to create an API key. */
  keyUrl: string
  /** Request fields every call carries, merged under each model's own. */
  body?: Record<string, unknown>
  /** Recommended models, best first; `body` turns thinking off where the route needs it. */
  models: { id: string; body?: Record<string, unknown> }[]
}

/**
 * Ready-made OpenAI-compatible routes: the user only pastes a key. Each one
 * already carries the fields dsh would need a `compat` block for, chiefly
 * whatever turns thinking off, since thinking is pure latency here.
 */
export const PRESETS: Record<PresetId, Preset> = {
  modelscope: {
    name: 'ModelScope',
    baseURL: 'https://api-inference.modelscope.cn/v1',
    keyUrl: 'https://modelscope.cn/my/myaccesstoken',
    body: { enable_thinking: false },
    models: [
      { id: 'Qwen/Qwen3.5-35B-A3B' },
      { id: 'Qwen/Qwen3.8-Flash-Next' },
      { id: 'nex-agi/Nex-N2.5-mini' },
      { id: 'Qwen/Qwen3.5-27B' },
    ],
  },
  siliconflow: {
    name: 'SiliconFlow',
    baseURL: 'https://api.siliconflow.cn/v1',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    models: [
      { id: 'Qwen/Qwen2.5-7B-Instruct' },
      { id: 'deepseek-ai/DeepSeek-V4-Flash', body: { enable_thinking: false } },
      { id: 'Qwen/Qwen3.6-35B-A3B', body: { enable_thinking: false } },
    ],
  },
  agnes: {
    name: 'Agnes AI',
    baseURL: 'https://apihub.agnes-ai.com/v1',
    keyUrl: 'https://wiki.agnes-ai.com/en/docs/agnes-30-flash',
    models: [{ id: 'agnes-3.0-flash' }],
  },
  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    body: { thinking: { type: 'disabled' } },
    models: [{ id: 'deepseek-flash' }],
  },
  spark: {
    name: 'iFlytek Spark',
    baseURL: 'https://spark-api-open.xf-yun.com/v1',
    // Each Spark model has its own APIPassword, so only the free Lite is offered.
    keyUrl: 'https://console.xfyun.cn/services/cbm',
    models: [{ id: 'lite' }],
  },
}

/** One provider the user added in the card; list order is the order models are tried in. */
export type OwnProvider = {
  /** Stable id: the preset id, or `custom-…` for a custom endpoint. */
  id: string
  preset: PresetId | 'custom'
  /** Display name of a custom endpoint. */
  name: string
  /** Base URL of a custom endpoint; presets bring their own. */
  baseURL: string
  /** Model ids to use, tried in order. */
  models: string[]
  /** Extra request fields as a JSON object, merged over the preset's. */
  extraBody: string
}

const ownProviderSchema = Schema.object({
  id: Schema.string().required(),
  preset: Schema.union([
    Schema.const('modelscope'),
    Schema.const('siliconflow'),
    Schema.const('agnes'),
    Schema.const('deepseek'),
    Schema.const('spark'),
    Schema.const('custom'),
  ]).default('custom'),
  name: Schema.string().default(''),
  baseURL: Schema.string().default(''),
  models: Schema.array(Schema.string()).default([]),
  extraBody: Schema.string().default(''),
})

/** Every field, unmarked. Defaults here are what a fresh install runs with. */
const configFields = () => ({
  enabled: Schema.boolean().default(true),
  source: Schema.union([Schema.const('dsh'), Schema.const('own')]).default('dsh'),
  ownProviders: Schema.array(ownProviderSchema).default([]),
  ownProvider: Schema.string().default(''),
  ownModel: Schema.string().default(''),
  // Apart from the providers, so the browser (which never sees a secret) can
  // rewrite the list without wiping the keys.
  apiKeys: Schema.dict(Schema.string().role('secret')).default({}),
  provider: Schema.string().default(''),
  model: Schema.string().default(''),
  maxContextChars: Schema.natural().min(1000).max(100000).default(8000),
  maxOutputTokens: Schema.natural().min(16).max(4096).default(512),
  timeoutMs: Schema.natural().min(1000).max(120000).default(30000),
  acceptKey: Schema.union([Schema.const('arrow'), Schema.const('tab')]).default('arrow'),
})

/** Field descriptions keyed by dsh locale id; English is the required fallback. */
const configDescriptions: Record<'en' | 'zh', Record<keyof ReturnType<typeof configFields>, string>> = {
  en: {
    enabled: 'After each turn, predict what you will type next and show it as grey text in the composer; press → to accept.',
    source: 'Where predictions come from: dsh (dsh\'s models, see provider / model) or own (the plugin\'s own models, see ownProviders). Neither falls back to the other.',
    apiKeys: 'API keys of the own models, keyed by provider id.',
    ownProviders: 'The plugin\'s own OpenAI-compatible models (a preset or a custom endpoint plus an API key), used when source is own.',
    ownProvider: 'Id of the own provider whose model predicts (set together with ownModel). Leave empty to try every own model in order.',
    ownModel: 'Model id within ownProvider. Leave empty to try every own model in order.',
    provider: 'Model provider for predictions. Leave empty to follow the model the session is using.',
    model: 'Model id for predictions; set together with provider. Leave empty to follow the session.',
    maxContextChars: 'Most recent conversation sent to the prediction model, in characters, cut from the newest message back. Smaller is faster.',
    maxOutputTokens: 'Output token limit for a prediction call (a reasoning model\'s thinking counts too).',
    timeoutMs: 'Timeout of one prediction, in milliseconds.',
    acceptKey: 'Key that accepts the whole suggestion: arrow (→) or tab (Tab).',
  },
  zh: {
    enabled: '每轮对话结束后预测你接下来想输入的内容，显示为输入框里的灰色提示，按 → 接受。',
    source: '预测用哪边的模型：dsh（dsh 的模型，见 provider / model）或 own（插件自带模型，见 ownProviders）。两边互不兜底。',
    apiKeys: '自带模型的 API Key，按 provider id 存放。',
    ownProviders: '插件自带的 OpenAI 兼容模型（选预设或自定义地址，再填 API Key），source 为 own 时使用。',
    ownProvider: '预测用哪个自带提供商的模型（需与 ownModel 一起设置）。留空则按顺序尝试所有自带模型。',
    ownModel: 'ownProvider 下的模型 id。留空则按顺序尝试所有自带模型。',
    provider:'预测用的模型提供方。留空则跟随当前会话正在使用的模型。',
    model: '预测用的模型 id，需与 provider 一起设置。留空则跟随当前会话。',
    maxContextChars: '送给预测模型的最近对话上限（字符数），从最新消息往前截取。越小越快。',
    maxOutputTokens: '预测调用的输出 token 上限（推理模型的思考也计入）。',
    timeoutMs: '单次预测的超时（毫秒）。',
    acceptKey: '接受整条预测的按键：arrow（→）或 tab（Tab）。',
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
  source: 'dsh' | 'own'
  ownProviders: OwnProvider[]
  ownProvider: string
  ownModel: string
  apiKeys: Record<string, string>
  provider: string
  model: string
  maxContextChars: number
  maxOutputTokens: number
  timeoutMs: number
  acceptKey: 'arrow' | 'tab'
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
export function isFinalReply(event: SessionEvent): boolean {
  if (event.type !== 'assistant/message' || event.data?.interrupted) return false
  const content: any[] = event.data?.message?.content ?? []
  return content.some((b) => b?.type === 'text' && String(b.text ?? '').trim()) &&
    !content.some((b) => b?.type === 'tool-call')
}

/** One transcript entry as the prediction model sees it. */
const frameLine = (entry: Transcript) => `<${entry.role}>\n${clip(entry.text, PER_MESSAGE_CHARS)}\n</${entry.role}>`

/**
 * Fold the log into alternating user/assistant entries, consecutive assistant
 * steps merged. Walks back from the newest event and stops once older entries
 * could no longer fit {@link frameTranscript}'s `budget` (and a user message
 * has been seen), so a long session costs no more than its tail.
 */
export function transcriptOf(events: readonly SessionEvent[], budget = Infinity): Transcript[] {
  const out: Transcript[] = []
  let used = 0
  let sawUser = false
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    const role = event.type === 'user/message' ? 'user' : event.type === 'assistant/message' ? 'assistant' : undefined
    if (!role) continue
    const text = role === 'user' ? userText(event) : assistantText(event)
    if (!text) continue
    const oldest = out[out.length - 1]
    if (oldest?.role === role) {
      oldest.text = `${text}\n${oldest.text}`
      continue
    }
    if (oldest) {
      used += frameLine(oldest).length
      if (used > budget && sawUser) break
    }
    out.push({ role, text })
    sawUser ||= role === 'user'
  }
  return out.reverse()
}

/** Newest-first packing under the char budget; the final assistant reply always fits (clipped). */
export function frameTranscript(transcript: Transcript[], budget: number): string {
  const lines: string[] = []
  let used = 0
  for (let i = transcript.length - 1; i >= 0; i--) {
    const line = frameLine(transcript[i])
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

const LEADING_PREFIX = /^(?:user|用户)\s*[:：]\s*/i
const LEADING_QUOTES = /^["'“”‘’`「『]+/
const TRAILING_QUOTES = /["'“”‘’`」』]+$/

/**
 * The displayable prefix of a still-streaming first line: a "User:" prefix
 * stripped, wrapping quotes stripped (a closing quote is kept unless the line
 * also opened with one), and nothing at all while it could still turn into NONE.
 */
export function partialFromOutput(raw: string): string {
  let line = raw.trimStart().split(/\r?\n/)[0].replace(LEADING_PREFIX, '')
  if (LEADING_QUOTES.test(line)) line = line.replace(LEADING_QUOTES, '').replace(TRAILING_QUOTES, '')
  if ('NONE'.startsWith(line.trim().toUpperCase())) return ''
  return line
}

/** The final suggestion from the first line of model output; `null` for NONE or junk. */
export function suggestionFromOutput(raw: string): string | null {
  let line = partialFromOutput(raw).trim()
  if (!line || /^none\.?$/i.test(line)) return null
  if (line.length > 300) line = `${line.slice(0, 299)}…`
  return line
}

/**
 * The final-reply seq the user would be answering now, or `undefined` when
 * there is none: no turn yet, one still running, or the last one ended in an
 * error / cancel / block (a prediction there would guess at a failure).
 */
export function answerableKey(events: readonly SessionEvent[]): number | undefined {
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

/** Token counts summed over calls; `reported` counts the calls whose provider sent usage. */
export type UsageTotals = {
  calls: number
  reported: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
}

const emptyTotals = (): UsageTotals => ({
  calls: 0,
  reported: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
})

/**
 * Count one call into `totals`. `usage` is the call's `usage` chunk; it is
 * missing when the stream was cut before the provider sent it (Esc, timeout,
 * a newer turn), so such a call counts but adds no tokens.
 */
export function addUsage(totals: UsageTotals, usage: any): UsageTotals {
  totals.calls++
  if (!usage) return totals
  totals.reported++
  totals.inputTokens += Number(usage.inputTokens) || 0
  totals.cacheReadTokens += Number(usage.cacheReadTokens) || 0
  totals.cacheWriteTokens += Number(usage.cacheWriteTokens) || 0
  totals.outputTokens += Number(usage.outputTokens) || 0
  totals.reasoningTokens += Number(usage.reasoningTokens) || 0
  return totals
}

/** One of the plugin's own models, ready to call. */
export type OwnTarget = {
  route: { provider: string; model: string }
  /** Group label for menus: the preset's name, or the custom endpoint's. */
  providerName: string
  baseURL: string
  apiKey: string
  body: Record<string, unknown>
  /** Changes whenever anything that could fix a failure changes. */
  signature: string
}

/**
 * The own models in the order they are tried: providers top to bottom, each
 * one's models in its listed order. Providers without a key, a base URL or a
 * model are skipped. Throws when `extraBody` is not a JSON object.
 */
export function ownTargets(
  providers: readonly OwnProvider[] | undefined,
  apiKeys: Readonly<Record<string, string>> | undefined,
): OwnTarget[] {
  const out: OwnTarget[] = []
  for (const entry of providers ?? []) {
    const preset = entry.preset === 'custom' ? undefined : PRESETS[entry.preset]
    const baseURL = (preset?.baseURL ?? entry.baseURL ?? '').trim().replace(/\/+$/, '')
    const apiKey = (apiKeys?.[entry.id] ?? '').trim()
    if (!baseURL || !apiKey) continue
    let extra: Record<string, unknown> = {}
    if (entry.extraBody?.trim()) {
      extra = JSON.parse(entry.extraBody)
      if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
        throw new Error(`${entry.name || entry.id}: extra request fields must be a JSON object`)
      }
    }
    for (const model of entry.models ?? []) {
      const id = model.trim()
      if (!id) continue
      const body = { ...preset?.body, ...preset?.models.find((m) => m.id === id)?.body, ...extra }
      out.push({
        route: { provider: `${OWN_PREFIX}${entry.id}`, model: id },
        providerName: preset?.name ?? (entry.name.trim() || new URL(baseURL).host),
        baseURL,
        apiKey,
        body,
        signature: JSON.stringify([baseURL, apiKey, body]),
      })
    }
  }
  return out
}

/**
 * An OpenAI-format `usage` block in the shape dsh's `usage` chunks use:
 * `inputTokens` leaves out the cache hits, which DeepSeek reports in its own field.
 */
export function usageFromOpenAI(usage: any) {
  const prompt = Number(usage?.prompt_tokens) || 0
  const cached = Number(usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens) || 0
  return {
    inputTokens: Math.max(0, prompt - cached),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
    outputTokens: Number(usage?.completion_tokens) || 0,
    reasoningTokens: Number(usage?.completion_tokens_details?.reasoning_tokens) || 0,
  }
}

/** The dsh-style chunks carried by one streamed `chat.completion.chunk`. */
export function chunksOf(json: any): any[] {
  const out: any[] = []
  const choice = json?.choices?.[0]
  const delta = choice?.delta ?? {}
  const reasoning = delta.reasoning_content ?? delta.reasoning
  if (typeof reasoning === 'string' && reasoning) out.push({ type: 'reasoning-delta', text: reasoning })
  if (typeof delta.content === 'string' && delta.content) out.push({ type: 'text-delta', index: 0, text: delta.content })
  if (json?.usage) out.push({ type: 'usage', usage: usageFromOpenAI(json.usage) })
  if (choice?.finish_reason) out.push({ type: 'finish', reason: { kind: 'stop' } })
  return out
}

/** The readable part of an error body: `error.message`, `errors.message`, `message`, or the text itself. */
export function errorMessage(status: number, text: string): string {
  let message = text.trim()
  try {
    const body = JSON.parse(text)
    message = String(body?.error?.message ?? body?.errors?.message ?? body?.message ?? body?.error ?? message)
  } catch {}
  return `HTTP ${status}${message ? `: ${message.slice(0, 300)}` : ''}`
}

/** Stream one prediction from an own model as dsh-style chunks. */
export async function* streamChatCompletions(
  target: OwnTarget,
  system: string,
  input: string,
  maxTokens: number,
  signal: AbortSignal,
): AsyncGenerator<any> {
  const response = await fetch(`${target.baseURL}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${target.apiKey}`,
    },
    body: JSON.stringify({
      model: target.route.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: input }],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: maxTokens,
      ...target.body,
    }),
  })
  if (!response.ok || !response.body) throw new Error(errorMessage(response.status, await response.text().catch(() => '')))
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const bytes of response.body as any as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true })
    for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      let json: any
      try {
        json = JSON.parse(data)
      } catch {
        continue
      }
      if (json?.error) throw new Error(errorMessage(response.status, data))
      yield* chunksOf(json)
    }
  }
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

const routeKey = (route: { provider: string; model: string }) => `${route.provider}\u0000${route.model}`

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
  /** Token usage of every call this entry made (predictions and speed tests), per route, since it started. */
  const usageSince = Date.now()
  const usage = new Map<string, { provider: string; model: string } & UsageTotals>()
  const recordUsage = (route: { provider: string; model: string }, chunk: any) => {
    const key = routeKey(route)
    let entry = usage.get(key)
    if (!entry) usage.set(key, (entry = { provider: route.provider, model: route.model, ...emptyTotals() }))
    addUsage(entry, chunk)
  }
  const usageReport = () => ({ since: usageSince, models: [...usage.values()] })
  /** Own models that failed lately, keyed like `usage`; the chain skips them while cooling down. */
  const failures = new Map<string, { provider: string; model: string; error: string; at: number; signature: string }>()
  const failureReport = () => {
    const signatures = new Map(safeOwnTargets().map((t) => [routeKey(t.route), t.signature]))
    return [...failures.entries()]
      .filter(([key, f]) => signatures.get(key) === f.signature)
      .map(([, { provider, model, error, at }]) => ({ provider, model, error, at, retryAt: at + COOLDOWN_MS }))
  }
  /** The own models, or none while a provider's extra fields are invalid JSON (the card says so). */
  const safeOwnTargets = () => {
    const current = config()
    try {
      return ownTargets(current.ownProviders, current.apiKeys)
    } catch {
      return []
    }
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
   * An armed goal with rounds left sends the next message itself, so nobody
   * would read a prediction. `agents` / `goals` are optional services.
   */
  const goalContinues = (sessionId: string): boolean => {
    try {
      const agent = ctx.reflect?.get?.('agents')?.get?.(sessionId)
      const goal = agent && ctx.reflect?.get?.('goals')?.get?.(agent)
      return goal?.phase === 'active' && goal.activation === 'armed' && goal.roundsStarted < goal.maxGoalRounds
    } catch {
      return false
    }
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
    // Our own controller, so a complete first line can stop the call early.
    const stop = new AbortController()
    const streamSignal = AbortSignal.any([callSignal, stop.signal])
    let chunks: AsyncIterable<any>
    if (route.provider.startsWith(OWN_PREFIX)) {
      const target = ownTargets(current.ownProviders, current.apiKeys)
        .find((t) => t.route.provider === route.provider && t.route.model === route.model)
      if (!target) throw new Error(`${route.provider}/${route.model} is not configured`)
      chunks = streamChatCompletions(target, SYSTEM_PROMPT, input, current.maxOutputTokens, streamSignal)
    } else {
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
      timing.effort = call.config?.reasoningEffort ?? null
      chunks = call.stream({
        ...call.config,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
        ...(sessionId ? { sessionId } : {}),
        signal: streamSignal,
      })
    }
    timing.prepareMs = Date.now() - started
    const texts = new Map<number, string>()
    const joined = () => [...texts.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text).join('')
    let finish: any
    let usageChunk: any
    try {
      for await (const chunk of chunks) {
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
        } else if (chunk.type === 'usage') usageChunk = chunk.usage
        else if (chunk.type === 'finish') finish = chunk.reason
      }
    } catch (error) {
      if (!stop.signal.aborted || callSignal.aborted) throw error
    } finally {
      recordUsage(route, usageChunk)
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
    const transcript = transcriptOf(events, current.maxContextChars)
    if (!transcript.some((entry) => entry.role === 'user')) return null
    if (transcript[transcript.length - 1]?.role !== 'assistant') return null
    const input = frameTranscript(transcript, current.maxContextChars)
    if (current.source === 'own') {
      let own = ownTargets(current.ownProviders, current.apiKeys)
      if (current.ownProvider && current.ownModel) {
        own = own.filter((t) => t.route.provider === `${OWN_PREFIX}${current.ownProvider}` && t.route.model === current.ownModel)
      }
      if (!own.length) throw new Error('no own model: add one with an API key and a model in the settings card')
      return generateOwn(own, input, session.id, signal, onPartial)
    }
    const header = session.requestHeader?.()?.config
    const route = current.provider && current.model
      ? { provider: current.provider, model: current.model }
      : header?.provider && header?.model
        ? { provider: header.provider, model: header.model }
        : undefined
    if (!route) throw new Error('no model: the session has no logged route and no prediction model is configured')
    const { suggestion, timing } = await runModel(route, input, session.id, signal, onPartial)
    recordTiming(timing)
    logger.debug?.(`session "${session.id}": ${JSON.stringify(timing)}`)
    return suggestion
  }

  /**
   * Own models are tried in order. One that fails before showing any text
   * (quota used up, bad key, timeout…) is skipped for {@link COOLDOWN_MS}, or
   * until its settings change, and the next one is tried. When none is left
   * the prediction fails: the user fixes it in the card, dsh's models are not
   * used behind their back.
   */
  const generateOwn = async (
    targets: OwnTarget[],
    input: string,
    sessionId: string,
    signal: AbortSignal,
    onPartial: (text: string) => void,
  ): Promise<string | null> => {
    for (const target of targets) {
      const key = routeKey(target.route)
      const failure = failures.get(key)
      // Cooling down only helps when there is another model to try.
      if (targets.length > 1 && failure && failure.signature === target.signature && Date.now() - failure.at < COOLDOWN_MS) continue
      let shown = false
      try {
        const { suggestion, timing } = await runModel(target.route, input, sessionId, signal, (text) => {
          shown ||= text !== ''
          onPartial(text)
        })
        failures.delete(key)
        recordTiming(timing)
        logger.debug?.(`session "${sessionId}": ${JSON.stringify(timing)}`)
        return suggestion
      } catch (error: any) {
        if (signal.aborted || shown) throw error
        const message = String(error?.message ?? error)
        failures.set(key, { ...target.route, error: message, at: Date.now(), signature: target.signature })
        logger.warn(`own model ${target.route.provider}/${target.route.model} failed, trying the next one: ${message}`)
      }
    }
    throw new Error('every own model failed recently; check the keys and quotas in the settings card')
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
    if (seen === undefined) return
    if (Date.now() - seen > WATCH_MS) {
      watched.delete(session.id)
      return
    }
    if (!config().enabled) return
    const events: SessionEvent[] = session.snapshotEvents()
    if (isSubagent(events) || goalContinues(session.id)) return
    start(session.id, session, events, event.seq)
  })

  /** A browser is looking at this session: keep early starts on for it. */
  const watch = (sessionId: string) => {
    // Re-insert so the map stays oldest-first, then drop the overflow.
    watched.delete(sessionId)
    watched.set(sessionId, Date.now())
    while (watched.size > CACHE_LIMIT) watched.delete(watched.keys().next().value as string)
  }

  /** The pending prediction for a session's latest turn, starting it only when `generate` is set. */
  const lookup = (sessionId: string, generate: boolean): Pending | undefined => {
    watch(sessionId)
    const session = ctx.sessions.get(sessionId)
    if (!session) return undefined
    const events: SessionEvent[] = session.snapshotEvents()
    if (isSubagent(events)) return undefined
    const key = answerableKey(events)
    if (key === undefined) return undefined
    const pending = cache.get(sessionId)
    if (pending?.key === key) return pending
    return generate && !goalContinues(sessionId) ? start(sessionId, session, events, key) : undefined
  }

  /**
   * The user pressed Esc: stop the call
   * still running for the current turn, or forget its finished suggestion so
   * other tabs and a reopened session don't show it either. A newer turn's
   * prediction is left alone.
   */
  const dismiss = (sessionId: string) => {
    const pending = cache.get(sessionId)
    const session = ctx.sessions.get(sessionId)
    if (!pending || !session || answerableKey(session.snapshotEvents()) !== pending.key) return
    if (pending.done) pending.suggestion = null
    else pending.controller.abort(new Error('dismissed by the user'))
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
    // Own models first, in the order they are tried, so the speed test can pick them too.
    const own = safeOwnTargets().map((t) => ({
      provider: t.route.provider,
      providerName: t.providerName,
      model: t.route.model,
      name: t.route.model,
    }))
    return [...own, ...out]
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
      path: DISMISS_ROUTE,
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
        dismiss(sessionId)
        return jsonResponse(200, { ok: true })
      },
    }), 'next-prompt: dismiss route')
    // A turn just started in the browser: the watch must outlive it, however
    // long the user idled before sending, so its final reply starts early.
    cctx.effect(() => cctx.connection.fetch.register({
      path: WATCH_ROUTE,
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
        watch(sessionId)
        return jsonResponse(200, { ok: true })
      },
    }), 'next-prompt: watch route')
    cctx.effect(() => cctx.connection.fetch.register({
      path: MODELS_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          // `keyed` tells the card which providers have a key, since it never sees the keys themselves.
          const keyed = Object.entries(config().apiKeys ?? {}).filter(([, key]) => key?.trim()).map(([id]) => id)
          return jsonResponse(200, { version: PLUGIN_VERSION, models: await listModels(), presets: PRESETS, keyed })
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
        const stats = () => ({ recent: timings, usage: usageReport(), failures: failureReport() })
        // No route: the card only wants the recent real timings, the token usage and the failing own models.
        if (!provider || !model) return jsonResponse(200, stats())
        try {
          const { suggestion, timing } = await runModel(
            { provider, model },
            frameTranscript(BENCH_TRANSCRIPTS[body?.lang === 'en' ? 'en' : 'zh'], current.maxContextChars),
            undefined,
            // runModel adds the timeout; this stops the call if the page goes away.
            request.signal,
            () => {},
          )
          return jsonResponse(200, { suggestion, timing, ...stats() })
        } catch (error: any) {
          return jsonResponse(200, { error: String(error?.message ?? error), ...stats() })
        }
      },
    }), 'next-prompt: bench route')
  })
}
