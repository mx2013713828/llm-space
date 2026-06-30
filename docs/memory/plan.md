# LLM-Space 架构优化阶梯计划

根据业界先进的 Agent Harness（如 Claude Code 等）的设计哲学，我们将把目前的架构从“基础雏形”升级为“专业级工业底座”。

**🌟 核心理念：Agent 架构互动实验室**
本项目不仅仅是一个简单的 Harness，我们的核心目标是将其打造为一个**渐进式的学习与实验沙盒**。所有高级 Harness 的设计（如并发执行、上下文卸载等）都将作为 `features` 可选配置暴露给用户。用户可以通过开关这些配置，一步步从简单到复杂，直观对比不同架构对 Agent 表现的影响。

本计划按照**“收益从高到低、实现成本从低到高”**的阶梯式顺序推进：

## 阶段一：并行工具执行 (Parallel Tool Execution) 🚀
**目标**：打破 Agent 运行瓶颈，让多个并行的 Tool Call 实现真正的并发执行。
**工作项**：
- [x] 改造后端 `AgentExecutor.js` 的 ReAct 循环逻辑。
- [x] 将目前在后端串行等待工具执行的逻辑，重构为基于 `Promise.all()` 的并发请求逻辑（当启用 `parallel_tool_execution` 时）。
- [x] 确保后端在并发结束后，按原始顺序统一将 `tool_result` 组装并发送给 LLM。

## 阶段二：缓存对齐式上下文压缩 (Cache-Aligned Watermark Compression) 🛡️
**目标**：解决长轮次任务导致大模型 Context Window 爆炸，并最大化保护 Prompt Cache 命中率。
**工作项**：
- [x] **Stage 1 (日常护盾)**：在后端 `buildApiMessages` 组装层拦截 `tool_result`，当单次长于 4000 字符时执行掐头去尾，替换为 `[OUTPUT OFFLOADED]`，保证历史记录严格 Append-Only，对缓存极度友好。
- [x] **Stage 2 (80% 水位线软清洗)**：在 UI 右上角添加动态 Memory Bar，精准绑定 API 每次返回的真实 `input_tokens`。
- [x] **Stage 2 (批量重置纪元)**：当 Token 超出 160,000 (80%) 且多于 5 轮时，在后端触发全量批处理（Batch Compact）：非对称掏空历史 `write_file` 的代码入参，折叠幂等的 `read_file` 返回结果和旧的 `<thinking>` 块，通过 `messages_update` 事件实时同步前端，开创新的 Cache 纪元。
- [x] **Token 计数器鲁棒化**：修复非 Anthropic 模型（如豆包/Gemini）在流式传输中不返回 `input_tokens` 导致计数器显示 0 的问题。引入 `message_delta` 事件监听 + 基于 `(messages + systemPrompt + toolsSchema).length / 4` 的保底估算器。
- [x] **压缩后计数器平滑过渡**：将压缩后的 `setContextTokens(0)` 粗暴清零，改为就地重新估算（`compressedEstimate`），避免断崖式归零误导用户。
- [x] **软清洗可视化通知**：在压缩触发时，自动在对话轨迹中插入 🌊 系统提示气泡（`system_alert`），明确告知用户发生了什么操作以及压缩了多少处内容。

## 阶段三：动态 Nudge 与任务状态卫士 (Dynamic System Reminder) ⏰
**目标**：解决大模型在执行多步复杂任务时，容易“遗忘”更新 Todos（`write_todos`）状态的问题。
**工作项**：
- [x] 在后端 `AgentExecutor.js` 的循环中，检测 TODO 列表状态。
- [x] 后端每轮自动将当前任务看板（`<current_tasks_status>`）注入消息序列末尾，与最后一条用户消息合并以保护 Cache。
- [x] 当连续 3 轮未更新 TODO 时，后端自动追加 `<system_reminder>` 催促提醒。

## 阶段四：Prompt Cache 结构感知排版 (Cache Alignment) 💰
**目标**：最大限度命中 Anthropic / DeepSeek 的 Prompt Cache 前缀缓存机制，大幅降低上下文携带的 Token 费用与首字延迟。
**工作项**：
- [x] 重新梳理 API 请求体的 `messages` 装配顺序。
- [x] **静态部分前置**：将 System Prompt 的核心身份定义、长效 Guidelines、Tools Definition 等固定内容放在最前面。
- [x] **动态部分后置**：将诸如“当前时间”、“动态获取的 Git 状态”或“系统 Nudge 提醒”等随对话轮次会变的内容（Dynamic Sections）放到 System 提示词的最末尾。

## 阶段五：虚拟文件系统抽象 (AFS) 与渐进式技能 (Progressive Skills) 🛠️
**目标**：摆脱粗暴的全能 Sandbox，建立安全的隔离工作区；支持在不撑爆 System Prompt 的前提下，挂载数百种领域技能。
**工作项**：
- [x] **物理只读技能库与扫描 API**：在根目录创建 `skills/` 只读库，后端通过 `/api/skills` 动态扫描 Markdown 提取首行标题和描述。
- [x] **Progressive Disclosure (技能元数据暴露)**：调整前端 Prompt Lab 及后端 Executor，在静态 System Prompt 末尾中仅放置可用技能元数据与 `read_file` 路径引导（如 `<available_skills>` 块），实现零 token 开销冷启动并保持前缀缓存友好。
- [x] **按需拉取与 ReAct 闭环**：大模型执行特定复杂任务（如 Conventional Commit 提交）时，根据引导自主发起 `read_file("skills/git-conventions.md")` 等调用来按需加载正文，从而完美解决 System Prompt 膨胀问题。
 
## 阶段六：会话持久化与恢复 (Session Persistence & Recovery) 💾
**目标**：实现会话状态的磁盘持久化，支持跨页面刷新、跨服务器重启的任务连续性。
**工作项**：
- [x] **后端存储层**：在 `server/` 目录下建立 `sessions/` 目录，用于存放每个会话的 JSON 状态。
- [x] **状态序列化**：重构 `App.jsx` 的会话维护逻辑。每当 `messages` 或 `todos` 更新时，自动（或节流地）将其推送到后端进行保存。
- [x] **自动恢复 (Rehydration)**：前端初始化时，根据当前选中的 Harness ID 自动尝试从后端拉取最近的会话记录，并恢复 UI 状态。
- [x] **后台任务联动**：如果配合异步 Job 管理器，会话恢复后应能自动重新“勾连”上仍在后台运行的任务，并在完成后通知用户。

## 阶段七：Harness 安全机制与防线设计 (Security & Defense) 🛡️
**目标**：解决原生 Agent 对系统高危权限不受控的问题，引入业界标准的权限分级与物理隔离策略。
**工作项**：
- [ ] **Fail-Closed 安全默认值**：扩充工具系统（如 `server/tools/index.js`），为每个工具设定 `isDangerous` 或 `isReadOnly` 属性，如果不显式声明则默认判定为危险工具。
- [ ] **全局 canUseTool 拦截钩子**：在前端 ReAct 循环（`TrajectoryPage.jsx`）执行高危破坏性工具（如 `bash` 或涉及核心文件覆盖的 `write_file`）前，挂起执行，弹出 Manual Review 弹窗强行要求用户手动确认。
- [ ] **内核级沙箱 (Containerization)**（高级特性）：新增基于 Docker / WASM 的动态沙箱运行器。Agent 执行不受信代码时，Harness 不在宿主机执行，而是动态拉起剥离敏感环境变量与网络权限的阅后即焚容器。

## 阶段八：Sub-agent 多智能体架构 (Sub-agent Architecture) 🤖
**目标**：实现“大任务拆小，干净的上下文”理念，防止长期复杂任务导致主模型 Context Window 被底层日志污染。
**工作项**：
- [x] **工具定义**：增加 `sub_agent` 工具，禁止其递归调用自身。
- [x] **后端子循环 (Sub-Loop)**：在后端 `AgentExecutor.js` 拦截 `sub_agent` 调用，实例化独立的子 AgentExecutor 并执行独立的 ReAct 循环。
- [x] **嵌套 UI 渲染**：将子代理在后端产生的所有事件流（如 `thinking`、`tool_use`）通过带有 `parentToolCallId` 的二级路由推送给前端，在前端主 Agent 的 `ToolCallCard` 中通过手风琴折叠面板可视化展现。
- [x] **摘要返回 (Context Discard)**：子循环结束后，只将最终的文本答案作为 `tool_result` 返回给主 Agent，彻底隔离中间噪音。

## 阶段九：可观测性与调试工具 (Observability & Debugging) 🔍
**目标**：让开发者能全面透视 Agent 的内部运行状态，降低调试门槛。
**工作项**：
- [x] **上下文检查器 (Context Inspector)**：在右上角 Tab 栏添加「🔍 查看上下文」按钮，点击弹出全屏模态框，展示 `buildApiMessages()` 处理后实际发送给 API 的完整上下文（System Prompt + Tools Schema + Messages 序列），每条消息按角色着色、按 block 类型分区渲染，支持一键复制 JSON。
- [x] **工具参数容错增强**：修复 `read_file` 和 `write_file` 因大模型参数命名混淆（`path` vs `filePath`）导致的 `undefined` 崩溃，改用宽松 `params` 对象解析。
- [x] **软清洗系统通知气泡**：压缩触发时在对话时间线中插入可视化的 🌊 `system_alert` 提示，告知用户具体发生了什么操作。

## 阶段十：长期记忆系统 (Persistent Memory) 🧠

**目标：** 实现跨会话、跨压缩的知识积累层。上下文压缩会有损，需要一层不参与压缩、持久保留的文件存储记忆，让 Agent 记住用户偏好、项目约定和关键事实。

**核心设计原则：**
- MEMORY.md 索引注入 system prompt（Prompt Cache 友好，内容不变时命中缓存）
- 具体记忆内容按需注入最后一条 user 消息（不破坏 cache 前缀）
- fire-and-forget 提取（onLoopEnd 异步，不阻塞主流程）
- 三层门控整理（文件数阈值 + 24h 间隔 + 锁文件）

**工作项：**
- [x] **memoryStore.js**：文件读写层，含写锁（防并发冲突）、harnessId 路径校验（防路径穿越）、UTF-8 安全截断（防多字节乱码），MEMORY.md 索引自动重建（最多 200 行 / 25KB）。
- [x] **memorySelect.js**：LLM side-query 按需选择相关记忆（最多 5 条，总预算 60KB），LLM 失败时降级关键词匹配。
- [x] **memoryExtract.js**：对话结束后 LLM 自动从最近 10 条消息中提取用户偏好 / 项目事实，写入持久化文件。
- [x] **memoryConsolidate.js**：三层门控定期整理（文件数 ≥ 10 + 24h 间隔 + .consolidate-lock 文件），LLM 去重 / 合并矛盾 / 淘汰过时，崩溃后 1h 自动恢复。
- [x] **MemoryPlugin.js**：主插件，`preLLM` 注入索引 + 内容，`onLoopEnd` fire-and-forget 提取 + 整理，全程不阻塞 SSE 主流程。
- [x] **FeatureSchema**：新增 `enable_memory` group，含 `memory_extract`（每轮提取）、`memory_consolidate`（定期整理，依赖前者）两个子项，联动约束：关闭提取时自动关闭整理。
- [x] **AgentExecutor**：按 `enable_memory.enabled` 条件挂载 MemoryPlugin。
- [x] **REST API**：`GET /api/memory/:harnessId`（查看记忆清单）、`DELETE /api/memory/:harnessId/:filename`（手动删除）。

## 阶段十一：记忆系统 CC 级增强（待实现）🔬

**目标：** 基于对 Claude Code 源码的深度分析（memdir/、services/ 等），将当前教学版记忆系统对齐到生产级实现。

**参考来源：**
- CC `memdir/memdir.ts`：`<appropriate_boundaries_re_memory>` 的"边界感"设计
- CC `query.ts:301-304`：memory prefetch 异步非阻塞机制
- CC `services/autoDream/autoDream.ts`：Dream 四层门控（时间 + 扫描节流 + 会话数 + 文件锁）

**改进项（按优先级排序）：**

- [ ] **Memory 使用规范注入 system prompt**（高优）
  在 MemoryPlugin.preLLM 注入的 system prompt 段追加使用规范：告知模型自然使用记忆，禁止暴露 RAG 机制的措辞（"根据记忆…" / "Based on your memories..." 等），对齐 CC 的 `<appropriate_boundaries_re_memory>` 设计——模型不要因有记忆就假装长期伙伴，每次交互都是有限的、文字层面的。
  **文件：** `server/agent/plugins/MemoryPlugin.js`

- [ ] **Memory prefetch 非阻塞异步化**（高优）
  当前 `selectAndLoadMemories` 在 preLLM 同步串行执行，会推迟 LLM 调用。改进方案：在 `onLoopStart` 时启动 prefetch Promise（异步），在 `preLLM` 时非阻塞 await 收集结果（工具执行期间并发进行），对标 CC `query.ts:301-304` 的机制。
  **文件：** `server/agent/plugins/MemoryPlugin.js`

- [ ] **整理门控增加"新增记忆数"维度**（中优）
  当前：文件数 ≥ 10 + 24h 间隔。CC 第三层门控是"距上次整理以来修改了 ≥ 5 个会话"。适配方案：额外增加"本次 session 新写入记忆数 ≥ 3"才触发整理，避免无信息增量时无谓调用 LLM。
  **文件：** `server/agent/memory/memoryConsolidate.js`

- [ ] **前端记忆管理 UI**（中优）
  在 PromptLabPage 侧边栏或新增 MemoryPage，调用 `GET /api/memory/:harnessId`，显示当前记忆文件清单（名称 / 类型 / 描述 / 修改时间），支持手动删除单条记忆。帮助用户理解"Agent 记住了什么"，降低记忆系统的黑箱感。
  **文件：** `src/pages/PromptLabPage.jsx` 或新增页面

- [ ] **memory_consolidate 子开关的 UI 灰化**（低优）
  当 `memory_extract` 未开启时，`memory_consolidate` 复选框应显示为灰度不可点击状态。当前仅有逻辑联动（关闭时自动级联关闭），缺少视觉提示。
  **文件：** `src/pages/PromptLabPage.jsx`

## 阶段十二：可恢复的任务依赖系统 (DAG Task System) 🕸️

**目标**：为 LLM Space 引入持久化、防死锁、高并发文件锁保护以及 Prompt Cache 缓存对齐的 DAG 任务依赖系统特性。

**工作项**：
- [x] **taskManager.js**：实现后端任务物理读写、Kahn 算法检测环、claim 写入锁。
- [x] **原子任务工具集**：完成 create_task, list_tasks, get_task, claim_task, complete_task 五个工具的编写与注册。
- [x] **TaskSystemPlugin.js**：完成 preLLM（静前动后缓存拆分注入）、preToolUse（拦截并广播 task_update）、onLoopEnd（崩溃事务自动回滚）。
- [x] **DELETE REST API**：重置 Session 时自动清空物理任务文件夹。
- [x] **TodoList.jsx**：React 组件渲染 blockedBy 依赖链及 Owner 分配。
- [x] **FeatureSchema.js**：重构删除 `todo_nag`，合并并引入顶层 `task_manager` 特性组与模式选择项（支持 `todo` 与 `task_system` 模式）。
- [x] **AgentExecutor.js**：重构物理过滤并动态拼装 `write_todos` 或是 5 个原子任务工具，免除用户手动开关 6 个原子工具。
- [x] **PromptLabPage.jsx**：隐藏工具列表中的 6 个物理原子工具，并支持通用的 `select` 特性在 UI 配置面板的动态下拉渲染。
- [x] **Harness Configs**：批量更新并重构 preset 配置，精简 tools 属性，采用新版 `task_manager` 一键装配。

## 阶段十三：后台任务 CC 级增强（待实现） ⏱️

**目标**：提升后台任务机制的工业级鲁棒性，应对长耗时、交互式卡死及大规模日志堆积等复杂场景。

**核心增强项**：
- [ ] **停滞看门狗 (Stall Watchdog)**：
  - 定期检测后台任务的 `stdout`/`stderr` 输出是否停滞。
  - 若超过 45 秒没有任何新字符输出，自动进行启发式检测（如末尾是否挂在 `(y/n)` 等交互式提示上）。
  - 若确认为异常挂起，及时 Kill 进程并向 Agent 发送通知，防止被无人干预的交互框卡死。
- [ ] **优先级的通知队列 (Priority Notification Queue)**：
  - 为后台任务的完成事件建立发送队列，区分 `next`（立即通知）和 `later`（稍后通知）优先级。
  - 默认采用 `later`，意味着在用户主动交互期间不会粗暴打断，而是聪明地在下一轮闲置或 Agent 发言时段进行注入。
- [ ] **输出重定向到文件 (File-backed Logging)**：
  - 摒弃当前直接将子进程日志无限拼接到内存字符串 `bgTask.output` 中的做法。
  - 将后台任务的 `stdout`/`stderr` 重定向写入物理磁盘上的特定日志文件。
  - 避免面对超大规模编译或构建时，因输出过大撑爆 V8 内存或导致 Node.js 崩溃。
- [ ] **用户/大模型干预交互 (Task Intervention / stdin Passthrough)**：
  - 允许大模型或用户通过专属指令（或前端 UI 的 Terminal 输入框）向后台挂起的进程发送 `stdin` 键盘输入（如发送 `y\n`）。
  - 彻底解决交互式对话框导致的死锁问题，使后台任务真正具备完全互动的能力。

## 阶段十四：任务编排与 Agent Teams MVP 闭环（进行中） 🤝

**目标**：将任务相关能力统一收敛到 Task Orchestration 下，支持可拆卸实验与一键策略预设，并完成 Agent Teams 的最小可用闭环。

**已完成**：
- [x] **Task Orchestration 统一入口**：将 TODO、DAG Task System、Sub-agent、Cron、Background Tasks、Agent Teams 归入统一任务编排配置边界。
- [x] **执行策略层**：新增 `Inline Execution`、`Sequential Sub-agent Workflow`、`Async Agent Teams`、`Custom` 策略，并支持策略 guideline 预览和自定义。
- [x] **Sub-agent 优化**：修复递归/工具挂载边界，优化简单任务不过度 DAG 化，并将子代理轨迹从主消息树中拆出，支持懒加载详情与卡片状态摘要。
- [x] **Agent Teams MVP**：实现 `spawn_teammate`、`send_team_message`、`check_team_inbox`，通过 TeamBus 和 TeamStateStore 支持有限异步 teammate、结构化 brief、状态持久化、lead inbox 汇总。
- [x] **Teams 可观测性**：前端 `spawn_teammate` 卡片显示 teammate 当前状态、任务摘要和完成数，减少异步执行时的黑箱感。
- [x] **Teams 最小闭环收尾**：新增 `wait_for_teammates` 作为 join 点，等待 teammate 进入 `completed`、`failed`、`cancelled`、`no_result` 等终态后返回 team status 和 Lead inbox，降低 lead 过早总结的概率。

**后续计划**：
- [ ] **Team Dashboard 轻量增强**：展示 team 列表、teammate 状态、未读 inbox、失败/超时/无结果标识，并支持按需展开 teammate 轨迹。
- [ ] **Teammate 生命周期管理**：增加 cancel、retry、ignore/adopt result 等控制能力，避免 teammate 失败或跑偏后只能靠自然终止。
- [ ] **组合策略预设**：提供 `Todo + Teams`、`DAG + Teams`、`Sequential Review` 等实验预设，同时保留底层 primitives 的可拆卸自定义能力。
- [ ] **协议层增强**：在 TeamBus 消息类型中逐步加入 `partial_result`、`question`、`blocker`、`review` 等类型，为未来 autonomous team pool 留接口。
- [ ] **Worktree Isolation / Autonomous Teams**：在 MVP 稳定后，再探索独立工作区、多 teammate 长时运行和自主团队池。
