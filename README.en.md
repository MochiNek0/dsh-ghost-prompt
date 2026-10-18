[中文](./README.md) | **English**

# dsh-ghost-prompt

Adds "predict what you'll type next" to DeepSeek Harness (dsh): after every turn the model guesses your next message and shows it as grey ghost text in the composer — press **→** to accept it into the input, or just start typing to ignore it. Similar to the prompt suggestion in Claude Code / Codex.

## Features

- Predicts automatically after every normally completed turn (`turn/end` with `completed`); no prediction on errors, cancellation, or subagent sessions.
- Shows ghost text while the composer is empty; pressing → puts it into the input (cursor moved to the end, so you can keep editing before sending).
- If you typed anything yourself during a turn, that turn's prediction is no longer shown.
- Choose the prediction model (defaults to the current session's model) and flip the feature on/off — both live in the sidebar under **Plugins → Prompt Suggestions**.
- Bilingual UI (zh / en), following **Settings → General → Language**; the sample conversation used for the speed test switches language along with it.
- Predictions are only fired while browser UI is actually watching: headless runs, scheduled tasks, and goal rounds spend no extra tokens. Multiple tabs on the same session still trigger only one model call.

## Installation

```bash
dsh plugin --profile web add dsh-ghost-prompt
# Local development build: clone the repo, then from its root run
dsh plugin --profile web add link:.
```

Then add `dsh-ghost-prompt` to `dsh.profile.bundles` in the profile's `package.json` (`dsh plugin add` normally handles this for you).

## Configuration

Change it in the UI, or put it in the profile's `cordis.patch.yml`:

```yaml
- id: next-prompt
  config:
    enabled: true          # master switch
    provider: ''           # empty = follow the session model; set it to a provider id you configured in dsh (provider and model must be set together)
    model: ''              # model id for predictions; leave empty to follow the session too
    maxContextChars: 8000  # cap on the most recent conversation sent for prediction; lower is faster
    maxOutputTokens: 512
    timeoutMs: 30000
```

## Implementation notes

- **Host** (`src/index.ts`): registers `POST /api/next-prompt/suggest` (streaming NDJSON) and `GET /api/next-prompt/models`. Prediction starts as soon as the last reply of a turn (excluding tool calls) lands — no wait for `turn/end`, and no wait for the browser to ask — but only for sessions a browser has been watching within the last 30 minutes. Reasoning effort prefers `off` / `minimal`, and the call is aborted as soon as the first line is complete.
- **Browser** (`src/client.tsx`): mounts a component in the `conversation.input.overlay` slot that attaches to the host's prediction stream when a turn ends, so the ghost text appears word by word; it is rendered through a portal inside the editor's positioning container and reuses the original placeholder's classes, so its position and font match the placeholder exactly. The → key is intercepted with capture on a wrapper outside the input and only takes effect while the ghost text is visible. The settings card hangs off `plugins.bundle.config` and reads/writes through `configForms`.
- **i18n**: the zh / en UI dictionaries are registered into dsh's `locale` service (namespace `next-prompt`); a language-pack plugin can override or extend them. Without that service, translation falls back locally based on the browser language. The title and description in the plugin list come from `meta` in `locale/{en,zh}.json`; the host-side Config field descriptions are provided as en / zh strings via schemastery's `.i18n()`.

## Build

```bash
pnpm install
pnpm run build
```
