# LLM-Space 开发规范与指导思想 (Development Spec & Philosophy)

> 这个文档不仅是代码规范，更是我们在构建、踩坑、重构 LLM-Space 的过程中提炼出的核心哲学。任何新的特性开发、架构调整都必须首先与本指南对齐。

## 一、 核心指导思想 (Core Philosophy)

### 1. 透明度与控制权 (Transparency & User Control) —— 拒绝黑盒魔法
- **所见即所得**：底层 Harness 绝不能在用户不知情的情况下，使用脆弱的启发式规则（如正则提取、猜测意图）去篡改核心数据（如重新排列 System Prompt）。
- **把控制权交还用户**：高级特性的优化（如 Prompt Cache 对齐）应该通过明确的标签引导或让用户自行排版来实现。Harness 的职责是忠实传递指令和提供基础设施，而不是“越俎代庖”地替用户做聪明的决定。

### 2. 渐进式复杂度 (Progressive Complexity) —— 保持沙盒属性
- **特性解耦**：LLM-Space 本质是一个 Agent 架构实验室。所有前沿的 Harness 机制（并发工具执行、硬核上下文压缩、思维链注入）都必须是 **可插拔配置（Feature Flags）**。
- **由简入繁**：允许用户在一个极简的 ReAct 循环下开始，当遇到瓶颈时，再通过打开相应的开关来体验架构升级带来的变化。不要将极端的复杂度强加于简单的任务。

### 3. 极端防御性设计 (Extreme Defensive Design) —— 为混沌而生
- **防崩溃底线**：大模型的输出永远是不可靠且充满幻觉的（比如将 Array 捏造成 Number），网络连接也随时会中断。
- **层层设防**：从后端的 API 请求解析、工具流式执行（`try-catch` 到底），到前端的 React 状态渲染，每一层接收外部数据时都必须做强制类型转换和防御性检查（如 `Array.isArray` 兜底），确保单次调用失败不会导致整个循环进程崩溃。

---

## 二、 上下文与内存工程准则 (Context & Memory Engineering)

> 大模型的能力边界由它的注意力机制决定，而上下文工程就是 Harness 的核心护城河。

### 1. 缓存友好架构 (Cache-First Architecture)
在装配发给大模型的 API Payload 时，必须严格遵循 **“静前动后”** 原则，以榨干 Anthropic/DeepSeek 前缀缓存的价值：
- **静态区（最前方）**：放置数万 Token 且几乎不发生变化的 System Prompt、角色设定、工具全集 (Tools Schema)。
- **动态区（大后方）**：将变化极快的当前时间、动态目录、任务看板状态 (`<current_tasks_status>`) 放置在 Payload 的最末尾。

### 2. 内存防爆三道防线 (Memory Overflow Defense)
绝对不能让长轮次任务撑爆 Context Window：
- **第一道防线 (Offload 物理隔离)**：除了必须让模型完整阅读的 `read_file` 外，其余所有工具一旦输出超过指定阈值（如 20KB），必须强行拦截落盘，仅向上文返回首尾摘要预览。
- **第二道防线 (Soft Compact 软清洗)**：当 Token 超过危险水位（如 80%），动态折叠历史中已经不需要的工具返回（如旧的终端输出、旧的代码写入记录），释放空间并保持对话轴不断档。
- **第三道防线 (Hard Compact 语义纪元)**：当系统濒临崩溃，备份全量物理日志，后台静默启动摘要生成，将万字历史浓缩为百字战局梗概，清空上文，开创新纪元。

### 3. 保持主线纯洁 (Sub-agent Delegation)
复杂的长期探索和试错过程，其产生的垃圾上下文会严重污染主模型的判断力。
- 对于发散性研究，应强制委托给 `sub_agent` 子代理运行。
- 主模型的 Context 中，永远只保留子代理返回的“最终提纯摘要”。

---

## 三、 状态流转与网络通信 (State Sync & Network)

### 1. 打破双向绑定死循环 (Break the Sync Cycle)
在 React 前端与后端/持久化层的状态同步中，极易产生“乒乓效应”（如：被动同步触发主动上报，主动上报改变全局状态，全局状态再次触发被动同步）。
- **解法**：状态流转必须有明确的 **Source of Truth**。在被动接收后端状态同步时，必须使用 `Ref` 预填标记，拦截前端再次将其作为“新输入”广播回去，从物理上切断反馈死循环。

### 2. 后台优先的生命周期 (Background-First Lifecycle)
Agent 的物理生命周期与前端页面生命周期是解耦的。
- **前端只是监视器**：Harness 的 ReAct 循环在后端 `AgentExecutor` 独立存活。
- **断线免疫**：用户关闭浏览器、刷新页面，Agent 必须能在后台继续默默运行。当用户重新打开页面时，前端应通过 `harnessId` 主动查询 `/api/agent/status` 并自动 Attach 到 SSE 流，无缝恢复现场。

---

## 四、 工具与技能扩展 (Tools & Skills)

### 1. 按需渐进式加载 (Progressive Discovery)
- **告别臃肿**：无论系统内集成了 100 种还是 1000 种专业技能指南，**永远不要**把它们的全文塞进 System Prompt。
- **动态寻址**：在 Prompt 中仅暴露技能的名称、简短描述与对应的 Markdown 文件路径。让大模型在需要调用某个专业技能时，自主使用 `read_file` 工具去按需获取该技能的详细指南，实现零开销启动。

### 2. Fail-Closed 权限控制
- 任何能够修改物理磁盘、执行系统命令的工具，在设计上默认都是危险的。
- 未来的演进中，对于高危操作（如 `bash`），Harness 应具备挂起执行、强制要求用户 `Manual Review` 的拦截能力，将破坏范围锁死在沙箱之内。

---

## 五、 编码与架构规范 (Coding & Architecture Specs)

### 1. 模块化与可拆卸性 (Modular & Detachable)
- **高内聚低耦合**：新增加的 Harness 特性（如上下文压缩、子代理管理、状态落盘）必须被封装在独立的函数或模块中（例如 `messageBuilder.js` 中的纯函数），避免将数千行逻辑全部堆砌在 `AgentExecutor` 类中。
- **纯函数优先**：像 Token 估算、Payload 装配、软压缩等逻辑，必须设计为零副作用的**纯函数 (Pure Functions)**，方便独立进行单元测试，也确保这些过程不会意外污染对象的状态。
- **可选配 (Feature Flags)**：任何改变核心运行逻辑的新特性，在初期必须通过 `features.xxx_enabled` 的开关来控制，确保如果不开启该特性，代码逻辑能 100% 走经典 ReAct 路径。

### 2. Hook-Based Agent Loop 架构 (生命周期规范)
参考业界成熟的 Agent 设计理念（如 Claude Code），在 `AgentExecutor` 的主循环（ReAct Loop）中插入新特性或功能时，必须严格遵守基于 Hook（生命周期钩子） 的流转顺序。
我们应该避免把所有的 `if-else` 堆砌在主循环中，未来的扩展应遵循以下标准化执行流水线：

1. **`UserPromptSubmit` (用户输入处理)**：
   - 作用：记录、注入、审计用户输入。
   - 时机：循环开始前。例如初始的 Token 检查、防暴走检测。

2. **`PreLLM / State Assembly` (大模型调用前)**：
   - 作用：组装上下文与记忆。
   - 机制：
     - **cron / background**：注入后台任务的完成通知（`<task_notification>`）。
     - **Compaction**：触发上下文软清洗（Soft Compact）或纪元重建（Hard Compact）。
     - **Prompt Builder**：动静分离、注入按需加载的 Skills 列表、合并 `todos` 看板状态（`<current_tasks_status>`）。

3. **`LLM Call` (网络请求层)**：
   - 作用：发起模型请求，处理超时、502 重试、Fallback 降级。
   - 错误恢复：如遇请求失败，不应直接崩溃，而是记录 Error Message 并结束当前轮次，等待人类干预或自动重试。

4. **`PreToolUse` (工具执行前防线)**：
   - 作用：拦截与权限审查。
   - 机制：当解析到 `tool_use` 块时，在此处验证是否是危险命令。未授权的写入或高危 Bash 可以在此挂起，并请求前端提供手动审批（Manual Review）。

5. **`Tool Dispatch` (工具调度与执行)**：
   - 作用：真正的物理层执行。
   - 机制：并发调度（基于 `features.parallel_tool_execution`），或者将慢速的 Bash 任务派发到后台 daemon 线程，主循环先返回占位结果。

6. **`PostToolUse` (工具后处理)**：
   - 作用：结果审计与落盘。
   - 机制：大输出文本的自动物理截断与卸载（Offload），向前端发送实时的 `tool_exec_done` 广播。

7. **`Stop` (循环退出)**：
   - 作用：统计、清理与状态结算。
   - 机制：如果本轮没有 `tool_use`（模型输出纯文本），则触发 `saveSession` 持久化，并向前端广播回合结束，等待下一轮用户输入。
