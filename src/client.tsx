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
  "card.saveFailed": "保存失败，已恢复为服务器上的值",
  "card.bench": "模型测速",
  "card.bench.hint": "勾选要测的模型，用一段固定的对话各实际调用一次，看谁出预测最快、预测得怎么样。每个模型会产生一次调用费用。",
  "card.bench.start": "测速所选（{count}）",
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
  "card.saveFailed": "Save failed; reverted to the stored value",
  "card.bench": "Speed test",
  "card.bench.hint": "Tick the models to test; each is called once on a fixed conversation to see which predicts fastest, and how well. Each model costs one call.",
  "card.bench.start": "Test selected ({count})",
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

/** Tell the Host the user moved on, so it stops (or forgets) this turn's prediction. */
function dismissSuggestion(sessionId: string) {
  fetch(DISMISS_PATH, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
    keepalive: true,
  }).catch(() => {});
}

/** The editor may hold non-breaking spaces where the suggestion has plain ones. */
const normalizeDraft = (draft: string) => draft.replace(/ /g, " ");

/**
 * Whether the draft is still on the suggestion's path: a prefix of it, or —
 * while it is still streaming — typed ahead of what has arrived so far.
 */
const onPath = (draft: string, suggestion: string, complete: boolean) =>
  suggestion.startsWith(draft) || (!complete && draft.startsWith(suggestion));

/** The next word of `rest` plus the spaces / punctuation after it. */
function nextWord(rest: string): string {
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
.np-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:50;width:300px;max-height:360px;display:flex;flex-direction:column;background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-layer-2,#fff));border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.16));overflow:hidden}
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
.np-pick{display:flex;flex-wrap:wrap;gap:6px;padding:0 0 12px}
.np-pick .np-btn[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary,#3e58d6);color:var(--dsw-alias-label-primary-bluish,var(--dsw-alias-state-business-primary,#3e58d6))}
.np-pick-actions{display:flex;gap:6px;padding:0 0 8px}
.np-bench{display:flex;flex-direction:column;gap:2px;padding:0 0 16px}
.np-bench-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:var(--dsw-radius-sm,8px)}
.np-bench-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.np-bench-ms{flex:none;width:56px;font-size:13px;font-variant-numeric:tabular-nums;text-align:right}
.np-bench-name{flex:none;width:200px;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-bench-sample{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
  const form = configForm;
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
    [sessionId, retire],
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
    const text = word ? suggestion.slice(0, typed.length + nextWord(rest).length) : suggestion;
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
              {typed ? <span style={{ visibility: "hidden" }}>{suggestion.slice(0, typed.length)}</span> : null}
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

type FormSnapshot = {
  status: "loading" | "ready" | "unavailable";
  value?: { enabled?: boolean; provider?: string; model?: string; acceptKey?: AcceptKey };
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

/** Searchable model menu: "follow the session" first, then models grouped by provider. */
function ModelPicker({ t, models, selected, provider, model, disabled, onSelect, bench }: {
  bench: BenchResults;
  t: Translate;
  models: ModelRow[] | null;
  selected: string;
  provider: string;
  model: string;
  disabled: boolean;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const rootRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => searchRef.current?.focus());
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
  }, [open]);

  const current = (models ?? []).find((r) => routeKey(r.provider, r.model) === selected);
  const label =
    selected === FOLLOW ? t("card.model.follow") : current ? current.name : `${provider} / ${model}`;
  const currentMs = bench[selected]?.ms;

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
  const showFollow = !q || t("card.model.follow").toLowerCase().includes(q);

  const pick = (key: string) => {
    setOpen(false);
    if (key !== selected) onSelect(key);
  };

  const option = (key: string, name: string, sub: string | undefined, speed?: BenchResult) => (
    <button
      key={key || "follow"}
      type="button"
      className="np-option"
      data-active={key === selected ? "" : undefined}
      onClick={() => pick(key)}
    >
      <span className="np-check">{key === selected ? <Icon name="IconCheckOutlineRegular" fallback="✓" /> : null}</span>
      <span className="np-option-text">
        <div className="np-option-name">{name}</div>
        {sub ? <div className="np-option-sub">{sub}</div> : null}
      </span>
      {speed ? <SpeedLabel t={t} result={speed} /> : null}
    </button>
  );

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
        <div className="np-menu" role="listbox">
          <div className="np-search">
            <Icon name="IconSearchOutlineRegular" fallback="⌕" />
            <input
              ref={searchRef}
              value={query}
              placeholder={t("card.model.search")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="np-list">
            {showFollow ? option(FOLLOW, t("card.model.follow"), t("card.model.follow.hint")) : null}
            {selected !== FOLLOW && !current && !q
              ? option(selected, `${provider} / ${model}`, t("card.model.missing"))
              : null}
            {models === null ? <div className="np-empty">{t("card.model.loading")}</div> : null}
            {groups.map((group) => (
              <React.Fragment key={group.provider}>
                <div className="np-group">{group.providerName || group.provider}</div>
                {group.rows.map((row) =>
                  option(routeKey(row.provider, row.model), row.name, row.name !== row.model ? row.model : undefined, bench[routeKey(row.provider, row.model)]),
                )}
              </React.Fragment>
            ))}
            {models !== null && q && groups.length === 0 && !showFollow ? (
              <div className="np-empty">{t("card.model.empty")}</div>
            ) : null}
          </div>
        </div>
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

  // The last real prediction's timing, so a slow model shows up as slow.
  React.useEffect(() => {
    let live = true;
    fetch(BENCH_PATH, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
      .then((res) => res.json())
      .then((body) => live && setRecent(body?.recent?.[body.recent.length - 1] ?? null))
      .catch(() => live && setRecent(null));
    return () => {
      live = false;
    };
  }, []);

  React.useEffect(() => {
    let live = true;
    fetch(MODELS_PATH, { cache: "no-store", credentials: "same-origin" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (live) setModels(body.models ?? []);
      })
      .catch((error) => {
        if (!live) return;
        setModels([]);
        setModelsError(String(error?.message ?? error));
      });
    return () => {
      live = false;
    };
  }, []);

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
    void write([["provider", p], ["model", m]]);
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

  const ranked = (models ?? [])
    .map((row) => ({ row, key: routeKey(row.provider, row.model), result: bench[routeKey(row.provider, row.model)] }))
    .filter((item) => item.result)
    .sort((a, b) => (a.result!.ms ?? Infinity) - (b.result!.ms ?? Infinity));
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
          <div className="np-title">{t("card.model")}</div>
          <div className="np-desc">{t("card.model.hint")}</div>
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
        <ModelPicker
          t={t}
          models={models}
          selected={selected}
          provider={provider}
          model={model}
          disabled={disabled || !enabled}
          onSelect={onModel}
          bench={bench}
        />
      </div>

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
        <div className="np-row" style={models?.length || ranked.length ? { borderBottom: "none" } : undefined}>
          <div className="np-text">
            <div className="np-title">{t("card.bench")}</div>
            <div className="np-desc">{t("card.bench.hint")}</div>
          </div>
          <button
            type="button"
            className="np-btn"
            disabled={!enabled || !pickedRows.length || benchProgress !== null}
            onClick={() => void runBench()}
          >
            {benchProgress
              ? t("card.bench.running", { done: String(benchProgress.done), total: String(benchProgress.total) })
              : t("card.bench.start", { count: String(pickedRows.length) })}
          </button>
        </div>
        {models?.length ? (
          <>
            <div className="np-pick-actions">
              <button
                type="button"
                className="np-btn"
                disabled={!enabled || benchProgress !== null}
                onClick={() => pickBench(models.map((row) => routeKey(row.provider, row.model)))}
              >
                {t("card.bench.all")}
              </button>
              <button
                type="button"
                className="np-btn"
                disabled={!enabled || benchProgress !== null || !benchPick.length}
                onClick={() => pickBench([])}
              >
                {t("card.bench.clear")}
              </button>
            </div>
            <div className="np-pick">
              {models.map((row) => {
                const key = routeKey(row.provider, row.model);
                const picked = benchPick.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className="np-btn"
                    aria-pressed={picked}
                    title={`${row.providerName} / ${row.model}`}
                    disabled={!enabled || benchProgress !== null}
                    onClick={() => pickBench(picked ? benchPick.filter((k) => k !== key) : [...benchPick, key])}
                  >
                    {row.name}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
        {ranked.length ? (
          <div className="np-bench">
            {ranked.map(({ row, key, result }) => (
              <div className="np-bench-row" key={key}>
                <span className={`np-bench-ms ${result!.ms !== undefined ? speedClass(result!.ms) : "np-slow"}`}>
                  {result!.ms !== undefined ? formatMs(result!.ms) : t("card.bench.failed")}
                </span>
                <span className="np-bench-name" title={`${row.providerName} / ${row.model}`}>{row.name}</span>
                {key === fastestKey ? <span className="np-tag">{t("card.bench.fastest")}</span> : null}
                <span className="np-bench-sample" title={result!.error ?? result!.suggestion ?? ""}>
                  {result!.error ??
                    (result!.suggestion ? t("card.bench.sample", { text: result!.suggestion }) : t("card.bench.empty"))}
                </span>
                {result!.ms !== undefined ? (
                  key === selected ? (
                    <span className="np-tag">{t("card.bench.inUse")}</span>
                  ) : (
                    <button type="button" className="np-btn" disabled={disabled} onClick={() => onModel(key)}>
                      {t("card.bench.use")}
                    </button>
                  )
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

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
      configForm = form;
      return () => {
        configForm = undefined;
      };
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
