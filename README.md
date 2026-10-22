**中文** | [English](./README.en.md)

# dsh-ghost-prompt

给 DeepSeek Harness (dsh) 加上「预测下一句」：每轮对话结束后，模型猜你接下来想说什么，以灰色幽灵文字显示在输入框里——按 **→** 接受、变成真正的输入；直接打字则忽略。类似 Claude Code / Codex 的 prompt suggestion。

## 功能

- 每轮正常结束（`turn/end` 为 `completed`）后自动预测；出错、取消、子代理会话不预测。
- 输入框为空时显示幽灵文字，按 → 填入输入框（光标放到末尾，可继续编辑后再发送）；接受键可改成 Tab，也可以直接点击提示标签接受（触屏可用）。
- 打的字和预测开头一致时（英文不区分大小写），剩下的部分继续以灰字跟在后面；Ctrl+→（macOS 上 ⌥→）逐词接受，Esc 关闭。
- 打了和预测对不上的字，提示只是暂时隐藏，把字删回预测的开头（或清空）它会重新出现。按 Esc 则这一轮的预测彻底作废，Host 端还在进行的预测调用也会一并中止。
- 可选择预测模型（默认跟随当前会话的模型），可一键开关——都在侧边栏「插件」→「输入预测」页面里。
- **自定义模型**：不想在 dsh 里折腾 provider 配置的话，把「模型来源」切到「自定义」，点「+ 添加」在弹窗里选 ModelScope、硅基流动、Agnes AI、DeepSeek、讯飞星火（Lite 免费）预设（或任意 OpenAI 兼容地址），选模型、粘贴 API Key 即可，添加后折叠成一行，点开可修改。关闭思考等厂商专属参数已经内置。默认来源是「dsh 模型」，两边的配置各自保留、互不兜底。「预测模型」里可以直接选某个自定义模型，也可以选「自动」：从上到下依次尝试所有自定义模型，某个模型失败（额度用完、Key 无效、超时等）就换下一个，并在 10 分钟内跳过它（改了配置会立即重试）；全部失败时不会退回 dsh 的模型，卡片里会显示错误。
- 同一页面底部的「诊断」（默认折叠）里有模型测速和「Token 用量」统计：按模型列出预测和测速调用消耗的输入 / 缓存命中 / 输出 token（来自供应商回传的用量，dsh 重启后清零）。
- 界面中英双语，跟随「设置 → 通用 → 语言」切换；测速用的示例对话也跟着换语言。
- 只在有浏览器界面看着的时候才发起预测：headless、定时任务不会多花 token；goal 还会自动继续下一轮时也不预测。同一会话开多个标签页只调用一次模型。

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
    source: dsh            # 模型来源：dsh = 用下面的 provider / model；own = 用 ownProviders
    ownProvider: ''        # source 为 own 时用哪个提供商的哪个模型；留空 = 自动，按顺序尝试
    ownModel: ''
    ownProviders:          # 自定义提供商，source 为 own 时使用
      - id: modelscope
        preset: modelscope # modelscope / siliconflow / agnes / deepseek / spark / custom
        models: [Qwen/Qwen3.5-35B-A3B]
      - id: custom-1
        preset: custom
        name: My API
        baseURL: https://example.com/v1
        models: [my-model]
        extraBody: '{"enable_thinking": false}'  # 合并进每次请求的额外字段
    apiKeys:               # 按 provider id 存放的 Key；明文保存在本文件中，但不会发送到浏览器
      modelscope: ms-xxxx
      custom-1: sk-xxxx
    provider: ''           # 留空 = 跟随会话模型；填你在 dsh 里配好的 provider id（provider 和 model 需同时设置）
    model: ''              # 预测用的模型 id，同样留空则跟随会话
    maxContextChars: 8000  # 送给预测模型的最近对话上限，越小越快
    maxOutputTokens: 512
    timeoutMs: 30000
    acceptKey: arrow       # 接受整条预测的按键：arrow（→）或 tab
```

## 实现说明

- **Host 端**（`src/index.ts`）：注册 `POST /api/next-prompt/suggest`（NDJSON 流式）、`POST /api/next-prompt/dismiss`（用户按 Esc 时中止调用）、`POST /api/next-prompt/watch`（用户发出消息时刷新「有浏览器在看」的标记）和 `GET /api/next-prompt/models`。轮次的最后一条回复（不含工具调用）一落地就开始预测，不等 `turn/end`，也不等浏览器来请求——只对最近 30 分钟内有浏览器看过的会话这么做（每轮开始时浏览器都会刷新这个标记，所以闲置很久后再发消息也能提前开始）。模型推理强度优先选 off/minimal，第一行写完立即中断调用。自带模型不经过 dsh 的 `llm` 服务，由插件直接请求 `<baseURL>/chat/completions`（SSE 流式，带 `stream_options.include_usage`），预设里带好了各家关闭思考的参数；失败的模型记在内存里冷却 10 分钟，`POST /api/next-prompt/bench` 会把它们连同错误一起返回给设置卡片。
- **浏览器端**（`src/client.tsx`）：在 `conversation.input.overlay` 槽里挂一个组件，轮次结束时接入 Host 的预测流，幽灵文字逐字出现；幽灵文字用 portal 渲染在编辑器的定位容器里，并沿用原占位符的 class，所以位置和字体与占位符完全一致；输入了预测的开头时，已输入部分以 `visibility: hidden` 占位，剩余部分正好接在文字后面；→ / Tab / Ctrl+→ / Esc 在输入框外层用 capture 拦截，只在幽灵文字可见且光标在末尾时生效。设置卡片挂在 `plugins.bundle.config`，通过 `configForms` 读写。
- **多语言**：界面文案的 zh / en 字典注册进 dsh 的 `locale` 服务（命名空间 `next-prompt`），语言包插件可以覆盖或补充；没有该服务时按浏览器语言在本地翻译。插件列表里的标题和简介来自 `locale/{en,zh}.json` 的 `meta`，Host 端 Config 的字段说明用 schemastery 的 `.i18n()` 提供 en / zh 两份。

## 构建

```bash
pnpm install
pnpm run build
pnpm test   # build, then node --test
```
