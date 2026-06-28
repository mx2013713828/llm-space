# 改造双阶段上下文压缩与恢复工作 Prompt 自动注入实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改造双阶段上下文压缩，支持 9-section 压缩 Prompt 并实现分析剥离和任务恢复 Prompt 自动注入。

**Architecture:** 
1. **定义 Prompt 常量**：新建 `server/agent/compactPrompt.js`，导出 `COMPACT_PROMPT` 常量。
2. **改造软折叠逻辑**：在 `src/lib/messageBuilder.js` 中增加条件判断，避免二次折叠已存盘文件。
3. **改造 Hard-Compact 逻辑**：在 `server/agent/AgentExecutor.js` 中引入 `COMPACT_PROMPT`，进行全量摘要解析，剥离 `<analysis>` 标签，提取 `<summary>` 内容，并在重建消息流尾部自动注入恢复工作的 system 提示词。

**Tech Stack:** Node.js, JavaScript (ES modules)

---

### Task 1: 新建 `server/agent/compactPrompt.js` 声明 9-section 压缩 Prompt

**Files:**
- Create: `server/agent/compactPrompt.js`

- [ ] **Step 1: 新建 `server/agent/compactPrompt.js`，声明 `COMPACT_PROMPT` 并导出。**

```javascript
// server/agent/compactPrompt.js
export const COMPACT_PROMPT = `You are a master summary assistant.
Your task is to summarize the ongoing conversational history between the user and the agent coding assistant.
Analyze the complete history step-by-step.

You MUST wrap your chronological review process inside <analysis> tags first.
After completing the analysis, you MUST provide a detailed narrative summary wrapped inside a <summary> tag.

The <summary> content MUST follow this 9-section narrative structure:
1. Primary Request and Intent: What is the user's ultimate goal?
2. Key Technical Concepts: Frameworks, paradigms, or design choices discussed.
3. Files and Code Sections: Exact files modified/created, line ranges investigated, and key changes.
4. Errors and Fixes: Specific errors encountered and how they were resolved.
5. Problem Solving Progress: Which tasks are completed? Which approaches were chosen and why?
6. Verbatim User Messages: Critical requirements or strict constraints the user explicitly wrote.
7. Offloaded Files Manifest: A list of any offloaded big result files (e.g., .offloaded/offload-*.txt) and their contents.
8. Pending Tasks: What is outstanding?
9. Next Immediate Steps: Where should the agent resume?

CRITICAL CONSTRAINTS:
- Do NOT try to call any tools during this task. You must respond in pure text.
- Do NOT output any introductory text or conversational filler. Start directly with the <analysis> block.`;
```

---

### Task 2: 改造软折叠逻辑（`src/lib/messageBuilder.js`）

**Files:**
- Modify: `src/lib/messageBuilder.js:184-189`

- [ ] **Step 1: 修改 `src/lib/messageBuilder.js` 的 `compactMessages` 中对工具大输出折叠的处理。**
在折叠前增加条件判断：如果 `newMsg.toolOutput` 中包含了 `'OUTPUT OFFLOADED TO FILE:'` 标志字样，直接跳过不进行二次截断折叠。

```diff
       } else if (['ls', 'grep', 'web_search', 'web_fetch'].includes(newMsg.toolName) && newMsg.toolOutput && newMsg.toolOutput.length > 2000) {
-        // 机制 B：对旧的 ls/grep/web_search/web_fetch 输出，越过阈值（2000）则截断折叠
-        const head = newMsg.toolOutput.slice(0, 1000);
-        newMsg.toolOutput = `${head}\n\n...[已折叠旧的工具输出结果]...`;
-        compactedCount++;
+        // Skip secondary compaction if this tool call has already been offloaded to disk
+        if (!newMsg.toolOutput.includes('OUTPUT OFFLOADED TO FILE:')) {
+          const head = newMsg.toolOutput.slice(0, 1000);
+          newMsg.toolOutput = `${head}\n\n...[已折叠旧的工具输出结果]...`;
+          compactedCount++;
+        }
       }
```

---

### Task 3: 改造 `AgentExecutor.js` 的 Hard-Compact 全量摘要解析与恢复词注入

**Files:**
- Modify: `server/agent/AgentExecutor.js`

- [ ] **Step 1: 在 `AgentExecutor.js` 头部引入 `COMPACT_PROMPT`。**
在 `AgentExecutor.js` 的 `messageBuilder.js` 导入下方导入 `COMPACT_PROMPT`。

```diff
 import { buildApiMessages, compactMessages, estimateTokens, injectTodoState, alignRequestPayload } from './messageBuilder.js';
+import { COMPACT_PROMPT } from './compactPrompt.js';
```

- [ ] **Step 2: 重构 Hard-Compact 解析逻辑，剔除 `<analysis>` block，提取 `<summary>` 内容并注入任务恢复 Prompt。**
修改 `AgentExecutor.js` 的 `run()` 中 `Hard-Compact` 的部分：
1. 将硬压缩里的 `summaryRaw = await this._callLLMNonStream(summaryMessages, ...)` 的 System Prompt 参数替换为 `COMPACT_PROMPT`。
2. 使用正则表达式剔除 `summaryRaw` 中的 `<analysis>...</analysis>` 块及其内容。
3. 使用正则表达式从剩余文本中提取 `<summary>...</summary>` 内的实际文本。若未匹配到，则用 `replace(/<\/?summary>/gi, '').trim()` 作为兜底移除标签后保留其余文本。
4. 重构重组后的消息历史 `this.messages = [summaryMsg, ...activeMessages, resumeMsg]`。

```diff
-            const summarySystemPrompt = `You are a master summary assistant. Your task is to summarize the ongoing conversational history between the user and the agent coding assistant.
-Provide a highly dense, professional project status update and memory manifest containing:
-1. Current Goal: What is the user's ultimate request?
-2. Progress Made: What files have been modified or created? What was investigated?
-3. Key Discoveries/Blockers: What did the agent find out?
-4. Current Status: What is the next immediate task? What items are left?
-5. Critical Constraints: Any absolute rules or constraints the user defined.
-Make sure to keep this summary extremely concise but packed with precise details (line ranges, file paths, variables).
-Do not output any introductory text; start directly with the markdown summary list.`;
-
-            const summary = await this._callLLMNonStream(summaryMessages, summarySystemPrompt);
-            console.log('✅ Hard-Compact 语义摘要生成成功，长度为:', summary.length);
+            const summaryRaw = await this._callLLMNonStream(summaryMessages, COMPACT_PROMPT);
+            
+            let summary = summaryRaw;
+            // Remove <analysis>...</analysis> tags and contents if present
+            summary = summary.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim();
+            // Try to extract the summary content inside <summary>...</summary>
+            const summaryMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(summary);
+            if (summaryMatch) {
+              summary = summaryMatch[1].trim();
+            } else {
+              // Strip leftover tags as fallback
+              summary = summary.replace(/<\/?summary>/gi, '').trim();
+            }
+            
+            console.log('✅ Hard-Compact 语义摘要生成成功，长度为:', summary.length);
 
             // 4. 重建 messages 消息队列 (保留最近 3 轮 of 活跃对话)
             const activeMessages = this.messages.filter(msg => turnIndex - (msg.turn || 1) < 3);
 
             const summaryMsg = {
               role: 'system',
               type: 'system_alert',
               turn: turnIndex,
               content: `[System Memory Compacted]\nHere is the summarized history of the project so far:\n\n${summary}\n\nThe complete historical transcript has been persisted to disk.`
             };
 
-            this.messages = [summaryMsg, ...activeMessages];
+            // 注入恢复工作的 Prompt 指令
+            const resumeMsg = {
+              role: 'system',
+              type: 'system_alert',
+              turn: turnIndex,
+              content: `Please continue the conversation from where we left it off without asking the user any further questions. Continue with the last task that you were asked to work on.`
+            };
+
+            this.messages = [summaryMsg, ...activeMessages, resumeMsg];
             this.contextTokens = 0; // 重置 token 估算缓存
```

---

### Task 4: 验证编译与测试

- [ ] **Step 1: 运行 `npm run build`。**
运行: `npm run build`
预期: 无报错，编译成功。

- [ ] **Step 2: 运行现有测试或编写新测试。**
我们将运行 `node scratch/test-compact-offload.js` 以测试和验证我们所做的修改。

- [ ] **Step 3: Git Commit。**
命令行: 
```bash
git add server/agent/compactPrompt.js src/lib/messageBuilder.js server/agent/AgentExecutor.js
git commit -m "feat(agent): support 9-section compact prompt with analysis stripping and auto task-resumption injection"
```
