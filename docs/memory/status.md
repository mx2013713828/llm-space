# LLM-Space 项目当前状态记录

## 1. 架构概览
- **前端框架**：React + Vite
- **后端框架**：Node.js + Express (SSE 全流式)
- **核心定位**：Agent Harness 调试与运行平台，提供可插拔的系统提示词、工具与多模型测试环境，供初学者阶梯式学习Agent知识，理解LLM运行机制，可用于实际AI应用开发参考。

## 2. 核心模块与功能实现

### 2.1 状态与配置持久化
- **模型配置 (.env)**：将用户的 API Base URL、API Key、Model ID 等信息以 JSON 字符串形式持久化在 `.env` 文件中的 `MODELS_CONFIG` 环境变量里。后端提供 `/api/models` 接口进行读写。
- **环境变量自动加载**：服务端启动时解析 `.env` 所有键值到 `process.env`（支持注释、空行），工具可直接通过 `process.env.XXX` 读取敏感配置（如 `TAVILY_API_KEY`）。`PORT` 也优先从 `.env` 读取。
- **会话保持 (Session State Lifting)**：`App.jsx` 作为状态最高层，维护了 `sessions` 对象。当用户在不同 Harness 之间切换时，各 Agent 的对话历史 (`messages`) 和任务列表 (`todos`) 得以无损保留。支持通过"🔄 重置 Session"按钮清空状态。

### 2.2 Agent Harness 与 ReAct Loop
- **Harness 配置体系**：所有的 Agent 配置存放在 `harnesses/` 目录下的 JSON 文件中。引入了 `features` 配置字段，支持将底层的并发执行等高级架构能力作为可选开关，供“互动实验室”测试。
- **运行引擎 (AgentExecutor)**：
  - **控制流完全下沉**：ReAct 循环已完全迁移至后端维护。后端 [`AgentExecutor.js`](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/AgentExecutor.js) 负责驱动循环，进行多轮递归调用、工具调度、上下文清洗与大模型流式调用。前端蜕化为纯事件消费与视图渲染层，仅通过单路 SSE（Server-Sent Events）信道实时渲染轨迹。
  - **协议完整性 (Protocol Integrity)**：后端严格确保 `thinking`、`text`、`tool_use` 与随后的 `tool_result` 按照大模型 API 要求的物理顺序对齐。
  - **并行工具执行**：后端引擎支持读取 `features.parallel_tool_execution`，动态切换串行或 `Promise.all` 并行工具调用与执行机制，大幅缩短复杂任务耗时。
  - **Sub-agent 多智能体引擎**：支持后端系统级拦截 `sub_agent` 工具。当大模型触发子代理时，后端会自动在内存中实例化独立的子 `AgentExecutor` 并运行独立的 ReAct 循环。子代理在执行时产生的详细轨迹事件，会通过带 `parentToolCallId` 的二级路由实时透传回前端，在前端的 `ToolCallCard` 折叠卡片中渲染，结束后仅将最终总结摘要作为 `tool_result` 传回父 Agent。
  - **TODO 状态注入**：后端在每一轮组装 API Messages 时自动将当前看板状态注入，并检测是否连续 3 轮未更新 TODO 以自动追加提醒。
  - **上下文压缩与管理**：
    - **日常护盾 (Always-On Shield)**：后端 `buildApiMessages` 中自动拦截超过 4000 字符的工具输出（排除 `read_file`），掐头去尾替换为 `[OUTPUT OFFLOADED]`。
    - **软清洗纪元 (Soft Compact Epoch)**：当 Token 超过 80% 水位线且多于 5 轮时，后端执行批量折叠，并向前端发送 `messages_update` 更新快照，同时向前端插入 🌊 系统通知气泡。
    - **Token 计数器鲁棒化**：支持 `message_start` + `message_delta` 双事件监听，并引入基于 `(messages + systemPrompt + toolsSchema).length / 4` 的保底估算器，确保非 Anthropic 模型也能正确显示。
    - **压缩后平滑过渡**：压缩后不再粗暴清零，而是就地重新估算，避免断崖式归零误导用户。

### 2.3 多模型适配
- **DeepSeek 思考模式兼容**：DeepSeek 的 `thinking` 参数支持 `enabled` / `disabled` 双向开关。`budget_tokens` 需取整（浮点数会被 DeepSeek 拒绝）。DeepSeek 不使用 signature 签名机制，thinking 块无需密码学验证即可在多轮对话中传递。
- **思考模式热插拔**：同一对话中可随时开关思考模式。开启时 thinking 块保留在消息中，关闭时 `buildApiMessages` 自动过滤旧 thinking 块。
- **KV Cache 监控**：DeepSeek 默认开启上下文硬盘缓存，自动检测公共前缀并落盘。服务端透传 `cache_read_input_tokens` 字段，前端实时显示缓存命中率（`💾 XX% 命中`）。

### 2.4 后端工具系统 (Tool Layer)
- **工具注册中心**：`server/tools/ToolRegistry.js` 统一管理，提供 `getSchemas()` 动态 Schema 生成与 `execute()` 分发。废弃了原本不安全的直接执行高危命令的 `/api/execute-tool` 路由。
- **流式执行引擎 (Streaming Engine)**：工具的实时日志（例如 `bash` 工具的流式 stdout/stderr 输出）由统一的控制流 SSE 通道中继分发（作为 `tool_exec_chunk` 事件输出），不需要前端额外请求独立的文件通道或端点。
- **工具列表**：

| 工具 | 文件 | 能力 |
|------|------|------|
| `bash` | `bash.js` | Shell 执行，`spawn` 模式实时流式输出，120s 超时 |
| `read_file` | `read_file.js` | 读取本地文件（容错 `path`/`filePath` 双参数名） |
| `write_file` | `write_file.js` | 写入本地文件（容错 `path`/`filePath` 双参数名） |
| `weather_report` | `weather_report.js` | 调用 Open-Meteo 真实天气 API |
| `write_todos` | `write_todos.js` | TODO 任务列表管理（后端系统级拦截并向前端同步更新）（由 task_manager 特性隐式注入并装配，不显示在前端 Tools 挂载面板中） |
| `web_search` | `web_search.js` | Tavily `/search` — 关键词搜索，返回 AI 摘要 + 结构化结果 |
| `web_fetch` | `web_fetch.js` | Tavily `/extract` — 传入 URL，返回清洗后 Markdown 正文 |
| `sub_agent` | `sub_agent.js` | 派发子代理任务（后端系统级拦截并实例化子 Executor 循环） |
| `spawn_teammate` | `spawn_teammate.js` | 启动有限异步 teammate，支持结构化 brief（由 Task Orchestration / Agent Teams 隐式注入） |
| `send_team_message` | `send_team_message.js` | 在 Lead 与 teammate 之间发送 TeamBus 消息（由 Task Orchestration / Agent Teams 隐式注入） |
| `wait_for_teammates` | `wait_for_teammates.js` | 等待 teammate 收敛到终态并返回 team status 与 Lead inbox（由 Task Orchestration / Agent Teams 隐式注入） |
| `check_team_inbox` | `check_team_inbox.js` | 读取并消费 Lead team inbox，附带当前 team status（由 Task Orchestration / Agent Teams 隐式注入） |
| `create_task` | `create_task.js` | 创建新任务（附带 Kahn DAG 环检测）（由 task_manager 特性隐式注入并装配，不显示在前端 Tools 挂载面板中） |
| `list_tasks` | `list_tasks.js` | 检索任务看板状态（由 task_manager 特性隐式注入并装配，不显示在前端 Tools 挂载面板中） |
| `get_task` | `get_task.js` | 查询单个任务详情（由 task_manager 特性隐式注入并装配，不显示在前端 Tools 挂载面板中） |
| `claim_task` | `claim_task.js` | 并发保护认领任务（带排他文件锁）（由 task_manager 特性隐式注入并装配，不显示在前端 Tools 挂载面板中） |
| `complete_task` | `complete_task.js` | 完成进行中任务，并自动解锁下游（由 task_manager 特性隐式注入并装配，不显示在前端 Tools 挂载面板中） |

### 2.5 网络代理支持
- 使用 `undici` 的 `EnvHttpProxyAgent` + `setGlobalDispatcher` 全局适配。
- 自动读取系统 `HTTPS_PROXY` 环境变量，无需额外配置。
- 所有 `fetch` 请求（包括 LLM API、天气 API、Tavily）自动走代理。

### 2.6 容错与重试
- 上游 API 请求失败时自动重试 3 次（间隔 1s）。
- 错误日志包含 endpoint URL 和具体 cause 信息。

### 2.7 先进技能体系与缓存友好型 System 提示词暴露 (Progressive Skills & Cache-Aligned Alignment)
- **全局与本地技能池双挂载**：在“实验特性”中引入 `features.enable_global_skills` 开关（默认关闭）。后端 `/api/skills` 支持 `?global=true` 动态合并项目本地 `skills/` 与全局用户技能目录 `/Users/mayufeng/.agents/skills`。若技能 ID 冲突，本地优先覆盖全局，实现零拷贝共享全局技能包。
- **元数据暴露与 YAML Frontmatter 解析**：标准技能以子文件夹形式组织，包含 `SKILL.md` 指引。后端使用轻量级 `parseFrontmatter` 解析 YAML 头部，提取技能名（`name`）与简介（`description`），全局技能卡片在前端被渲染 “🌐 全局” 标识。
- **技能物理资产 (Assets) 自动解构**：后端自动扫描技能文件夹下的 `scripts/`（脚本）与 `references/`（参考说明）子目录下的文件，并映射为具体的物理路径。本地技能返回项目相对路径，全局技能返回宿主机绝对路径。
- **资产精准映射与 Cache 友好注入**：API 发包对齐层 `alignRequestPayload` 支持将 richSkills 包含的 scripts 及 references 路径树自动拼装入 System Prompt 最末尾的 `<available_skills>` 块中。这使大模型对该技能配套的可执行脚本及附带参考文档一目了然，用 `read_file` 和 `bash` 调用时能 100% 准确定位，消除路径查找盲区。对于 Anthropic 架构仍整体附加 `cache_control` 保护前缀缓存。
- **上下文可观测性与穿透**：前端 TrajectoryPage 与 ContextInspector 深度适配，能够直观展现解构出 scripts/references 资产路径树后的 XML 预览，提供纯净透明的可视化调试。

## 3. UI/UX 体验
- **终端体验 (Terminal Emulation)**：前端渲染器支持 `\r` 原地覆盖，完美展示进度条。后端通过 TTY 伪装环境变量强制工具彩色输出。
- **实时监控 (Token Monitor)**：Thinking 气泡右上角实时显示 Input/Output Token 消耗。
- **缓存命中监控**：右侧面板顶部显示 KV Cache 命中率，hover 展示命中/未命中 token 数。
- **模型管理 UI**：左侧面板支持通过表单直接添加新模型配置并持久化到 `.env`。

## 4. 已知的瓶颈与风险
- **后台任务缺失**：超过 2 分钟的极长任务仍依赖 HTTP Keep-alive。需引入 Job 管理器。
- **安全性**：`bash` 缺乏沙箱化。
- **web_fetch 内容截断**：Tavily `/extract` 对超长页面会截断，需评估最大可接受长度。
- **会话持久化缺失**：刷新页面后对话历史会丢失，需引入后端存储层。

## 5. 最近工程突破 (Engineering Breakthroughs)
1. **原子块顺序聚合算法**：解决了 ReAct 循环中思维链丢失的难题。
2. **实时流式工具反馈**：将工具执行过程可视化，大幅降低了 Agent 运行时的黑箱感。
3. **终端进度条渲染**：通过处理控制字符，在 Web UI 中实现了近乎原生终端的安装进度反馈。
4. **DeepSeek 思考模式全适配**：修复 thinking 块字段名不匹配、budget_tokens 浮点拒绝、thinking 参数缺失导致 400 等一系列模型兼容问题，实现双向热插拔。
5. **Tavily 网络搜索集成**：从模拟执行升级为真实 API 调用，Agent 具备实时互联网搜索与网页抓取能力。
6. **全局代理自动适配**：通过 `undici` 全局分发，解决 Node.js fetch 不认 `HTTPS_PROXY` 导致的网络超时问题。
7. **架构特性可配置化 (Interactive Lab)**：在 Prompt Lab 界面中加入了"实验特性"面板，可直接通过 UI 动态调节底层引擎的行为模式（如并发执行）。
8. **Sub-agent 隔离与可视化**：成功实现了子代理的上下文隔离（Context Isolation）。子代理的详细工作流在 API 传输层被安全抛弃以节省 tokens，但在前端 UI 的 ToolCallCard 中实现了深层嵌套的可视化渲染，彻底打破多智能体运行黑箱。
9. **上下文检查器 (Context Inspector)**：新增全屏模态框可视化调试工具，完整展示 `buildApiMessages()` 处理后的实际 API 上下文（System Prompt + Tools Schema + Messages 序列），每条消息按角色着色、按 block 类型分区渲染，支持一键复制 JSON。
10. **工具参数容错增强**：修复 `read_file`/`write_file` 因大模型参数命名混淆（`path` vs `filePath`）导致的 `undefined` 崩溃，改用宽松 `params` 对象解析。
11. **软清洗可视化通知**：压缩触发时在对话时间线插入 🌊 `system_alert` 系统气泡，告知用户发生了什么操作及具体压缩数量，显著提升系统可观测性。
12. **Token 计数器鲁棒化**：修复非 Anthropic 模型 Token 计数显示 0 的问题，引入双事件监听 + 保底估算器；压缩后从粗暴清零改为就地重新估算，避免断崖式归零。
13. **主控循环下沉后端**：完成了核心 ReAct 循环（最大 15 轮）、上下文软压缩以及 TODO 看板催促组装逻辑由前端浏览器层到后端 Node 服务的全面迁移，减少了前端的内存和计算负荷，并提供了统一的 SSE（Server-Sent Events）事件输出协议，完成了视图与核心逻辑的清晰剥离。
14. **基于 ToolRegistry 的工具安全防线**：引入后端统一工具注册表，动态转换并导出兼容主流大模型的 JSON Schema 工具集，物理废除了不安全的直执行外部工具的 `/api/execute-tool` 端点，构建起第一道工具安全阻断线。
15. **二级路由多智能体流式穿透**：子代理的调度现在完全在后端并发/递归独立执行。通过统一控制信道配合 `parentToolCallId` 的二级路由协议，将子代理内部的思考和工具执行流原汁原味地在中途透传给前端，实现了嵌套 UI 的完美复现与轻量化数据隔离。
16. **严格模式 Immutable 状态更新与 tool_end 对齐**：修复了在 React 开发严格模式（StrictMode）下流式叠字输出的 Mutation 副作用，重构事件解析为纯不可变更新；并且增加了对 `tool_end` 结束事件的监听，保障在工具输入流结束时强行将完整的输入参数同步到前端，彻底解决了因流式 JSON 片段解析不完整而导致工具参数在 UI 呈现上卡在 `{}` 空对象的问题。
17. **渐进式技能加载与前缀缓存对齐**：实现了与 Claude Code 类似的渐进式技能加载（Skill Loading）。在 System Prompt 静态区末尾仅挂载技能元数据 XML，在多轮 ReAct 运行中大模型根据说明自主发起 `read_file` 动态拉取技能 Markdown 原文；前端调试面板与发包重排全面打通，支持技能勾选、保存和所见即所得的可视化缓存对齐预览。
18. **先进技能体系 (A+B 方案) 落地**：支持有条件加载本地全局技能池（`~/.agents/skills`）与本地优先覆盖机制，提供前端 `enable_global_skills` 一键开关；后端自动深度扫描技能目录，解构其下的 `scripts/`（脚本）与 `references/`（参考资料）等附属资产，将其与主 `SKILL.md` 融合为 richSkills。大模型发包对齐层全量支持物理资产树注入及 XML 路径披露，实现 100% 物理寻址与前缀缓存对齐。
19. **Hook-Based 生命周期架构重构**：将原本臃肿的后端 AgentExecutor 主循环彻底解耦。引入微内核 `HookManager`，将上下文清洗、大文本物理卸载、子代理拦截、技能按需扫描加载、Todo 看板同步及催促等特性，完全剥离为独立的可插拔插件（Plugins）。框架现已演进为严格遵循 `PreLLM -> PreToolUse -> PostToolUse -> OnLoopEnd` 的标准化流水线，具备了类似 Claude Code 等工业级 Agent 引擎的极致扩展能力与代码纯洁度。
20. **长期记忆系统（Memory System）**：实现跨会话、跨压缩的知识积累层（阶段十，commit d5128f9）。包含 memoryStore（写锁+路径校验+UTF-8安全截断）、memorySelect（LLM side-query+关键词降级）、memoryExtract（对话结束后自动提取）、memoryConsolidate（三层门控定期整理）、MemoryPlugin（preLLM 注入 + onLoopEnd fire-and-forget）。索引注入 system prompt 保护 Prompt Cache，具体内容注入 user turn 不破坏缓存前缀。FeatureSchema 新增 enable_memory group，含子级联动约束。
21. **可恢复的任务依赖系统 (DAG Task System) 与一键式合并重构**：实现类似 Claude Code 的持久化任务图系统，内置 Kahn 算法环检测、Claim 排他文件锁、Release Path 中断回滚事务，以及静前动后前缀缓存友好拆分。更进一步，进行了任务系统一键一类合并重构，在前端 Tools 面板中彻底隐藏 6 个物理原子工具，在 FeatureSchema 中引入统一的 `task_manager` 实验特性组，支持 `todo`/`task_system` 双模式动态净化与自动搭载。
22. **Task Orchestration 与 Agent Teams MVP 闭环**：将任务看板、DAG Task System、Sub-agent、Cron、Background Tasks、Agent Teams 统一到 Task Orchestration 下，新增可实时切换的执行策略层。Agent Teams 已实现有限异步 teammate、TeamBus、结构化 brief、前端 teammate live status、`turn_limit`/`no_result` 终态语义，以及 `wait_for_teammates` join 工具，使 lead 能等待团队收敛后再汇总，完成 MVP 最小闭环。

## 6. Task Orchestration / Agent Teams 后续计划

| 优先级 | 改进项 | 说明 | 文件 |
|--------|--------|------|------|
| 高 | Team Dashboard 轻量增强 | 展示 team 列表、teammate 状态、未读 inbox、失败/超时/无结果标识，并按需展开 teammate 轨迹 | `src/components/MessageBubbles.jsx` / 新增团队面板 |
| 高 | Teammate 生命周期管理 | 增加 cancel、retry、ignore/adopt result 等控制能力 | `TeamPlugin.js` / `teamStateStore.js` |
| 中 | 组合策略预设 | 提供 `Todo + Teams`、`DAG + Teams`、`Sequential Review` 等一键策略，同时保留 primitive 自定义 | `src/lib/taskOrchestration.js` / `FeatureSchema.js` |
| 中 | TeamBus 协议增强 | 增加 `partial_result`、`question`、`blocker`、`review` 等消息类型 | `server/agent/teams/*` |
| 低 | Autonomous Team Pool | 长时 teammate、idle loop、worktree isolation 和自主团队池 | 后续设计 |

## 7. CC 级记忆系统增强（待完成）

基于对 Claude Code 源码（memdir/、services/、query/ 等）的深度分析，提取出以下高价值改进项，后续完成：

| 优先级 | 改进项 | 说明 | 文件 |
|--------|--------|------|------|
| 高 | Memory 使用规范注入 system prompt | 禁止模型使用"根据记忆…"等暴露 RAG 机制的措辞，对齐 CC `<appropriate_boundaries_re_memory>` | `MemoryPlugin.js` |
| 高 | Memory prefetch 非阻塞异步化 | 在 onLoopStart 启动 prefetch，工具执行期间并发进行，对标 CC query.ts:301-304 | `MemoryPlugin.js` |
| 中 | 整理门控增加"新增记忆数"维度 | 额外增加"本次 session 新写入记忆数 ≥ 3"才触发整理，减少无增量时的无谓 LLM 调用 | `memoryConsolidate.js` |
| 中 | 前端记忆管理 UI | 展示记忆清单（名称/类型/描述/时间），支持手动删除，降低系统黑箱感 | PromptLabPage 或新增页面 |
| 低 | memory_consolidate UI 灰化 | extract 未开启时 consolidate 复选框显示灰度不可点击 | `PromptLabPage.jsx` |
