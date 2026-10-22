import * as React from "react";
import { createPortal } from "react-dom";

/** The profile entry id the Host half runs under (cordis.patch.yml). */
const NAMESPACE = "next-prompt";

/** This package's npm name; the Plugins page keys `plugins.bundle.config` on it. */
const PACKAGE_NAME = "dsh-ghost-prompt";

/** Host routes, relative so they resolve under dsh's `<base href="./">`. */
const SUGGEST_PATH = "api/next-prompt/suggest";
const MODELS_PATH = "api/next-prompt/models";
const BENCH_PATH = "api/next-prompt/bench";
const DISMISS_PATH = "api/next-prompt/dismiss";
const WATCH_PATH = "api/next-prompt/watch";
const BENCH_STORAGE = "dsh-ghost-prompt:bench";
const BENCH_PICK_STORAGE = "dsh-ghost-prompt:bench-pick";

/** Which key accepts the whole suggestion; mirrors the Host's `acceptKey`. */
type AcceptKey = "arrow" | "tab";
const KEY_LABEL: Record<AcceptKey, string> = { arrow: "→", tab: "Tab" };
const isMac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "");
/** Word-wise accept: Option+→ on macOS, Ctrl+→ elsewhere (Alt+→ works too). */
const WORD_KEY_LABEL = isMac ? "⌥→" : "Ctrl+→";

/** Set once `configForms` is there, so the ghost can read `acceptKey`. */
let configForm: any;
const configFormListeners = new Set<() => void>();
function setConfigForm(form: any) {
  configForm = form;
  for (const listener of configFormListeners) listener();
}
/** {@link configForm}, re-rendering when it arrives after the ghost mounted. */
const useConfigForm = () =>
  React.useSyncExternalStore(
    React.useCallback((listener: () => void) => {
      configFormListeners.add(listener);
      return () => configFormListeners.delete(listener);
    }, []),
    () => configForm,
  );

/**
 * dsh's shared UI kit (Switch, icons), answered by the page's module loader.
 * Optional: a dsh without it still gets a working card from the fallbacks.
 */
const ui: any = (() => {
  try {
    return require("@deepseek-ai/dsh-client-ui-primitives") ?? {};
  } catch {
    return {};
  }
})();

type Lang = "zh" | "en";

const zh = {
  "ghost.accept": "{key} 接受",
  "card.enabled": "输入预测",
  "card.enabled.hint": "每轮对话结束后，猜你接下来想说什么，以灰色文字显示在输入框里。",
  "card.preview.suggestion": "好的，再加上单元测试",
  "card.preview.caption": "按 {key} 接受，{word} 逐词接受，Esc 关闭；打的字和预测开头一致时会继续提示",
  "card.acceptKey": "接受键",
  "card.acceptKey.hint": "按哪个键接受整条预测。也可以直接点击输入框里的提示标签。",
  "card.model": "预测模型",
  "card.model.hint": "每次预测会额外调用一次模型。不带推理的 Flash 类小模型响应最快、也最省钱。",
  "card.model.follow": "跟随当前会话",
  "card.model.follow.hint": "使用会话正在用的模型",
  "card.model.search": "搜索模型",
  "card.model.empty": "没有匹配的模型",
  "card.model.loading": "正在加载模型列表…",
  "card.model.failed": "模型列表加载失败：{error}",
  "card.model.missing": "已配置，但当前不可用",
  "card.source": "模型来源",
  "card.source.dsh": "dsh 模型",
  "card.source.own": "自定义",
  "card.source.dsh.hint": "用 dsh 里已配置好的模型。",
  "card.source.own.hint": "用你自己的 API Key 直接调用厂商接口，不经过 dsh。",
  "card.own": "提供商",
  "card.own.hint": "添加提供商并填好 API Key，它的模型就会出现在上面的列表里。",
  "card.own.add": "添加",
  "card.own.addTitle": "添加提供商",
  "card.own.provider": "提供商",
  "card.own.confirm": "添加",
  "card.own.required": "请把必填项填完整",
  "card.own.auto": "自动",
  "card.own.auto.hint": "按提供商顺序依次尝试，失败自动换下一个",
  "card.own.errors": "{n} 个模型出错，展开查看",
  "card.cancel": "取消",
  "card.own.custom": "其他（OpenAI 兼容）",
  "card.own.key": "API Key",
  "card.own.keyPlaceholder": "粘贴 API Key",
  "card.own.keySet": "已保存，输入新的可替换",
  "card.own.getKey": "获取",
  "card.own.models": "模型",
  "card.own.pickModels": "选择模型",
  "card.own.modelIds": "模型 id，多个用逗号分隔",
  "card.own.name": "名称",
  "card.own.baseURL": "接口地址",
  "card.own.extra": "额外参数",
  "card.own.extraInvalid": "额外参数不是合法的 JSON 对象，自定义模型暂不可用",
  "card.own.up": "上移",
  "card.own.down": "下移",
  "card.own.remove": "删除",
  "card.own.incomplete": "未生效：需要 Key 和模型",
  "card.own.failed": "{model}：{error}（{time}后重试）",
  "card.own.tag": "自定义",
  "card.own.minutes": "{n} 分钟",
  "preset.modelscope": "免费，每天有调用次数额度；需绑定阿里云账号并实名",
  "preset.siliconflow": "Qwen2.5-7B 免费，其余按量计费",
  "preset.agnes": "目前免费",
  "preset.spark": "讯飞星火 Lite 免费；Key 填控制台里 Lite 的 APIPassword",
  "preset.deepseek": "按量计费，便宜、响应快",
  "card.saveFailed": "保存失败，已恢复为服务器上的值",
  "card.bench": "模型测速",
  "card.bench.hint": "选几个要测的模型，用一段固定的对话各实际调用一次，看谁出预测最快、预测得怎么样。每个模型会产生一次调用费用。",
  "card.bench.start": "开始测速（{count}）",
  "card.bench.pick": "选择模型（{count}）",
  "card.bench.untested": "未测",
  "card.bench.remove": "移除",
  "card.bench.all": "全选",
  "card.bench.clear": "清空",
  "card.bench.running": "测速中 {done}/{total}",
  "card.bench.use": "选用",
  "card.bench.inUse": "使用中",
  "card.bench.fastest": "最快",
  "card.bench.failed": "失败",
  "card.bench.empty": "（没有输出）",
  "card.bench.sample": "「{text}」",
  "card.recent": "最近一次预测用了 {ms}（{model}）",
  "card.recent.think": "，其中模型思考了约 {chars} 字——思考型模型会明显变慢",
  "card.recent.none": "还没有实际预测记录，聊一轮后这里会显示耗时。",
  "card.usage": "Token 用量",
  "card.usage.hint": "自 dsh 启动以来，预测和测速调用模型消耗的 token，重启后清零。输入不含缓存命中的部分。",
  "card.usage.refresh": "刷新",
  "card.usage.model": "模型",
  "card.usage.calls": "调用",
  "card.usage.input": "输入",
  "card.usage.cached": "缓存命中",
  "card.usage.output": "输出",
  "card.usage.total": "合计",
  "card.usage.reasoning": "其中思考 {tokens}",
  "card.usage.unreported": "另有 {count} 次调用中途结束（Esc 取消、超时或被新一轮顶掉），供应商没有返回用量，未计入。",
  "card.usage.empty": "还没有调用记录。",
  "card.unavailable":
    "当前 dsh 未提供插件设置服务，可在 profile 的 cordis.patch.yml 中为 id 为 next-prompt 的条目配置 enabled / provider / model。",
};
type TKey = keyof typeof zh;
const en: Record<TKey, string> = {
  "ghost.accept": "{key} accept",
  "card.enabled": "Prompt suggestions",
  "card.enabled.hint": "After each turn, guess what you will type next and show it as grey text in the composer.",
  "card.preview.suggestion": "Sounds good, add unit tests too",
  "card.preview.caption": "{key} accepts, {word} accepts a word, Esc dismisses; typing the suggestion's start keeps it showing",
  "card.acceptKey": "Accept key",
  "card.acceptKey.hint": "Which key accepts the whole suggestion. You can also click the hint chip in the composer.",
  "card.model": "Suggestion model",
  "card.model.hint": "Each suggestion is one extra model call. A small non-reasoning Flash model is fastest and cheapest.",
  "card.model.follow": "Follow the current session",
  "card.model.follow.hint": "Use the model the session is running",
  "card.model.search": "Search models",
  "card.model.empty": "No matching models",
  "card.model.loading": "Loading models…",
  "card.model.failed": "Could not load models: {error}",
  "card.model.missing": "Configured, currently unavailable",
  "card.source": "Model source",
  "card.source.dsh": "dsh models",
  "card.source.own": "Custom",
  "card.source.dsh.hint": "Use a model already set up in dsh.",
  "card.source.own.hint": "Call a provider directly with your own API key, outside dsh.",
  "card.own": "Providers",
  "card.own.hint": "Add a provider with its API key and its models show up in the list above.",
  "card.own.add": "Add",
  "card.own.addTitle": "Add a provider",
  "card.own.provider": "Provider",
  "card.own.confirm": "Add",
  "card.own.required": "Fill in the required fields",
  "card.own.auto": "Automatic",
  "card.own.auto.hint": "Tries the providers in order, moving on when one fails",
  "card.own.errors": "{n} failing; expand for details",
  "card.cancel": "Cancel",
  "card.own.custom": "Other (OpenAI-compatible)",
  "card.own.key": "API key",
  "card.own.keyPlaceholder": "Paste your API key",
  "card.own.keySet": "Saved; type a new one to replace it",
  "card.own.getKey": "Get one",
  "card.own.models": "Models",
  "card.own.pickModels": "Pick models",
  "card.own.modelIds": "Model ids, comma-separated",
  "card.own.name": "Name",
  "card.own.baseURL": "Base URL",
  "card.own.extra": "Extra fields",
  "card.own.extraInvalid": "Extra fields are not a JSON object; custom models are off until fixed",
  "card.own.up": "Move up",
  "card.own.down": "Move down",
  "card.own.remove": "Remove",
  "card.own.incomplete": "Not active: needs a key and a model",
  "card.own.failed": "{model}: {error} (retry in {time})",
  "card.own.tag": "custom",
  "card.own.minutes": "{n} min",
  "preset.modelscope": "Free with a daily call quota; needs a verified Alibaba Cloud account",
  "preset.siliconflow": "Qwen2.5-7B is free, the rest pay as you go",
  "preset.agnes": "Free for now",
  "preset.spark": "Spark Lite is free; the key is Lite's APIPassword from the console",
  "preset.deepseek": "Pay as you go; cheap and fast",
  "card.saveFailed": "Save failed; reverted to the stored value",
  "card.bench": "Speed test",
  "card.bench.hint": "Pick the models to test; each is called once on a fixed conversation to see which predicts fastest, and how well. Each model costs one call.",
  "card.bench.start": "Run ({count})",
  "card.bench.pick": "Models ({count})",
  "card.bench.untested": "Not run yet",
  "card.bench.remove": "Remove",
  "card.bench.all": "All",
  "card.bench.clear": "Clear",
  "card.bench.running": "Testing {done}/{total}",
  "card.bench.use": "Use",
  "card.bench.inUse": "In use",
  "card.bench.fastest": "Fastest",
  "card.bench.failed": "Failed",
  "card.bench.empty": "(no output)",
  "card.bench.sample": "“{text}”",
  "card.recent": "The last prediction took {ms} ({model})",
  "card.recent.think": "; the model thought for about {chars} characters first — reasoning models are noticeably slower",
  "card.recent.none": "No real predictions yet; the timing shows here after a turn.",
  "card.usage": "Token usage",
  "card.usage.hint": "Tokens spent by prediction and speed-test calls since dsh started; reset on restart. Input excludes cache hits.",
  "card.usage.refresh": "Refresh",
  "card.usage.model": "Model",
  "card.usage.calls": "Calls",
  "card.usage.input": "Input",
  "card.usage.cached": "Cached",
  "card.usage.output": "Output",
  "card.usage.total": "Total",
  "card.usage.reasoning": "{tokens} of it thinking",
  "card.usage.unreported": "{count} more calls ended early (Esc, timeout or a newer turn); the provider sent no usage for them, so they are not counted.",
  "card.usage.empty": "No calls yet.",
  "card.unavailable":
    "This dsh offers no plugin settings service. Set enabled / provider / model on the next-prompt entry in the profile's cordis.patch.yml.",
};
const DICTS: Record<Lang, Record<TKey, string>> = { zh, en };
type Translate = (key: TKey, params?: Record<string, string>) => string;

/** Namespace these dictionaries are registered under in dsh's locale registry. */
const LOCALE_NS = "next-prompt";

/** Set while our dictionaries sit in the locale registry; until then we translate locally. */
let registered = false;

/** dsh's own default: English unless the browser asks for Chinese. */
const browserLang = (): Lang =>
  typeof navigator !== "undefined" &&
  (navigator.language || "").toLowerCase().startsWith("zh")
    ? "zh"
    : "en";

/**
 * Follow Settings → General → Language when the locale service exists:
 * translations go through the registry (so language packs and their fallback
 * chains apply), and `lang` names the closest built-in language.
 */
const useLocale = (locale: any): { t: Translate; lang: Lang } => {
  const snapshot = React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) => (locale ? locale.subscribe(listener) : () => {}),
      [locale],
    ),
    React.useCallback(() => (locale ? locale.getSnapshot() : null), [locale]),
  );
  const active: string | undefined = snapshot?.active;
  const lang: Lang = active ? (active.toLowerCase().startsWith("zh") ? "zh" : "en") : browserLang();
  const t = React.useCallback<Translate>(
    (key, params) => {
      if (registered && typeof locale?.bind === "function") return locale.bind(LOCALE_NS)(key, params);
      const raw = DICTS[lang][key] ?? en[key] ?? key;
      return params ? raw.replace(/\{(\w+)\}/g, (w, n) => params[n] ?? w) : raw;
    },
    // `snapshot` changes on every locale switch and dictionary registration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, lang, snapshot],
  );
  return { t, lang };
};

/**
 * Stream one session's suggestion: `onPartial` sees the text grow token by
 * token, the promise settles with the final suggestion (or null).
 */
async function streamSuggestion(
  sessionId: string,
  generate: boolean,
  signal: AbortSignal,
  onPartial: (text: string) => void,
): Promise<string | null> {
  const res = await fetch(SUGGEST_PATH, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, generate, stream: true }),
    signal,
  });
  // 404: a Host half that is not loaded (plugin disabled in this profile).
  if (!res.ok || !res.body) return null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return null;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.done) return message.suggestion ?? null;
      if (typeof message.partial === "string") onPartial(message.partial);
    }
  }
}

/** Fire-and-forget POST to a Host route; nothing waits on the answer. */
function notifyHost(path: string, sessionId: string) {
  fetch(path, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
    keepalive: true,
  }).catch(() => {});
}

/** Tell the Host the user moved on, so it stops (or forgets) this turn's prediction. */
function dismissSuggestion(sessionId: string) {
  notifyHost(DISMISS_PATH, sessionId);
}

/** The editor may hold non-breaking spaces where the suggestion has plain ones. */
export const normalizeDraft = (draft: string) => draft.replace(/ /g, " ");

/** `text.startsWith(prefix)`, ignoring case: typing "Yes" stays on "yes, go ahead". */
const startsWithLoose = (text: string, prefix: string) =>
  text.length >= prefix.length && text.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();

/**
 * Whether the draft is still on the suggestion's path: a prefix of it, or —
 * while it is still streaming — typed ahead of what has arrived so far.
 */
export const onPath = (draft: string, suggestion: string, complete: boolean) =>
  startsWithLoose(suggestion, draft) || (!complete && startsWithLoose(draft, suggestion));

/** The next word of `rest` plus the spaces / punctuation after it. */
export function nextWord(rest: string): string {
  const Segmenter = (Intl as any).Segmenter;
  if (!Segmenter) return /^\s*\S+\s*/.exec(rest)?.[0] ?? rest;
  let end = 0;
  let sawWord = false;
  for (const { segment, isWordLike } of new Segmenter(undefined, { granularity: "word" }).segment(rest)) {
    if (isWordLike && sawWord) break;
    sawWord ||= isWordLike;
    end += segment.length;
  }
  return rest.slice(0, end);
}

/** Whether the caret sits collapsed at the very end of `editable`. */
function caretAtEnd(editable: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!editable.contains(range.endContainer)) return false;
  const after = document.createRange();
  after.selectNodeContents(editable);
  after.setStart(range.endContainer, range.endOffset);
  return after.toString() === "";
}

/** One page-wide stylesheet for the ghost and the settings card. */
const STYLE_ID = "dsh-ghost-prompt-style";
const CSS = `
[data-composer-card][data-next-prompt-active] [data-composer-placeholder]{opacity:0!important}
[data-next-prompt-ghost]{visibility:visible!important;white-space:normal!important;display:block!important;-webkit-line-clamp:unset!important}
[data-next-prompt-ghost] kbd{font:inherit;font-size:11px;line-height:16px;margin-left:8px;padding:0 5px;border-radius:4px;border:.5px solid var(--dsw-alias-border-l4,currentColor);opacity:.75;white-space:nowrap;display:inline-block;animation:np-fade .2s ease-out;pointer-events:auto;cursor:pointer}
[data-next-prompt-ghost] kbd:hover{opacity:1}
@keyframes np-fade{from{opacity:0}to{opacity:.75}}

.np-card{display:flex;flex-direction:column;color:var(--dsw-alias-label-primary)}
.np-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.np-row:last-child{border-bottom:none}
.np-text{min-width:0}
.np-title{font-size:14px;line-height:20px}
.np-desc{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.np-error{margin-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#d33)}
.np-dim{opacity:.5;pointer-events:none}

.np-preview{margin:0 0 16px;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1,transparent);transition:opacity .15s}
.np-preview-line{display:flex;align-items:center;gap:2px;font-size:14px;line-height:22px;min-width:0}
.np-caret{width:1.5px;height:16px;background:var(--dsw-alias-state-business-primary,#3e58d6);animation:np-blink 1.1s steps(1) infinite;flex:none}
@keyframes np-blink{50%{opacity:0}}
.np-ghost{color:var(--dsw-alias-label-caption);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.np-key{flex:none;margin-left:8px;font-size:11px;line-height:16px;padding:0 5px;border-radius:4px;border:.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-caption)}
.np-preview-caption{margin-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}

.np-picker{position:relative;flex:none}
.np-trigger{display:inline-flex;align-items:center;gap:6px;max-width:260px;height:32px;padding:0 10px 0 12px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:transparent;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm,8px);cursor:pointer}
.np-trigger:hover:not(:disabled),.np-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
.np-trigger:disabled{cursor:default;opacity:.5}
.np-trigger-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-caption)}
.np-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:50;width:300px;max-height:360px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2,#fff);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.16));overflow:hidden}
.np-search{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-caption)}
.np-search input{flex:1;min-width:0;border:none;outline:none;background:transparent;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.np-search input::placeholder{color:var(--dsw-alias-label-caption)}
.np-list{overflow-y:auto;padding:4px}
.np-group{padding:8px 8px 4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}
.np-option{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;font:inherit;text-align:left;color:var(--dsw-alias-label-primary);background:transparent;border:none;border-radius:var(--dsw-radius-sm,8px);cursor:pointer}
.np-option:hover,.np-option[data-active]{background:var(--dsw-alias-interactive-bg-hover)}
.np-option-text{flex:1;min-width:0}
.np-option-name{font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-option-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-check{flex:none;width:14px;display:inline-flex;color:var(--dsw-alias-state-business-primary,#3e58d6)}
.np-menu-toolbar{display:flex;gap:6px;padding:8px 10px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.np-bench-actions{flex:none;display:flex;align-items:center;gap:8px}
.np-btn.np-btn-tall{height:32px}
.np-bench{display:flex;flex-direction:column;gap:2px;padding:0 0 16px;max-height:320px;overflow-y:auto}
.np-bench-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:var(--dsw-radius-sm,8px)}
.np-bench-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.np-bench-ms{flex:none;width:56px;font-size:13px;font-variant-numeric:tabular-nums;text-align:right}
.np-bench-name{flex:none;width:200px;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-bench-sample{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-remove{flex:none;width:24px;height:24px;padding:0;font:inherit;font-size:16px;line-height:1;color:var(--dsw-alias-label-caption);background:transparent;border:none;border-radius:var(--dsw-radius-sm,8px);cursor:pointer}
.np-remove:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.np-remove:disabled{opacity:.5;cursor:default}
.np-tag{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-state-business-tertiary,#3e58d61a);color:var(--dsw-alias-label-primary-bluish,var(--dsw-alias-state-business-primary,#3e58d6))}
.np-btn{flex:none;height:28px;padding:0 12px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:transparent;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm,8px);cursor:pointer;white-space:nowrap}
.np-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.np-btn:disabled{opacity:.5;cursor:default}
.np-segment{flex:none;display:flex;gap:6px}
.np-segment .np-btn{min-width:48px}
.np-segment .np-btn[aria-checked=true]{border-color:var(--dsw-alias-state-business-primary,#3e58d6);color:var(--dsw-alias-label-primary-bluish,var(--dsw-alias-state-business-primary,#3e58d6))}
.np-fast{color:var(--dsw-alias-state-success-primary,#1a9e5a)}.np-mid{color:var(--dsw-alias-state-warning-primary,#c98a00)}.np-slow{color:var(--dsw-alias-state-error-primary,#d33)}
.np-recent{margin-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
.np-empty{padding:16px 8px;text-align:center;font-size:12px;color:var(--dsw-alias-label-caption)}
.np-usage{display:flex;flex-direction:column;padding:0 0 16px;overflow-x:auto}
.np-usage-row{display:flex;align-items:center;gap:10px;padding:6px 8px;font-size:13px;min-width:max-content}
.np-usage-head{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}
.np-usage-total{border-top:.5px solid var(--dsw-alias-border-l2);font-weight:500}
.np-usage-name{flex:1;min-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-usage-num{flex:none;width:72px;text-align:right;font-variant-numeric:tabular-nums}
.np-usage-note{padding:4px 8px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}

.np-own{display:flex;flex-direction:column;gap:8px;padding:0 0 16px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.np-own-item{display:flex;flex-direction:column;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px)}
.np-own-head{display:flex;align-items:center;gap:8px;min-width:0;margin:-12px -14px;padding:12px 14px;cursor:pointer;border-radius:inherit}
.np-own-head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3e58d6);outline-offset:-2px}
.np-own-chevron{transition:transform .15s}
.np-own-item:not([data-open]) .np-own-chevron{transform:rotate(-90deg)}
.np-own-body{display:flex;flex-direction:column;gap:10px;margin-top:12px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l2)}
.np-own-name{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.np-own-note{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-own-tools{flex:none;display:flex;gap:2px}
.np-field{display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;gap:12px}
.np-field-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.np-field-control{display:flex;align-items:center;gap:8px;min-width:0}
.np-field-control a{flex:none;font-size:12px;color:var(--dsw-alias-label-primary-bluish,var(--dsw-alias-state-business-primary,#3e58d6));text-decoration:none}
.np-field-control a:hover{text-decoration:underline}
.np-field .np-picker{flex:1;min-width:0}
.np-field .np-trigger{width:100%;max-width:none;justify-content:space-between}
.np-field .np-menu{left:0;right:auto;width:100%;min-width:240px}
.np-placeholder{color:var(--dsw-alias-label-caption)}
.np-input{width:100%;box-sizing:border-box;height:32px;padding:0 10px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:transparent;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm,8px);outline:none}
.np-input::placeholder{color:var(--dsw-alias-label-caption)}
.np-input:focus{border-color:var(--dsw-alias-state-business-primary,#3e58d6)}
.np-input:disabled{opacity:.5}
.np-own-item .np-error{margin-top:0}
.np-modal-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.4)}
.np-modal{width:min(460px,100%);box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2,#fff);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.16))}
.np-modal-title{font-size:15px;line-height:22px;font-weight:500;margin-bottom:4px}
.np-modal-note{margin:-4px 0 0 84px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
.np-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
.np-btn.np-btn-primary{color:#fff;background:var(--dsw-alias-state-business-primary,#3e58d6);border-color:transparent}
.np-btn.np-btn-primary:hover:not(:disabled){background:var(--dsw-alias-state-business-primary,#3e58d6);opacity:.9}

.np-switch{flex:none;width:36px;height:20px;border-radius:999px;border:none;padding:2px;cursor:pointer;background:var(--dsw-alias-border-l4,#8886);transition:background .15s}
.np-switch[aria-checked=true]{background:var(--dsw-alias-state-business-primary,#3e58d6)}
.np-switch:disabled{opacity:.5;cursor:default}
.np-switch span{display:block;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
.np-switch[aria-checked=true] span{transform:translateX(16px)}
`;
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** Inline fallback geometry, mirroring the composer placeholder's own rule. */
const GHOST_FALLBACK_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: "4px 8px auto 14px",
  color: "var(--dsw-alias-label-caption)",
  pointerEvents: "none",
  userSelect: "none",
  overflow: "hidden",
};

type GhostProps = {
  sessionId: string;
  useSession: <S>(selector: (value: any) => S) => S;
  useInput: <S>(selector: (value: any) => S) => S;
  inputActions: { setDraft(text: string): void };
  locale?: any;
};

/**
 * Lives in `conversation.input.overlay` (inside the composer card) and draws
 * the suggestion as a portal into the editor's own positioning box, styled
 * with the placeholder's class so it sits exactly where the placeholder does.
 * Once the user has typed the suggestion's start, that part is drawn hidden
 * so the rest lines up right after the typed text.
 */
function GhostSuggestion({ sessionId, useSession, useInput, inputActions, locale }: GhostProps) {
  const { t } = useLocale(locale);
  const running: boolean = useSession((s: any) => s?.running === true);
  const draft: string = useInput((s: any) => s?.draft ?? "");
  const phase: string = useInput((s: any) => s?.phase ?? "plain");
  const form = useConfigForm();
  const formValue = React.useSyncExternalStore(
    React.useCallback((listener: () => void) => (form ? form.subscribe(listener) : () => {}), [form]),
    () => form?.getSnapshot()?.value,
  );
  const acceptKey: AcceptKey = formValue?.acceptKey === "tab" ? "tab" : "arrow";

  const [suggestion, setSuggestion] = React.useState<string | null>(null);
  const [complete, setComplete] = React.useState(false);
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const [target, setTarget] = React.useState<{
    card: HTMLElement;
    editable: HTMLElement;
    box: HTMLElement;
    className: string;
  } | null>(null);

  // The user pressed Esc: no suggestion for this turn.
  const retiredRef = React.useRef(false);
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  const suggestionRef = React.useRef(suggestion);
  suggestionRef.current = suggestion;
  /** The stream currently feeding the ghost, if any. */
  const streamRef = React.useRef<object | null>(null);

  /** Start a fresh turn: forget the old suggestion and its stream. */
  const reset = () => {
    retiredRef.current = false;
    suggestionRef.current = null;
    streamRef.current = null;
    setSuggestion(null);
  };

  /** Drop the suggestion for the rest of this turn, and stop the Host paying for it. */
  const retire = React.useCallback(() => {
    if (retiredRef.current) return;
    retiredRef.current = true;
    if (streamRef.current || suggestionRef.current) dismissSuggestion(sessionId);
    setSuggestion(null);
  }, [sessionId]);

  const fetchFor = React.useCallback(
    (generate: boolean, signal: AbortSignal) => {
      const token = {};
      streamRef.current = token;
      setComplete(false);
      const show = (text: string | null, done: boolean) => {
        if (signal.aborted || retiredRef.current) return;
        setSuggestion(text);
        setComplete(done);
      };
      streamSuggestion(sessionId, generate, signal, (partial) => show(partial, false))
        .then((final) => {
          if (streamRef.current === token) streamRef.current = null;
          show(final, true);
        })
        .catch(() => {
          if (streamRef.current === token) streamRef.current = null;
        });
    },
    [sessionId],
  );

  // A session opened idle may already have an answer (or one in flight) on
  // the Host; read it without starting a new model call.
  React.useEffect(() => {
    reset();
    if (running) return;
    const controller = new AbortController();
    fetchFor(false, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Every running → idle edge is a finished turn. The Host usually started
  // this prediction already (at the final reply); this joins its stream.
  const wasRunning = React.useRef(running);
  React.useEffect(() => {
    const prev = wasRunning.current;
    wasRunning.current = running;
    if (running) {
      setSuggestion(null);
      // Keep the Host's watch fresh so this turn's prediction starts early.
      if (!prev) notifyHost(WATCH_PATH, sessionId);
      return;
    }
    if (!prev) return;
    reset();
    const controller = new AbortController();
    fetchFor(true, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, fetchFor]);

  // Off the suggestion's path it just hides; deleting back onto the path shows it again.
  const typed = normalizeDraft(draft);
  const rest = suggestion && onPath(typed, suggestion, complete) ? suggestion.slice(typed.length) : "";
  const visible = rest !== "" && phase === "plain" && !running;

  // Locate the editor box each time a suggestion is about to show; the
  // composer may have re-mounted since the last one.
  React.useLayoutEffect(() => {
    if (!visible) {
      setTarget(null);
      return;
    }
    const card = anchorRef.current?.closest<HTMLElement>("[data-composer-card]");
    const editable = card?.querySelector<HTMLElement>("[contenteditable]");
    const box = editable?.parentElement;
    if (!card || !editable || !box) return;
    const placeholder = box.querySelector<HTMLElement>("[data-composer-placeholder]");
    ensureStyle();
    setTarget({ card, editable, box, className: placeholder?.className ?? "" });
  }, [visible]);

  React.useEffect(() => {
    if (!target) return;
    target.card.setAttribute("data-next-prompt-active", "");
    return () => target.card.removeAttribute("data-next-prompt-active");
  }, [target]);

  // Accept the whole suggestion, or just its next word.
  const acceptRef = React.useRef<(word: boolean) => boolean>(() => false);
  acceptRef.current = (word) => {
    if (!visible || !target || !suggestion) return false;
    // The typed prefix stays as typed (its case may differ from the suggestion's).
    const text = typed + (word ? nextWord(rest) : rest);
    const { editable } = target;
    // Kept even when accepted whole: deleting the text back brings the ghost back.
    inputActions.setDraft(text);
    requestAnimationFrame(() => {
      editable.focus();
      const selection = window.getSelection();
      if (!selection) return;
      selection.selectAllChildren(editable);
      selection.collapseToEnd();
    });
    return true;
  };
  const acceptKeyRef = React.useRef(acceptKey);
  acceptKeyRef.current = acceptKey;
  // Keys are captured on the card so they run before the editor's keymap.
  React.useEffect(() => {
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (!(event.target instanceof Node) || !target.editable.contains(event.target)) return;
      if (event.shiftKey || event.metaKey) return;
      const modified = event.ctrlKey || event.altKey;
      let handled = false;
      if (event.key === "Escape" && !modified) {
        retire();
        handled = true;
      } else {
        const whole = !modified && event.key === (acceptKeyRef.current === "tab" ? "Tab" : "ArrowRight");
        const word = modified && event.key === "ArrowRight";
        // Mid-draft, the keys keep their usual meaning unless the caret is at the end.
        if ((whole || word) && (draftRef.current === "" || caretAtEnd(target.editable))) {
          handled = acceptRef.current(word);
        }
      }
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
    };
    target.card.addEventListener("keydown", onKeyDown, true);
    return () => target.card.removeEventListener("keydown", onKeyDown, true);
  }, [target, retire]);

  return (
    <>
      <span ref={anchorRef} hidden />
      {visible && target && suggestion
        ? createPortal(
            <div
              aria-hidden
              data-next-prompt-ghost=""
              className={target.className || undefined}
              style={target.className ? undefined : GHOST_FALLBACK_STYLE}
            >
              {typed ? <span style={{ visibility: "hidden" }}>{typed}</span> : null}
              {rest}
              {complete ? (
                <kbd
                  // Keep focus in the editor; a click or tap accepts (touch screens have no → key).
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => acceptRef.current(false)}
                >
                  {t("ghost.accept", { key: KEY_LABEL[acceptKey] })}
                </kbd>
              ) : null}
            </div>,
            target.box,
          )
        : null}
    </>
  );
}

type ModelRow = { provider: string; providerName: string; model: string; name: string };

/** Mirrors the Host's PRESETS and OwnProvider. */
type PresetId = "modelscope" | "siliconflow" | "agnes" | "deepseek" | "spark";
type Preset = { name: string; baseURL: string; keyUrl: string; models: { id: string }[] };
type OwnProvider = {
  id: string;
  preset: PresetId | "custom";
  name: string;
  baseURL: string;
  models: string[];
  extraBody: string;
};
type Failure = { provider: string; model: string; error: string; retryAt: number };
/** Which side predictions come from; neither falls back to the other. */
type Source = "dsh" | "own";
const OWN_PREFIX = "np:";

type FormSnapshot = {
  status: "loading" | "ready" | "unavailable";
  value?: { enabled?: boolean; source?: Source; ownProviders?: OwnProvider[]; ownProvider?: string; ownModel?: string; provider?: string; model?: string; acceptKey?: AcceptKey };
  writable?: boolean;
};

const FOLLOW = "";
const routeKey = (provider: string, model: string) =>
  provider && model ? `${provider}\u0000${model}` : FOLLOW;

/** dsh's own Switch when the UI kit is there, a look-alike otherwise. */
function Toggle({ checked, disabled, label, onChange }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  if (ui.Switch) return <ui.Switch checked={checked} disabled={disabled} label={label} onChange={onChange} />;
  return (
    <button
      type="button"
      role="switch"
      className="np-switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

const Icon = ({ name, fallback }: { name: string; fallback: string }) => {
  const Component = ui[name];
  return Component ? <Component size={14} /> : <span style={{ fontSize: 12, lineHeight: 1 }}>{fallback}</span>;
};

/** The ghost as it will look in the composer, so the setting explains itself. */
function Preview({ t, dim, acceptKey }: { t: Translate; dim: boolean; acceptKey: AcceptKey }) {
  return (
    <div className="np-preview" style={dim ? { opacity: 0.45 } : undefined} aria-hidden>
      <div className="np-preview-line">
        <span className="np-caret" />
        <span className="np-ghost">{t("card.preview.suggestion")}</span>
        <span className="np-key">{KEY_LABEL[acceptKey]}</span>
      </div>
      <div className="np-preview-caption">
        {t("card.preview.caption", { key: KEY_LABEL[acceptKey], word: WORD_KEY_LABEL })}
      </div>
    </div>
  );
}

/** Mirrors the Host's Timing record. */
type Timing = {
  route: { provider: string; model: string };
  totalMs: number;
  reasoningChars: number;
};

/** Mirrors the Host's per-route UsageTotals. */
type UsageRow = {
  provider: string;
  model: string;
  calls: number;
  reported: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};
type UsageReport = { since: number; models: UsageRow[] };

const formatTokens = (n: number) =>
  n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`;

/** Calls and tokens per model, most input first, with a total row. */
function UsageTable({ t, usage, models }: { t: Translate; usage: UsageReport; models: ModelRow[] | null }) {
  const rows = [...usage.models].sort(
    (a, b) => b.inputTokens + b.cacheReadTokens - (a.inputTokens + a.cacheReadTokens),
  );
  if (!rows.length) return <div className="np-usage-note">{t("card.usage.empty")}</div>;
  const total = rows.reduce(
    (sum, row) => ({
      calls: sum.calls + row.calls,
      reported: sum.reported + row.reported,
      inputTokens: sum.inputTokens + row.inputTokens + row.cacheWriteTokens,
      cacheReadTokens: sum.cacheReadTokens + row.cacheReadTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      reasoningTokens: sum.reasoningTokens + row.reasoningTokens,
    }),
    { calls: 0, reported: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0 },
  );
  const num = (n: number, title?: string) => (
    <span className="np-usage-num" title={title ?? n.toLocaleString()}>{formatTokens(n)}</span>
  );
  const output = (out: number, reasoning: number) =>
    num(out, reasoning ? `${out.toLocaleString()} (${t("card.usage.reasoning", { tokens: reasoning.toLocaleString() })})` : undefined);
  return (
    <div className="np-usage">
      <div className="np-usage-row np-usage-head">
        <span className="np-usage-name">{t("card.usage.model")}</span>
        <span className="np-usage-num">{t("card.usage.calls")}</span>
        <span className="np-usage-num">{t("card.usage.input")}</span>
        <span className="np-usage-num">{t("card.usage.cached")}</span>
        <span className="np-usage-num">{t("card.usage.output")}</span>
      </div>
      {rows.map((row) => {
        const name = models?.find((m) => m.provider === row.provider && m.model === row.model)?.name ?? row.model;
        return (
          <div className="np-usage-row" key={routeKey(row.provider, row.model)}>
            <span className="np-usage-name" title={`${row.provider} / ${row.model}`}>{name}</span>
            <span className="np-usage-num">{row.reported}</span>
            {/* Cache writes are billed as input; fold them in rather than add a column. */}
            {num(row.inputTokens + row.cacheWriteTokens)}
            {num(row.cacheReadTokens)}
            {output(row.outputTokens, row.reasoningTokens)}
          </div>
        );
      })}
      {rows.length > 1 ? (
        <div className="np-usage-row np-usage-total">
          <span className="np-usage-name">{t("card.usage.total")}</span>
          <span className="np-usage-num">{total.reported}</span>
          {num(total.inputTokens)}
          {num(total.cacheReadTokens)}
          {output(total.outputTokens, total.reasoningTokens)}
        </div>
      ) : null}
      {total.calls > total.reported ? (
        <div className="np-usage-note">{t("card.usage.unreported", { count: String(total.calls - total.reported) })}</div>
      ) : null}
    </div>
  );
}

type BenchResult = { ms?: number; suggestion?: string | null; thinkChars?: number; error?: string };
/** Speed-test results keyed by {@link routeKey}. */
type BenchResults = Record<string, BenchResult>;

/** Last speed test, remembered per browser; storage may be unavailable. */
function loadBench(): BenchResults {
  try {
    return JSON.parse(localStorage.getItem(BENCH_STORAGE) || "{}") ?? {};
  } catch {
    return {};
  }
}
function saveBench(results: BenchResults) {
  try {
    localStorage.setItem(BENCH_STORAGE, JSON.stringify(results));
  } catch {}
}
/** Which models the speed test runs on, as {@link routeKey}s. */
function loadBenchPick(): string[] {
  try {
    const keys = JSON.parse(localStorage.getItem(BENCH_PICK_STORAGE) || "[]");
    return Array.isArray(keys) ? keys : [];
  } catch {
    return [];
  }
}
function saveBenchPick(keys: string[]) {
  try {
    localStorage.setItem(BENCH_PICK_STORAGE, JSON.stringify(keys));
  } catch {}
}

const formatMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`);
/** Under 1s feels instant next to a finished reply; over 3s the user is already typing. */
const speedClass = (ms: number) => (ms < 1000 ? "np-fast" : ms < 3000 ? "np-mid" : "np-slow");

function SpeedLabel({ t, result }: { t: Translate; result: BenchResult }) {
  if (result.ms === undefined) return <span className="np-option-sub np-slow">{t("card.bench.failed")}</span>;
  return <span className={`np-option-sub ${speedClass(result.ms)}`}>{formatMs(result.ms)}</span>;
}

/** Open/close state for a popover under `rootRef`; a pointer outside it or Esc closes it. */
function usePopover(rootRef: React.RefObject<HTMLElement | null>) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, rootRef]);
  return [open, setOpen] as const;
}

function ModelOption({ t, checked, name, sub, speed, onClick }: {
  t: Translate;
  checked: boolean;
  name: string;
  sub?: string;
  speed?: BenchResult;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      className="np-option"
      data-active={checked ? "" : undefined}
      onClick={onClick}
    >
      <span className="np-check">{checked ? <Icon name="IconCheckOutlineRegular" fallback="✓" /> : null}</span>
      <span className="np-option-text">
        <div className="np-option-name">{name}</div>
        {sub ? <div className="np-option-sub">{sub}</div> : null}
      </span>
      {speed ? <SpeedLabel t={t} result={speed} /> : null}
    </button>
  );
}

/**
 * Search box over the models, grouped by provider. `head` gives the extra
 * options above the groups for the current query; `toolbar` sits under the
 * search box and sees the rows that match it.
 */
function ModelMenu({ t, models, bench, multi, isChecked, onPick, head, toolbar }: {
  t: Translate;
  models: ModelRow[] | null;
  bench: BenchResults;
  multi?: boolean;
  isChecked: (key: string) => boolean;
  onPick: (key: string) => void;
  head?: (q: string) => React.ReactNode[];
  toolbar?: (matches: ModelRow[]) => React.ReactNode;
}) {
  const [query, setQuery] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (models ?? []).filter(
    (r) => !q || `${r.name} ${r.model} ${r.providerName} ${r.provider}`.toLowerCase().includes(q),
  );
  const groups: { provider: string; providerName: string; rows: ModelRow[] }[] = [];
  for (const row of matches) {
    let group = groups.find((g) => g.provider === row.provider);
    if (!group) groups.push((group = { provider: row.provider, providerName: row.providerName, rows: [] }));
    group.rows.push(row);
  }
  const extra = head?.(q) ?? [];

  return (
    <div className="np-menu" role="listbox" aria-multiselectable={multi || undefined}>
      <div className="np-search">
        <Icon name="IconSearchOutlineRegular" fallback="⌕" />
        <input
          ref={searchRef}
          value={query}
          placeholder={t("card.model.search")}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {toolbar && models?.length ? <div className="np-menu-toolbar">{toolbar(matches)}</div> : null}
      <div className="np-list">
        {extra}
        {models === null ? <div className="np-empty">{t("card.model.loading")}</div> : null}
        {groups.map((group) => (
          <React.Fragment key={group.provider}>
            <div className="np-group">
              {group.providerName || group.provider}
              {group.provider.startsWith(OWN_PREFIX) ? ` · ${t("card.own.tag")}` : null}
            </div>
            {group.rows.map((row) => {
              const key = routeKey(row.provider, row.model);
              return (
                <ModelOption
                  key={key}
                  t={t}
                  checked={isChecked(key)}
                  name={row.name}
                  sub={row.name !== row.model ? row.model : undefined}
                  speed={bench[key]}
                  onClick={() => onPick(key)}
                />
              );
            })}
          </React.Fragment>
        ))}
        {models !== null && q && groups.length === 0 && extra.length === 0 ? (
          <div className="np-empty">{t("card.model.empty")}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Single-select model menu: a default option first ("follow the session", or
 * `follow` for another meaning of no model picked), then models grouped by provider.
 */
function ModelPicker({ t, models, selected, provider, model, disabled, onSelect, bench, follow }: {
  bench: BenchResults;
  t: Translate;
  follow?: { name: string; hint: string };
  models: ModelRow[] | null;
  selected: string;
  provider: string;
  model: string;
  disabled: boolean;
  onSelect: (key: string) => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = usePopover(rootRef);
  const followName = follow?.name ?? t("card.model.follow");

  const current = (models ?? []).find((r) => routeKey(r.provider, r.model) === selected);
  const label =
    selected === FOLLOW ? followName : current ? current.name : `${provider} / ${model}`;
  const currentMs = bench[selected]?.ms;

  const pick = (key: string) => {
    setOpen(false);
    if (key !== selected) onSelect(key);
  };

  const head = (q: string) => {
    const out: React.ReactNode[] = [];
    if (!q || followName.toLowerCase().includes(q)) {
      out.push(
        <ModelOption
          key="follow"
          t={t}
          checked={selected === FOLLOW}
          name={followName}
          sub={follow?.hint ?? t("card.model.follow.hint")}
          onClick={() => pick(FOLLOW)}
        />,
      );
    }
    if (selected !== FOLLOW && !current && !q) {
      out.push(
        <ModelOption
          key={selected}
          t={t}
          checked
          name={`${provider} / ${model}`}
          sub={t("card.model.missing")}
          onClick={() => pick(selected)}
        />,
      );
    }
    return out;
  };

  return (
    <div className="np-picker" ref={rootRef}>
      <button
        type="button"
        className="np-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={label}
      >
        <span className="np-trigger-label">{label}</span>
        {currentMs !== undefined ? <span className={`np-option-sub ${speedClass(currentMs)}`}>{formatMs(currentMs)}</span> : null}
        <span className="np-chevron">
          <Icon name="IconChevronDownOutlineRegular" fallback="▾" />
        </span>
      </button>
      {open ? (
        <ModelMenu
          t={t}
          models={models}
          bench={bench}
          isChecked={(key) => key === selected}
          onPick={pick}
          head={head}
        />
      ) : null}
    </div>
  );
}

/** Multi-select menu for the speed test; it stays open while models are ticked. */
function BenchPicker({ t, models, picked, disabled, onChange, bench }: {
  t: Translate;
  models: ModelRow[] | null;
  picked: string[];
  disabled: boolean;
  onChange: (keys: string[]) => void;
  bench: BenchResults;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = usePopover(rootRef);
  const toggle = (key: string) =>
    onChange(picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key]);

  return (
    <div className="np-picker" ref={rootRef}>
      <button
        type="button"
        className="np-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="np-trigger-label">{t("card.bench.pick", { count: String(picked.length) })}</span>
        <span className="np-chevron">
          <Icon name="IconChevronDownOutlineRegular" fallback="▾" />
        </span>
      </button>
      {open ? (
        <ModelMenu
          t={t}
          models={models}
          bench={bench}
          multi
          isChecked={(key) => picked.includes(key)}
          onPick={toggle}
          toolbar={(matches) => (
            <>
              <button
                type="button"
                className="np-btn"
                disabled={!matches.length}
                // Ticks what the search shows: while searching, "all" means all matches.
                onClick={() =>
                  onChange([...new Set([...picked, ...matches.map((row) => routeKey(row.provider, row.model))])])
                }
              >
                {t("card.bench.all")}
              </button>
              <button type="button" className="np-btn" disabled={!picked.length} onClick={() => onChange([])}>
                {t("card.bench.clear")}
              </button>
            </>
          )}
        />
      ) : null}
    </div>
  );
}

const validExtra = (text: string) => {
  if (!text.trim()) return true;
  try {
    const value = JSON.parse(text);
    return !!value && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
};

/** Whether the Host will call this provider: mirrors its `ownTargets` filter. */
const ownReady = (p: OwnProvider, keyed: readonly string[]) =>
  keyed.includes(p.id) && (p.preset !== "custom" || !!p.baseURL.trim()) && p.models.some((m) => m.trim());

/** A text box that saves when it loses focus or on Enter, not on every keystroke. */
function TextField({ value, placeholder, secret, disabled, onCommit }: {
  value: string;
  placeholder: string;
  secret?: boolean;
  disabled: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
    // A saved secret is write-only: its box goes back to what the parent holds.
    if (secret) setDraft(value);
  };
  return (
    <input
      className="np-input"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      type={secret ? "password" : "text"}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      // Blurring commits, so Enter can't save the same draft twice.
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

/** A label on the left, its control on the right. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="np-field">
      <span className="np-field-label">{label}</span>
      <div className="np-field-control">{children}</div>
    </div>
  );
}

/** A plain dropdown; with `multi` it stays open while options are ticked. */
function Dropdown({ t, label, placeholder, options, isChecked, onPick, multi, disabled }: {
  t: Translate;
  label: string;
  placeholder?: string;
  options: { id: string; name: string; sub?: string }[];
  isChecked: (id: string) => boolean;
  onPick: (id: string) => void;
  multi?: boolean;
  disabled?: boolean;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = usePopover(rootRef);
  const pick = (id: string) => {
    if (!multi) setOpen(false);
    onPick(id);
  };
  return (
    <div className="np-picker" ref={rootRef}>
      <button
        type="button"
        className="np-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={label || undefined}
      >
        <span className={`np-trigger-label${label ? "" : " np-placeholder"}`}>{label || placeholder}</span>
        <span className="np-chevron">
          <Icon name="IconChevronDownOutlineRegular" fallback="▾" />
        </span>
      </button>
      {open ? (
        <div className="np-menu" role="listbox" aria-multiselectable={multi || undefined}>
          <div className="np-list">
            {options.map((o) => (
              <ModelOption key={o.id} t={t} checked={isChecked(o.id)} name={o.name} sub={o.sub} onClick={() => pick(o.id)} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One provider's settings, shared by the add dialog and an expanded row. */
function ProviderFields({ t, provider: p, preset, apiKey, keyPlaceholder, disabled, onPatch, onKey }: {
  t: Translate;
  provider: OwnProvider;
  preset?: Preset;
  /** What the key box holds: the dialog's draft, or "" for a saved key the browser never sees. */
  apiKey: string;
  keyPlaceholder: string;
  disabled: boolean;
  onPatch: (patch: Partial<OwnProvider>) => void;
  onKey: (key: string) => void;
}) {
  const ids = preset?.models.map((m) => m.id) ?? [];
  return (
    <>
      {preset ? null : (
        <>
          <Field label={t("card.own.name")}>
            <TextField value={p.name} placeholder={t("card.own.custom")} disabled={disabled}
              onCommit={(name) => onPatch({ name })} />
          </Field>
          <Field label={t("card.own.baseURL")}>
            <TextField value={p.baseURL} placeholder="https://example.com/v1" disabled={disabled}
              onCommit={(baseURL) => onPatch({ baseURL: baseURL.trim() })} />
          </Field>
        </>
      )}
      <Field label={t("card.own.key")}>
        <TextField value={apiKey} placeholder={keyPlaceholder} secret disabled={disabled}
          onCommit={(key) => key.trim() && onKey(key.trim())} />
        {preset ? <a href={preset.keyUrl} target="_blank" rel="noreferrer">{t("card.own.getKey")}</a> : null}
      </Field>
      <Field label={t("card.own.models")}>
        {preset ? (
          <Dropdown
            t={t}
            multi
            label={p.models.join(", ")}
            placeholder={t("card.own.pickModels")}
            options={ids.map((id) => ({ id, name: id }))}
            isChecked={(id) => p.models.includes(id)}
            // Kept in the preset's order, which is best first.
            onPick={(id) => onPatch({ models: ids.filter((m) => (m === id) !== p.models.includes(m)) })}
            disabled={disabled}
          />
        ) : (
          <TextField value={p.models.join(", ")} placeholder={t("card.own.modelIds")} disabled={disabled}
            onCommit={(text) => onPatch({ models: text.split(/[,，\s]+/).filter(Boolean) })} />
        )}
      </Field>
      {preset ? null : (
        <Field label={t("card.own.extra")}>
          <TextField value={p.extraBody} placeholder='{"enable_thinking": false}' disabled={disabled}
            onCommit={(extraBody) => onPatch({ extraBody })} />
        </Field>
      )}
      {validExtra(p.extraBody) ? null : <div className="np-error">{t("card.own.extraInvalid")}</div>}
    </>
  );
}

/** Modal for adding a provider: pick it, its models and the key, then add it in one go. */
function AddProviderDialog({ t, presets, free, onCancel, onAdd }: {
  t: Translate;
  presets: Record<PresetId, Preset>;
  free: PresetId[];
  onCancel: () => void;
  onAdd: (provider: OwnProvider, key: string) => void;
}) {
  const fresh = (preset: PresetId | "custom"): OwnProvider => ({
    id: preset === "custom" ? `custom-${Date.now().toString(36)}` : preset,
    preset,
    name: "",
    baseURL: "",
    models: preset === "custom" ? [] : [presets[preset].models[0].id],
    extraBody: "",
  });
  const [draft, setDraft] = React.useState(() => fresh(free[0] ?? "custom"));
  const [key, setKey] = React.useState("");
  const [tried, setTried] = React.useState(false);
  const preset = draft.preset === "custom" ? undefined : presets[draft.preset];
  const ready = !!key && ownReady(draft, [draft.id]) && validExtra(draft.extraBody);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const options = [
    ...free.map((id) => ({ id, name: presets[id].name, sub: t(`preset.${id}` as TKey) })),
    { id: "custom", name: t("card.own.custom") },
  ];

  return createPortal(
    <div className="np-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="np-modal" role="dialog" aria-modal="true" aria-label={t("card.own.addTitle")}>
        <div className="np-modal-title">{t("card.own.addTitle")}</div>
        <Field label={t("card.own.provider")}>
          <Dropdown
            t={t}
            label={preset?.name ?? t("card.own.custom")}
            options={options}
            isChecked={(id) => id === draft.preset}
            onPick={(id) => id !== draft.preset && setDraft(fresh(id as PresetId | "custom"))}
          />
        </Field>
        {preset ? <div className="np-modal-note">{t(`preset.${draft.preset as PresetId}` as TKey)}</div> : null}
        <ProviderFields
          t={t}
          provider={draft}
          preset={preset}
          apiKey={key}
          keyPlaceholder={t("card.own.keyPlaceholder")}
          disabled={false}
          onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          onKey={setKey}
        />
        {tried && !ready ? <div className="np-error">{t("card.own.required")}</div> : null}
        <div className="np-modal-actions">
          <button type="button" className="np-btn np-btn-tall" onClick={onCancel}>{t("card.cancel")}</button>
          <button
            type="button"
            className="np-btn np-btn-tall np-btn-primary"
            // Not disabled while incomplete: a click first blurs the field being typed in, which saves it.
            onClick={() => (ready ? onAdd(draft, key) : setTried(true))}
          >
            {t("card.own.confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The custom providers: one collapsed row each, expanded to edit; "+ Add" opens a dialog. */
function OwnProviders({ t, presets, providers, keyed, failures, disabled, onChange, onKey, onAdd }: {
  t: Translate;
  presets: Record<PresetId, Preset> | null;
  providers: OwnProvider[];
  /** Ids of the providers that have a key; the keys themselves never reach the browser. */
  keyed: string[];
  failures: Failure[];
  disabled: boolean;
  onChange: (next: OwnProvider[]) => void;
  onKey: (id: string, key: string) => void;
  onAdd: (provider: OwnProvider, key: string) => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const update = (index: number, patch: Partial<OwnProvider>) =>
    onChange(providers.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const move = (index: number, by: number) => {
    const next = [...providers];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };
  const free = presets
    ? (Object.keys(presets) as PresetId[]).filter((id) => !providers.some((p) => p.preset === id))
    : [];
  const cancel = React.useCallback(() => setAdding(false), []);
  const now = Date.now();

  return (
    <div>
      <div className="np-row" style={providers.length ? { borderBottom: "none" } : undefined}>
        <div className="np-text">
          <div className="np-title">{t("card.own")}</div>
          <div className="np-desc">{t("card.own.hint")}</div>
        </div>
        <button type="button" className="np-btn np-btn-tall" disabled={disabled || !presets} onClick={() => setAdding(true)}>
          + {t("card.own.add")}
        </button>
      </div>
      {providers.length ? (
        <div className="np-own">
          {providers.map((p, index) => {
            const preset = p.preset === "custom" ? undefined : presets?.[p.preset];
            const own = failures.filter((f) => f.provider === `${OWN_PREFIX}${p.id}`);
            const open = expanded === p.id;
            const ready = ownReady(p, keyed);
            const toggle = () => setExpanded(open ? null : p.id);
            return (
              <div className="np-own-item" key={p.id} data-open={open ? "" : undefined}>
                <div
                  className="np-own-head"
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={toggle}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), toggle())}
                >
                  <span className="np-chevron np-own-chevron">
                    <Icon name="IconChevronDownOutlineRegular" fallback="▾" />
                  </span>
                  <span className="np-own-name">{preset?.name ?? (p.name || t("card.own.custom"))}</span>
                  <span className={`np-own-note${ready && own.length ? " np-slow" : ""}`}>
                    {!ready
                      ? t("card.own.incomplete")
                      : own.length
                        ? t("card.own.errors", { n: String(own.length) })
                        : p.models.join(", ")}
                  </span>
                  <span className="np-own-tools" onClick={(e) => e.stopPropagation()}>
                    {providers.length > 1 ? (
                      <>
                        <button type="button" className="np-remove" title={t("card.own.up")} aria-label={t("card.own.up")}
                          disabled={disabled || index === 0} onClick={() => move(index, -1)}>↑</button>
                        <button type="button" className="np-remove" title={t("card.own.down")} aria-label={t("card.own.down")}
                          disabled={disabled || index === providers.length - 1} onClick={() => move(index, 1)}>↓</button>
                      </>
                    ) : null}
                    <button type="button" className="np-remove" title={t("card.own.remove")} aria-label={t("card.own.remove")}
                      disabled={disabled} onClick={() => onChange(providers.filter((_, i) => i !== index))}>×</button>
                  </span>
                </div>
                {open ? (
                  <div className="np-own-body">
                    <ProviderFields
                      t={t}
                      provider={p}
                      preset={preset}
                      apiKey=""
                      keyPlaceholder={t(keyed.includes(p.id) ? "card.own.keySet" : "card.own.keyPlaceholder")}
                      disabled={disabled}
                      onPatch={(patch) => update(index, patch)}
                      onKey={(key) => onKey(p.id, key)}
                    />
                    {own.map((f) => (
                      <div className="np-error" key={f.model}>
                        {t("card.own.failed", { model: f.model, error: f.error, time: t("card.own.minutes", { n: String(Math.max(1, Math.ceil((f.retryAt - now) / 60_000))) }) })}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {adding && presets ? (
        <AddProviderDialog
          t={t}
          presets={presets}
          free={free}
          onCancel={cancel}
          onAdd={(provider, key) => {
            setAdding(false);
            onAdd(provider, key);
          }}
        />
      ) : null}
    </div>
  );
}

function SettingsCard({ form, locale }: { form: any; locale?: any }) {
  const { t, lang } = useLocale(locale);
  React.useLayoutEffect(ensureStyle, []);
  const snapshot: FormSnapshot = React.useSyncExternalStore(
    React.useCallback((listener: () => void) => form.subscribe(listener), [form]),
    () => form.getSnapshot(),
  );
  const [models, setModels] = React.useState<ModelRow[] | null>(null);
  const [modelsError, setModelsError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [bench, setBench] = React.useState<BenchResults>(loadBench);
  const [benchProgress, setBenchProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [benchPick, setBenchPick] = React.useState<string[]>(loadBenchPick);
  const [recent, setRecent] = React.useState<Timing | null | undefined>(undefined);
  const [usage, setUsage] = React.useState<UsageReport | null>(null);
  const [presets, setPresets] = React.useState<Record<PresetId, Preset> | null>(null);
  const [failures, setFailures] = React.useState<Failure[]>([]);
  const [keyed, setKeyed] = React.useState<string[]>([]);
  // Own models show up in the model list, so it is reloaded whenever they
  // change; a key write bumps `keysWritten`, since keys never show in the form.
  const ownJson = JSON.stringify(snapshot.value?.ownProviders ?? []);
  const [keysWritten, setKeysWritten] = React.useState(0);

  // The last real prediction's timing, so a slow model shows up as slow, and the token usage so far.
  const liveRef = React.useRef(true);
  const refreshStats = React.useCallback(() => {
    fetch(BENCH_PATH, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
      .then((res) => res.json())
      .then((body) => {
        if (!liveRef.current) return;
        setRecent(body?.recent?.[body.recent.length - 1] ?? null);
        setUsage(body?.usage ?? null);
        setFailures(body?.failures ?? []);
      })
      .catch(() => liveRef.current && setRecent(null));
  }, []);
  React.useEffect(() => {
    liveRef.current = true;
    refreshStats();
    return () => {
      liveRef.current = false;
    };
  }, [refreshStats]);

  React.useEffect(() => {
    let live = true;
    fetch(MODELS_PATH, { cache: "no-store", credentials: "same-origin" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (!live) return;
        setModels(body.models ?? []);
        setPresets(body.presets ?? null);
        setKeyed(body.keyed ?? []);
      })
      .catch((error) => {
        if (!live) return;
        setModels([]);
        setModelsError(String(error?.message ?? error));
      });
    return () => {
      live = false;
    };
  }, [ownJson, keysWritten]);

  if (snapshot.status === "unavailable") {
    return (
      <div className="np-card">
        <div className="np-desc">{t("card.unavailable")}</div>
      </div>
    );
  }

  const value = snapshot.value ?? {};
  const enabled = value.enabled !== false;
  const provider = value.provider ?? "";
  const model = value.model ?? "";
  const selected = routeKey(provider, model);
  const acceptKey: AcceptKey = value.acceptKey === "tab" ? "tab" : "arrow";
  const ownProviders = value.ownProviders ?? [];
  const source: Source = value.source === "own" ? "own" : "dsh";
  const ownProvider = value.ownProvider ?? "";
  const ownModel = value.ownModel ?? "";
  const ownSelected = routeKey(ownProvider && `${OWN_PREFIX}${ownProvider}`, ownModel);
  const inUse = source === "own" ? ownSelected : selected;
  const dshModels = models && models.filter((row) => !row.provider.startsWith(OWN_PREFIX));
  const ownModels = models && models.filter((row) => row.provider.startsWith(OWN_PREFIX));
  const disabled = snapshot.status !== "ready" || snapshot.writable === false || saving;

  const write = async (ops: Array<[string, unknown]>) => {
    setSaving(true);
    setFailed(false);
    try {
      let ok = true;
      for (const [field, next] of ops) {
        ok = (next === undefined ? await form.unset(field) : await form.set(field, next)) && ok;
      }
      if (!ok) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const onModel = (key: string) => {
    if (key === FOLLOW) {
      void write([["provider", undefined], ["model", undefined]]);
      return;
    }
    const [p, m] = key.split("\u0000");
    // The speed test can pick a dsh model while custom ones are in use; that switches back.
    void write([["provider", p], ["model", m], ["source", undefined]]);
  };

  const onOwnModel = (key: string) => {
    if (key === FOLLOW) {
      void write([["ownProvider", undefined], ["ownModel", undefined]]);
      return;
    }
    const [p, m] = key.split("\u0000");
    void write([["ownProvider", p.slice(OWN_PREFIX.length)], ["ownModel", m], ["source", "own"]]);
  };

  /** Path-addressed writes, so a secret the form never sees is set or dropped without restating the others. */
  const writePaths = async (ops: Array<{ op: "set" | "unset"; path: string[]; value?: unknown }>) => {
    setSaving(true);
    setFailed(false);
    try {
      if (!(await form.mutate(ops))) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const onOwn = async (next: OwnProvider[]) => {
    // The default is none, so emptying the list clears the override; a
    // removed provider's key goes with it.
    const dropped = keyed.filter((id) => !next.some((p) => p.id === id));
    // A picked model that is gone goes back to automatic.
    const unpin = !!ownProvider && !next.some((p) => p.id === ownProvider && p.models.includes(ownModel));
    await writePaths([
      next.length ? { op: "set", path: ["ownProviders"], value: next } : { op: "unset", path: ["ownProviders"] },
      ...dropped.map((id) => ({ op: "unset" as const, path: ["apiKeys", id] })),
      ...(unpin ? [{ op: "unset" as const, path: ["ownProvider"] }, { op: "unset" as const, path: ["ownModel"] }] : []),
    ]);
    if (dropped.length) setKeysWritten((n) => n + 1);
    refreshStats();
  };

  const onKey = async (id: string, key: string) => {
    await writePaths([{ op: "set", path: ["apiKeys", id], value: key }]);
    setKeysWritten((n) => n + 1);
    refreshStats();
  };

  const onAddOwn = async (added: OwnProvider, key: string) => {
    await writePaths([
      { op: "set", path: ["ownProviders"], value: [...ownProviders, added] },
      { op: "set", path: ["apiKeys", added.id], value: key },
    ]);
    setKeysWritten((n) => n + 1);
    refreshStats();
  };

  const pickBench = (keys: string[]) => {
    setBenchPick(keys);
    saveBenchPick(keys);
  };
  const pickedRows = (models ?? []).filter((row) => benchPick.includes(routeKey(row.provider, row.model)));

  // Two at a time: fast enough, and gentle on per-provider rate limits.
  // Only the picked models are called; earlier results for the others stay.
  const runBench = async () => {
    const rows = pickedRows;
    if (!rows.length || benchProgress) return;
    const results: BenchResults = { ...bench };
    for (const row of rows) delete results[routeKey(row.provider, row.model)];
    let done = 0;
    setBench({ ...results });
    setBenchProgress({ done, total: rows.length });
    const queue = [...rows];
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        const key = routeKey(row.provider, row.model);
        try {
          const res = await fetch(BENCH_PATH, {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            // The sample conversation follows the UI language, so the prediction does too.
            body: JSON.stringify({ provider: row.provider, model: row.model, lang }),
          });
          const body = await res.json();
          if (body.usage) setUsage(body.usage);
          results[key] = body.error
            ? { error: String(body.error) }
            : { ms: body.timing?.totalMs, suggestion: body.suggestion ?? null, thinkChars: body.timing?.reasoningChars ?? 0 };
        } catch (error: any) {
          results[key] = { error: String(error?.message ?? error) };
        }
        setBench({ ...results });
        setBenchProgress({ done: ++done, total: rows.length });
      }
    };
    await Promise.all([worker(), worker()]);
    saveBench(results);
    setBenchProgress(null);
  };

  // Only the picked models are listed, so a long catalog never floods the card:
  // fastest first, then failures, then the ones not run yet.
  const rank = (result?: BenchResult) => (result ? result.ms ?? Number.MAX_SAFE_INTEGER : Infinity);
  const ranked = pickedRows
    .map((row) => ({ row, key: routeKey(row.provider, row.model), result: bench[routeKey(row.provider, row.model)] }))
    .sort((a, b) => rank(a.result) - rank(b.result));
  const fastestKey = ranked[0]?.result?.ms !== undefined ? ranked[0].key : undefined;

  return (
    <div className="np-card">
      <Preview t={t} dim={!enabled} acceptKey={acceptKey} />

      <div className="np-row">
        <div className="np-text">
          <div className="np-title">{t("card.enabled")}</div>
          <div className="np-desc">{t("card.enabled.hint")}</div>
        </div>
        <Toggle
          checked={enabled}
          disabled={disabled}
          label={t("card.enabled")}
          // The default is on, so turning it back on clears the override.
          onChange={(next) => void write([["enabled", next ? undefined : false]])}
        />
      </div>

      <div className={`np-row${enabled ? "" : " np-dim"}`}>
        <div className="np-text">
          <div className="np-title">{t("card.source")}</div>
          <div className="np-desc">{t(source === "own" ? "card.source.own.hint" : "card.source.dsh.hint")}</div>
          {recent === null ? <div className="np-recent">{t("card.recent.none")}</div> : null}
          {recent ? (
            <div className="np-recent">
              {t("card.recent", {
                ms: formatMs(recent.totalMs),
                model: `${recent.route.provider}/${recent.route.model}`,
              })}
              {recent.reasoningChars > 0 ? t("card.recent.think", { chars: String(recent.reasoningChars) }) : null}
            </div>
          ) : null}
          {modelsError ? <div className="np-error">{t("card.model.failed", { error: modelsError })}</div> : null}
        </div>
        <div className="np-segment" role="radiogroup" aria-label={t("card.source")}>
          {(["dsh", "own"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              className="np-btn"
              aria-checked={source === key}
              disabled={disabled || !enabled}
              // The default is dsh, so choosing it again clears the override.
              onClick={() => void write([["source", key === "dsh" ? undefined : key]])}
            >
              {t(`card.source.${key}`)}
            </button>
          ))}
        </div>
      </div>

      <div className={`np-row${enabled ? "" : " np-dim"}`}>
        <div className="np-text">
          <div className="np-title">{t("card.model")}</div>
          <div className="np-desc">{t("card.model.hint")}</div>
        </div>
        {source === "own" ? (
          <ModelPicker
            t={t}
            models={ownModels}
            selected={ownSelected}
            provider={ownProvider}
            model={ownModel}
            disabled={disabled || !enabled}
            onSelect={onOwnModel}
            bench={bench}
            follow={{ name: t("card.own.auto"), hint: t("card.own.auto.hint") }}
          />
        ) : (
          <ModelPicker
            t={t}
            models={dshModels}
            selected={selected}
            provider={provider}
            model={model}
            disabled={disabled || !enabled}
            onSelect={onModel}
            bench={bench}
          />
        )}
      </div>

      {source === "own" ? (
        <div className={enabled ? undefined : "np-dim"}>
          <OwnProviders
            t={t}
            presets={presets}
            providers={ownProviders}
            keyed={keyed}
            failures={failures}
            disabled={disabled || !enabled}
            onChange={(next) => void onOwn(next)}
            onKey={(id, key) => void onKey(id, key)}
            onAdd={(added, key) => void onAddOwn(added, key)}
          />
        </div>
      ) : null}

      <div className={`np-row${enabled ? "" : " np-dim"}`}>
        <div className="np-text">
          <div className="np-title">{t("card.acceptKey")}</div>
          <div className="np-desc">{t("card.acceptKey.hint")}</div>
        </div>
        <div className="np-segment" role="radiogroup" aria-label={t("card.acceptKey")}>
          {(["arrow", "tab"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              className="np-btn"
              aria-checked={acceptKey === key}
              disabled={disabled || !enabled}
              // The default is →, so choosing it again clears the override.
              onClick={() => void write([["acceptKey", key === "arrow" ? undefined : key]])}
            >
              {KEY_LABEL[key]}
            </button>
          ))}
        </div>
      </div>

      <div className={enabled ? undefined : "np-dim"}>
        <div className="np-row" style={ranked.length ? { borderBottom: "none" } : undefined}>
          <div className="np-text">
            <div className="np-title">{t("card.bench")}</div>
            <div className="np-desc">{t("card.bench.hint")}</div>
          </div>
          <div className="np-bench-actions">
            <BenchPicker
              t={t}
              models={models}
              picked={benchPick}
              disabled={!enabled || benchProgress !== null}
              onChange={pickBench}
              bench={bench}
            />
            <button
              type="button"
              className="np-btn np-btn-tall"
              disabled={!enabled || !pickedRows.length || benchProgress !== null}
              onClick={() => void runBench()}
            >
              {benchProgress
                ? t("card.bench.running", { done: String(benchProgress.done), total: String(benchProgress.total) })
                : t("card.bench.start", { count: String(pickedRows.length) })}
            </button>
          </div>
        </div>
        {ranked.length ? (
          <div className="np-bench">
            {ranked.map(({ row, key, result }) => (
              <div className="np-bench-row" key={key}>
                <span
                  className={`np-bench-ms ${
                    !result ? "" : result.ms !== undefined ? speedClass(result.ms) : "np-slow"
                  }`}
                >
                  {!result ? "—" : result.ms !== undefined ? formatMs(result.ms) : t("card.bench.failed")}
                </span>
                <span className="np-bench-name" title={`${row.providerName} / ${row.model}`}>{row.name}</span>
                {key === fastestKey ? <span className="np-tag">{t("card.bench.fastest")}</span> : null}
                <span className="np-bench-sample" title={result?.error ?? result?.suggestion ?? ""}>
                  {!result
                    ? t("card.bench.untested")
                    : result.error ??
                      (result.suggestion ? t("card.bench.sample", { text: result.suggestion }) : t("card.bench.empty"))}
                </span>
                {result?.ms !== undefined ? (
                  key === inUse ? (
                    <span className="np-tag">{t("card.bench.inUse")}</span>
                  ) : (
                    <button type="button" className="np-btn" disabled={disabled}
                      onClick={() => (row.provider.startsWith(OWN_PREFIX) ? onOwnModel(key) : onModel(key))}>
                      {t("card.bench.use")}
                    </button>
                  )
                ) : null}
                <button
                  type="button"
                  className="np-remove"
                  aria-label={t("card.bench.remove")}
                  title={t("card.bench.remove")}
                  disabled={!enabled || benchProgress !== null}
                  onClick={() => pickBench(benchPick.filter((k) => k !== key))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {usage ? (
        <div>
          <div className="np-row" style={{ borderBottom: "none" }}>
            <div className="np-text">
              <div className="np-title">{t("card.usage")}</div>
              <div className="np-desc">{t("card.usage.hint")}</div>
            </div>
            <button type="button" className="np-btn np-btn-tall" onClick={refreshStats}>
              {t("card.usage.refresh")}
            </button>
          </div>
          <UsageTable t={t} usage={usage} models={models} />
        </div>
      ) : null}

      {failed ? <div className="np-error" role="alert">{t("card.saveFailed")}</div> : null}
    </div>
  );
}

export const inject = ["slots"];

export function apply(ctx: any) {
  // `reflect.get` reads an optional service without making it a dependency.
  const locale = () => ctx.reflect?.get?.("locale");

  // Put our texts in dsh's locale registry, so a language pack (or its
  // fallback chain) can cover them. Waited for in a child fiber like
  // `configForms` below; without it, `useLocale` translates locally.
  ctx.inject(["locale"], (lctx: any) => {
    if (typeof lctx.locale?.register !== "function") return;
    lctx.effect(() => {
      const dispose = lctx.locale.register(LOCALE_NS, { zh, en });
      registered = true;
      return () => {
        registered = false;
        dispose();
      };
    });
  });

  ctx.slots.inject("conversation.input.overlay", () =>
    ctx.slots.register(
      {
        name: "conversation.input.overlay",
        id: "next-prompt-ghost",
        order: 10,
        inject: () => ({ locale: locale() }),
      },
      GhostSuggestion,
    ),
  );

  // `configForms` is waited for in a child fiber: naming it in the top-level
  // `inject` would leave the entry pending forever on a dsh without it, and
  // web boot treats a pending entry as fatal.
  ctx.inject(["configForms"], (fctx: any) => {
    const form = fctx.configForms.get(NAMESPACE);
    fctx.effect(() => {
      setConfigForm(form);
      return () => setConfigForm(undefined);
    });
    fctx.slots.inject("plugins.bundle.config", () =>
      fctx.slots.register(
        {
          name: "plugins.bundle.config",
          key: PACKAGE_NAME,
          inject: () => ({ form, locale: locale() }),
        },
        SettingsCard,
      ),
    );
  });
}
