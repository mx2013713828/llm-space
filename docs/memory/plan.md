# LLM-Space 架构优化阶梯计划

根据业界先进的 Agent Harness（如 Claude Code 等）的设计哲学，我们将把目前的架构从“基础雏形”升级为“专业级工业底座”。本计划按照**“收益从高到低、实现成本从低到高”**的阶梯式顺序推进：

## 阶段一：并行工具执行 (Parallel Tool Execution) 🚀
**目标**：打破 Agent 运行瓶颈，让多个并行的 Tool Call 实现真正的并发执行。
**工作项**：
- [ ] 改造前端 `TrajectoryPage.jsx` 的 `runAgentLoop` 方法。
- [ ] 将目前的 `for...of` 串行等待网络请求 (`fetch`) 的逻辑，重构为基于 `Promise.all()` 的并发请求逻辑。
- [ ] 确保前端在并发结束后，按原始顺序统一将 `tool_result` 组装并发送给 LLM。

## 阶段二：上下文卸载机制 (Context Offloading) 🛡️
**目标**：解决 `bash` 或 `read_file` 返回结果过长导致大模型 Context Window 爆炸的问题，实现“装不下就暂时放磁盘”。
**工作项**：
- [ ] 在后端 `/api/execute-tool` 接口（或每个单独的 tool 内部）增加一个**安全拦截层**。
- [ ] 设定阈值（例如单次输出长度 > 2000 字符时触发）。
- [ ] 触发 Offloading 时，将原始超长文本保存到项目根目录下的 `.agent-tmp/` 目录中。
- [ ] 向大模型返回一个仅包含数十 Token 的占位符（例如 `[OFFLOADED] saved to .agent-tmp/xxx.log (3542 tokens). Use read_file to retrieve.`）。

## 阶段三：动态 Nudge 与任务状态卫士 (Dynamic System Reminder) ⏰
**目标**：解决大模型在执行多步复杂任务时，容易“遗忘”更新 Todos（`write_todos`）状态的问题。
**工作项**：
- [ ] 在 `TrajectoryPage.jsx` 的事件循环中，检查当前 Harness 是否配置了 `write_todos` 相关能力。
- [ ] 如果存在未完成的任务（`pending` / `in_progress`），在发往 LLM 的新一轮请求的最后，硬编码插入一条 `<system-reminder>`。
- [ ] 提醒内容：“你还有未标记为 completed 的 TODO，请在采取下一步行动前使用 write_todos 更新状态。”

## 阶段四：Prompt Cache 结构感知排版 (Cache Alignment) 💰
**目标**：最大限度命中 Anthropic / DeepSeek 的 Prompt Cache 前缀缓存机制，大幅降低上下文携带的 Token 费用与首字延迟。
**工作项**：
- [ ] 重新梳理 API 请求体的 `messages` 装配顺序。
- [ ] **静态部分前置**：将 System Prompt 的核心身份定义、长效 Guidelines、Tools Definition 等固定内容放在最前面。
- [ ] **动态部分后置**：将诸如“当前时间”、“动态获取的 Git 状态”或“系统 Nudge 提醒”等随对话轮次会变的内容（Dynamic Sections）放到 System 提示词的最末尾。

## 阶段五：虚拟文件系统抽象 (AFS) 与渐进式技能 (Progressive Skills) 🛠️
**目标**：摆脱粗暴的全能 Sandbox，建立安全的隔离工作区；支持在不撑爆 System Prompt 的前提下，挂载数百种领域技能。
**工作项**：
- [ ] **AFS (Agent File System)**：重构后端的 `read_file`, `write_file`, `bash` 等工具，增加路径隔离。定义 `/mnt/workspace/` 为工作区，`/mnt/skills/` 为只读技能库。
- [ ] **Progressive Disclosure**：调整前端 Prompt Lab，在 `<skills>` 标签内仅放置各技能的元数据（`name` 与 `description` 及虚拟路径）。
- [ ] **按需拉取**：大模型需要调用某项复杂能力时，依靠现有的 `read_file` 工具读取该技能的 `SKILL.md` 正文，从而达到极低的冷启动成本与无限的能力伸缩空间。
