**中文** | [English](./README.en.md)

# dsh-ghost-prompt

给 DeepSeek Harness (dsh) 加上「预测下一句」：每轮对话结束后，模型猜你接下来想说什么，以灰色幽灵文字显示在输入框里——按 **→** 接受、变成真正的输入；直接打字则忽略。类似 Claude Code / Codex 的 prompt suggestion。

## 功能

- 每轮正常结束（`turn/end` 为 `completed`）后自动预测；出错、取消、子代理会话不预测。
- 输入框为空时显示幽灵文字，按 → 填入输入框（光标放到末尾，可继续编辑后再发送）。
- 只要你在这一轮里自己打过字，这一轮的预测就不再出现。
- 可选择预测模型（默认跟随当前会话的模型），可一键开关——都在侧边栏「插件」→「输入预测」页面里。
- 界面中英双语，跟随「设置 → 通用 → 语言」切换；测速用的示例对话也跟着换语言。
- 只在有浏览器界面看着的时候才发起预测：headless、定时任务、goal 轮次不会多花 token。同一会话开多个标签页只调用一次模型。

## 安装

```bash
dsh plugin --profile web add dsh-ghost-prompt
# 本地开发版：clone 仓库后，在仓库根目录执行
dsh plugin --profile web add link:.
```

然后把 `dsh-ghost-prompt` 加到 profile `package.json` 的 `dsh.profile.bundles`（`dsh plugin add` 通常会自动处理）。

## 配置

界面里改即可；也可以写在 profile 的 `cordis.patch.yml`：

```yaml
- id: next-prompt
  config:
    enabled: true          # 总开关
    provider: ''           # 留空 = 跟随会话模型；填你在 dsh 里配好的 provider id（provider 和 model 需同时设置）
    model: ''              # 预测用的模型 id，同样留空则跟随会话
    maxContextChars: 8000  # 送给预测模型的最近对话上限，越小越快
    maxOutputTokens: 512
    timeoutMs: 30000
```

## 实现说明

- **Host 端**（`src/index.ts`）：注册 `POST /api/next-prompt/suggest`（NDJSON 流式）和 `GET /api/next-prompt/models`。轮次的最后一条回复（不含工具调用）一落地就开始预测，不等 `turn/end`，也不等浏览器来请求——只对最近 30 分钟内有浏览器看过的会话这么做。模型推理强度优先选 off/minimal，第一行写完立即中断调用。
- **浏览器端**（`src/client.tsx`）：在 `conversation.input.overlay` 槽里挂一个组件，轮次结束时接入 Host 的预测流，幽灵文字逐字出现；幽灵文字用 portal 渲染在编辑器的定位容器里，并沿用原占位符的 class，所以位置和字体与占位符完全一致；→ 键在输入框外层用 capture 拦截，只在幽灵文字可见时生效。设置卡片挂在 `plugins.bundle.config`，通过 `configForms` 读写。
- **多语言**：界面文案的 zh / en 字典注册进 dsh 的 `locale` 服务（命名空间 `next-prompt`），语言包插件可以覆盖或补充；没有该服务时按浏览器语言在本地翻译。插件列表里的标题和简介来自 `locale/{en,zh}.json` 的 `meta`，Host 端 Config 的字段说明用 schemastery 的 `.i18n()` 提供 en / zh 两份。

## 构建

```bash
pnpm install
pnpm run build
```
