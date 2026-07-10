# 更新日志

这里保存详细项目更新历史，README 只保留摘要和入口。

## 最近更新

### 2026-07-10：Knowledge Base / RAG Pipeline 闭环

- **可挂载知识库**：支持创建本地 Knowledge Base，导入文件，生成 chunk 与索引，预览检索结果，并将指定知识库挂载到 Harness 对话中。
- **文档 loader**：支持 Markdown、text、JSON、CSV、PDF、DOCX，通过轻量 loader adapter 统一解析。
- **Embedding 与向量存储**：支持智谱 `embedding-3`、OpenAI-compatible embedding API、Local JSON 向量存储和 Qdrant。
- **Qwen3 rerank**：支持通过阿里云百炼 / Model Studio 的 Qwen3 Rerank 对初召回 chunks 进行二次排序。
- **运行时策略**：Auto RAG、Agentic RAG、Manual Lab 三种模式让检索行为可配置、可观察、可拆卸。
- **Retrieval evaluation records**：Recent Retrieval Records 会展示 initial recall、rerank、final result counts、top scores 和 source summaries，但不落盘 chunk 正文。
- **Context Inspector 集成**：Mounted Knowledge Manifest 与 Retrieved Knowledge 独立展示，和 system prompt、messages payload、provider tool schema 分层区分。

### 2026-06-20：进程内定时任务调度器 MVP

- **Agent 自主管理任务**：通过 `schedule_cron`、`list_crons`、`cancel_cron` 创建、查看和取消当前 Harness 下的定时任务。
- **持久化执行链路**：五字段 cron 表达式进入进程内事件队列，运行时解析最新模型配置，并复用现有 `AgentExecutor` 完成执行。
- **可视化定时轨迹**：Scheduled Prompt、工具调用、最终回答、成功/失败次数和任务状态会显示在轨迹及 Scheduled Tasks 面板中。
- **持久化执行历史**：最近的运行记录会保存开始/结束时间、耗时、结果和错误，并可在服务重启后继续查看。
- **安全的后台执行**：Harness 忙碌时任务进入队列，避免并发 Agent Loop；前端通过 SSE 自动附着和 session 同步展示后台结果。

### 2026-06-13：可恢复的有向无环图任务系统

- **后端任务依赖流**：支持基于 DAG 的复杂任务系统，内置 Kahn 算法死锁检验、Claim 排他性文件锁并发保护，以及 Agent 异常崩溃退出时的物理看板租约自动回滚。
- **缓存友好与去重装配**：重构插件 lifecycle 和 `preLLM` 注入。静动态状态 Diff 拆分注入，以提升模型 KV Cache / Prompt Cache 命中率。
- **XML 标签防重注入**：对运行时状态块做防重过滤，避免续写或多轮调用中重复注入同语义内容。
- **Prompt Lab 指引词自定义 UI**：实验特性中提供可编辑 XML 指引词，支持局部草稿、一键重置默认值和长内容滚动编辑。

