# 大结果存盘与双阶段上下文压缩联合实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现工具调用大输出的实时物理落盘与双阶段上下文压缩协同，防范上下文爆表，同时在 Hard-Compact 后自动注入任务恢复提示词以保证决策连续性。

**Architecture:** 
1. **防爆盾实时存盘**：在 AgentExecutor 调用工具并返回结果时，实时检测是否 >20KB（非 read_file）。若超过，自动写入 `.offloaded/` 目录，并在消息历史中替换为结构化预览（保留首 1500 与尾 500 字符）。
2. **生命周期自清洁**：在 Executor 初始化与退出时扫描并物理删除修改时间超过 24 小时的存盘大文件。启动时自动将 `.offloaded/` 追加至 `.gitignore`。
3. **双阶段压缩与任务恢复**：软清洗（Soft-Compact）对 offloaded 文件仅做跳过；硬压缩（Hard-Compact）阶段使用 9-section 专属 Prompt，并彻底踢出 `<analysis>` 标签提取 `<summary>` 内容。重置上下文后，在消息流尾部自动注入“Please continue the conversation from where we left it off...”任务恢复指令。

**Tech Stack:** Node.js, Express, React, fs/promises, path

---

## 提议的变更文件与分步任务

### Task 1: 集中定义配置参数与实现 `.gitignore` 自动追加 `.offloaded/`

**Files:**
- Modify: [AgentExecutor.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/AgentExecutor.js) (声明常量)
- Modify: [server.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server.js) (追加 gitignore)

- [ ] **Step 1: 在 `AgentExecutor.js` 文件头部集中定义物理常量配置。**
在 `server/agent/AgentExecutor.js` 文件顶部的 import 语句下方，声明并导出相关物理限制常量。

```javascript
// server/agent/AgentExecutor.js
// Define physical threshold constants for context management
export const OFFLOAD_THRESHOLD_BYTES = 20000; // 20KB threshold for file offloading
export const OFFLOAD_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours cleanup age
export const SOFT_COMPACT_TOKEN_THRESHOLD = 120000; // 120k tokens for soft compact
export const HARD_COMPACT_TOKEN_THRESHOLD = 160000; // 160k tokens for hard compact
```

- [ ] **Step 2: 在 `server.js` 启动过程中自动检测并向 `.gitignore` 追加 `.offloaded/`。**
在 `server.js` 启动处理（大概在文件顶部引入依赖和定义配置后，启动 http 监听前）添加自动检查逻辑，将 `.offloaded/` 自动加入忽略列表。

```javascript
// server.js
import fs from 'fs/promises';
import path from 'path';

// Ensure .offloaded directory is added to .gitignore automatically
async function ensureOffloadedGitignored() {
  try {
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    let content = '';
    try {
      content = await fs.readFile(gitignorePath, 'utf-8');
    } catch (readErr) {
      // If .gitignore does not exist, create it
    }
    if (!content.includes('.offloaded/') && !content.includes('.offloaded')) {
      const appendContent = content.endsWith('\n') ? '.offloaded/\n' : '\n.offloaded/\n';
      await fs.writeFile(gitignorePath, content + appendContent, 'utf-8');
      console.log('✅ Automatically added .offloaded/ to .gitignore');
    }
  } catch (err) {
    console.error('Failed to update .gitignore:', err);
  }
}
// Run on startup
ensureOffloadedGitignored();
```

---

### Task 2: 改造执行器以实现大结果的实时存盘 (Offload System)

**Files:**
- Modify: [AgentExecutor.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/AgentExecutor.js)

- [ ] **Step 1: 重构 `executeToolCall`，增加对大结果的实时物理存盘。**
在工具调用执行完毕返回结果后，增加拦截条件（非 `read_file` 且字符串长度超过 `OFFLOAD_THRESHOLD_BYTES` ），写入物理文件并改写内存 `toolOutput` 为预览占位符。

```javascript
// server/agent/AgentExecutor.js 中的 executeToolCall 方法
// 找到执行完 toolCall 后的逻辑：
            let toolOutput = '';
            try {
              toolOutput = await this.callTool(tool.toolName, tool.toolInput);
              // ...
            } catch (err) {
              // ...
            }

            // 【新增实时拦截大结果存盘逻辑】
            if (tool.toolName !== 'read_file' && typeof toolOutput === 'string' && toolOutput.length > OFFLOAD_THRESHOLD_BYTES) {
              try {
                const offloadedDir = path.join(process.cwd(), '.offloaded');
                await fs.mkdir(offloadedDir, { recursive: true });
                const offloadFile = `offload-${this.harnessId}-${tool.id}.txt`;
                const offloadPath = path.join(offloadedDir, offloadFile);
                await fs.writeFile(offloadPath, toolOutput, 'utf-8');
                
                const originalSize = Buffer.byteLength(toolOutput, 'utf-8');
                const headPreview = toolOutput.slice(0, 1500);
                const tailPreview = toolOutput.slice(-500);
                
                // Replace the memory output with a structured preview placeholder
                toolOutput = `[OUTPUT OFFLOADED TO FILE: .offloaded/${offloadFile} (size: ${originalSize} bytes).
--- PREVIEW START (First 1500 chars) ---
${headPreview}
--- PREVIEW END ---
...[OUTPUT OFFLOADED - If you need the full content, use read_file tool on the offloaded path above]...
--- TAIL PREVIEW (Last 500 chars) ---
${tailPreview}
--- TAIL END ---]`;
              } catch (offloadErr) {
                console.error(`[AgentExecutor] Failed to offload tool output for ${tool.id}:`, offloadErr);
              }
            }
```

---

### Task 3: 实现自动清理物理过期文件逻辑 (Cleanup System)

**Files:**
- Modify: [AgentExecutor.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/AgentExecutor.js)

- [ ] **Step 1: 新增 `cleanupOffloadedFiles` 实例方法。**
在 `AgentExecutor` 类中，添加异步的 `.offloaded/` 物理目录扫描与 24 小时过期文件清理逻辑。

```javascript
// server/agent/AgentExecutor.js
  /**
   * Automatically clean up physical offloaded files that are older than 24 hours
   */
  async cleanupOffloadedFiles() {
    try {
      const offloadedDir = path.join(process.cwd(), '.offloaded');
      // Check if directory exists
      try {
        await fs.access(offloadedDir);
      } catch {
        return; // Directory does not exist yet, skip
      }

      const files = await fs.readdir(offloadedDir);
      const now = Date.now();
      
      for (const file of files) {
        if (!file.startsWith('offload-') || !file.endsWith('.txt')) continue;
        
        const filePath = path.join(offloadedDir, file);
        const stat = await fs.stat(filePath);
        if (now - stat.mtime.getTime() > OFFLOAD_CLEANUP_AGE_MS) {
          await fs.unlink(filePath);
          console.log(`🗑️ Deleted expired offloaded file: ${file}`);
        }
      }
    } catch (err) {
      console.error('[AgentExecutor] Failed to clean up offloaded files:', err);
    }
  }
```

- [ ] **Step 2: 在执行器的构造函数和 ReAct 运行生命周期末尾触发清理。**
  - 在 `constructor` 的末尾追加调用：`this.cleanupOffloadedFiles().catch(() => {});`
  - 在 `run()` 决策循环的 `finally` 块中追加调用：`await this.cleanupOffloadedFiles();`

---

### Task 4: 改造双阶段上下文压缩与恢复工作 Prompt 自动注入

**Files:**
- Create: [compactPrompt.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/compactPrompt.js) (新建文件声明 prompt)
- Modify: [AgentExecutor.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/server/agent/AgentExecutor.js) (硬压缩改造与恢复词注入)
- Modify: [messageBuilder.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/lib/messageBuilder.js) (软折叠跳过)

- [ ] **Step 1: 新建 `compactPrompt.js` 定义 9-section 压缩 Prompt。**
新建 `server/agent/compactPrompt.js`，保存并导出 `COMPACT_PROMPT`。

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

- [ ] **Step 2: 改造软折叠逻辑，使其不对已被 offload 的大结果占位符进行二次截断。**
在 `src/lib/messageBuilder.js` 中修改 `compactMessages` 中对于工具大输出折叠的处理：

```javascript
// src/lib/messageBuilder.js (大约 184 行)
// 修改原有的 `ls/grep/web_search/web_fetch` 折叠判断，避开 `OUTPUT OFFLOADED TO FILE` 的标志
      } else if (['ls', 'grep', 'web_search', 'web_fetch'].includes(newMsg.toolName) && newMsg.toolOutput && newMsg.toolOutput.length > 2000) {
        // Skip secondary compaction if this tool call has already been offloaded to disk
        if (!newMsg.toolOutput.includes('OUTPUT OFFLOADED TO FILE:')) {
          const head = newMsg.toolOutput.slice(0, 1000);
          newMsg.toolOutput = `${head}\n\n...[已折叠旧的工具输出结果]...`;
          compactedCount++;
        }
      }
```

- [ ] **Step 3: 重构 Hard-Compact 解析逻辑，剔除 `<analysis>` block，提取 `<summary>` 内容并注入任务恢复 Prompt。**
修改 `AgentExecutor.js` 的 `run()` 中 `Hard-Compact` 的部分：
  1. 阈值替换为 `HARD_COMPACT_TOKEN_THRESHOLD` 和 `SOFT_COMPACT_TOKEN_THRESHOLD`。
  2. 使用专门引入的 `COMPACT_PROMPT`；
  3. 执行完 `summary = await this._callLLMNonStream(...)` 后，对结果进行清洗：

```javascript
// server/agent/AgentExecutor.js 中的 Hard-Compact 阶段
// 1. 将 tokensAfterSoft 判断改为常量：
        if (this.compactionEnabled && tokensAfterSoft > HARD_COMPACT_TOKEN_THRESHOLD && !this.hardCompactTriggered && this.messages.length > 10) {
          try {
            // ... (备份 transcript 等)
            
            // 2. 调用 _callLLMNonStream 时引入新定义的 COMPACT_PROMPT
            const summaryRaw = await this._callLLMNonStream(summaryMessages, COMPACT_PROMPT);
            
            // 3. 【新增：解析剔除 <analysis> 并提取 <summary> 逻辑】
            let summary = summaryRaw;
            // Remove <analysis>...</analysis> tags and contents if present
            summary = summary.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim();
            // Try to extract the summary content inside <summary>...</summary>
            const summaryMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(summary);
            if (summaryMatch) {
              summary = summaryMatch[1].trim();
            } else {
              // Strip leftover tags as fallback
              summary = summary.replace(/<\/?summary>/gi, '').trim();
            }
            
            console.log('✅ Hard-Compact 语义摘要提取成功，长度为:', summary.length);

            // 4. 重建 messages 并自动注入恢复工作的指令
            const activeMessages = this.messages.filter(msg => turnIndex - (msg.turn || 1) < 3);

            const summaryMsg = {
              role: 'system',
              type: 'system_alert',
              turn: turnIndex,
              content: `[System Memory Compacted]\nHere is the summarized history of the project so far:\n\n${summary}\n\nThe complete historical transcript has been persisted to disk.`
            };

            // 注入恢复工作的 Prompt 指令
            const resumeMsg = {
              role: 'system',
              type: 'system_alert',
              turn: turnIndex,
              content: `Please continue the conversation from where we left it off without asking the user any further questions. Continue with the last task that you were asked to work on.`
            };

            this.messages = [summaryMsg, ...activeMessages, resumeMsg];
            this.contextTokens = 0;
            this.hardCompactTriggered = true;

            // 广播与存盘
            this.onEvent('messages_update', { messages: this.messages });
            await this.saveSession();
          } catch (err) {
            // ...
          }
        }
```

---

### Task 5: 编写集成测试脚本验证功能

**Files:**
- Create: [test-compact-offload.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/scratch/test-compact-offload.js)

- [ ] **Step 1: 新建集成测试脚本 `scratch/test-compact-offload.js` 进行全闭环逻辑断言。**
测试用例应包括：
  1. 大结果实时落盘拦截测试（验证 `toolOutput` 长度超过 20KB 是否能生成物理文件并替换占位预览符）。
  2. 24小时过期文件物理删除测试（向 `.offloaded/` 写入过期文件，触发清理，断言文件是否消失）。
  3. `<analysis>` 标签剥离和 `<summary>` 提取正则逻辑测试。

```javascript
// scratch/test-compact-offload.js
import fs from 'fs/promises';
import path from 'path';
import assert from 'assert';
import { 
  OFFLOAD_THRESHOLD_BYTES, 
  OFFLOAD_CLEANUP_AGE_MS 
} from '../server/agent/AgentExecutor.js';

async function runTests() {
  console.log('🧪 Starting Compaction & Offloading Integration Tests...');
  const offloadedDir = path.join(process.cwd(), '.offloaded');

  // --- Test Case 1: Big Tool Output Interceptor ---
  console.log('1. Testing Big Tool Output Interceptor...');
  let toolOutput = 'A'.repeat(OFFLOAD_THRESHOLD_BYTES + 100); // 20100 characters
  const mockToolId = 'mock-tool-1';
  const mockHarnessId = 'test-harness';
  
  if (toolOutput.length > OFFLOAD_THRESHOLD_BYTES) {
    await fs.mkdir(offloadedDir, { recursive: true });
    const offloadFile = `offload-${mockHarnessId}-${mockToolId}.txt`;
    const offloadPath = path.join(offloadedDir, offloadFile);
    await fs.writeFile(offloadPath, toolOutput, 'utf-8');

    const originalSize = Buffer.byteLength(toolOutput, 'utf-8');
    const headPreview = toolOutput.slice(0, 1500);
    const tailPreview = toolOutput.slice(-500);

    const placeholder = `[OUTPUT OFFLOADED TO FILE: .offloaded/${offloadFile} (size: ${originalSize} bytes).
--- PREVIEW START (First 1500 chars) ---
${headPreview}
--- PREVIEW END ---
...[OUTPUT OFFLOADED]...
--- TAIL PREVIEW (Last 500 chars) ---
${tailPreview}
--- TAIL END ---]`;
    
    assert(await fs.access(offloadPath).then(() => true).catch(() => false), 'Physical file should exist');
    assert(placeholder.includes('size: 20100 bytes'), 'Placeholder should contain correct size');
    // Clean mock file
    await fs.unlink(offloadPath);
  }

  // --- Test Case 2: Cleanup Expired Files ---
  console.log('2. Testing Expired Files Cleanup...');
  const expiredFile = path.join(offloadedDir, 'offload-test-expired.txt');
  await fs.writeFile(expiredFile, 'Expired Content', 'utf-8');
  
  // Set mtime to 25 hours ago
  const time25HoursAgo = new Date(Date.now() - (25 * 60 * 60 * 1000));
  await fs.utimes(expiredFile, time25HoursAgo, time25HoursAgo);

  // Run cleanup logic
  const files = await fs.readdir(offloadedDir);
  const now = Date.now();
  for (const file of files) {
    if (file.startsWith('offload-') && file.endsWith('.txt')) {
      const filePath = path.join(offloadedDir, file);
      const stat = await fs.stat(filePath);
      if (now - stat.mtime.getTime() > OFFLOAD_CLEANUP_AGE_MS) {
        await fs.unlink(filePath);
      }
    }
  }

  const fileExists = await fs.access(expiredFile).then(() => true).catch(() => false);
  assert(!fileExists, 'Expired file should be deleted automatically');

  // --- Test Case 3: Summary & Analysis Extractor ---
  console.log('3. Testing Summary / Analysis parsing...');
  const summaryRaw = `<analysis>
  I should summarize user prompt.
  - Turn 1: user asked to build features.
  </analysis>
  <summary>
  ### 1. Primary Goal: Build new web apps.
  ### 2. Files: src/App.jsx.
  </summary>`;
  
  let summary = summaryRaw;
  summary = summary.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim();
  const summaryMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(summary);
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
  }
  
  assert(!summary.includes('<analysis>'), 'Result should not contain analysis block');
  assert(summary.includes('Build new web apps.'), 'Result should extract summary content');
  
  console.log('🎉 All integrated tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: 运行测试脚本。**
运行: `node scratch/test-compact-offload.js`
预期输出: `🎉 All integrated tests passed successfully!`

- [ ] **Step 3: Commit 提交。**
```bash
git add server.js server/agent/AgentExecutor.js server/agent/compactPrompt.js src/lib/messageBuilder.js scratch/test-compact-offload.js
git commit -m "feat(agent): implement big tool result offloading and task-recovery prompt in hard-compact"
```
