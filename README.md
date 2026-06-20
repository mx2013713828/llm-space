[English](./README.md) | [简体中文](./README.zh-CN.md)

---

# LLM Space - A LEGO-style Visual Experiment Platform for AI Agents 🚀

[![Node Version](https://img.shields.io/badge/node-%3E%3D%2018.0.0-flat.svg?style=flat-square&color=339966)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-flat.svg?style=flat-square&color=blue)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-flat.svg?style=flat-square&color=orange)](https://github.com/shareAI-lab/learn-claude-code/pulls)

> **"A zero-abstraction white-box debugger, enabling you to build and test your AI agents like playing with LEGO bricks."**

**LLM Space** is a zero-framework-abstraction, visual AI Agent LEGO experiment platform and workbench (IDE) custom-designed for developers.

Many heavy Agent frameworks (such as LangChain) introduce massive black-box encapsulation and complex conceptual abstractions for the sake of generality. This introduces a steep learning curve for beginners and high barriers for developers' local debugging. **LLM Space adheres to "what you see is what you get" and "extreme lightweightness"**, completely exposing the Agent's decision-making, reasoning, and tool invocation trajectories, while supporting one-click toggling of advanced features.

---

## 🆕 Recent Updates

* **2026-06-20: In-process Cron Scheduler MVP**
  - **Agent-managed schedules**: Agents can create, inspect, and cancel Harness-scoped jobs with `schedule_cron`, `list_crons`, and `cancel_cron`.
  - **Durable execution pipeline**: Five-field cron expressions feed an in-process event queue, resolve the latest model configuration at run time, and execute through the existing `AgentExecutor`.
  - **Visible scheduled runs**: Scheduled prompts, tool calls, final answers, success/failure counts, and current job state appear in the trajectory and Scheduled Tasks panel.
  - **Safer background behavior**: A busy Harness queues work instead of running concurrent agent loops, while session polling and SSE attachment surface background results in the active UI.

* **2026-06-13: Recoverable Directed Acyclic Graph Task System (DAG Task System) 🕸️**
  - **Backend Task Dependency Stream**: Supports a complex task system based on DAG. Features built-in Kahn's algorithm cycle detection, Claim exclusive file locks for concurrency protection, and automatic rollback of physical board leases when the Agent crashes or exits unexpectedly.
  - **Cache-Friendly & Deduplicated Assembly**: Refactored the plugin lifecycle (`preLLM`). Splits and injects static/dynamic states to maximize LLM KV Cache (Prompt Cache) hit rate, while introducing XML tag deduplication filtering during injection.
  - **Customizable Prompts UI (Prompt Lab)**: Added folding accordion cards in experimental features, allowing advanced users to customize XML prompts. Supports vertical text stretching, long-content scrolling, safe buffering for local changes, and one-click reset to default prompts.

---

## 🎬 Global Interaction Demo

![LLM Space Demo](images/llm-space.gif)

---

## 💡 Core Design Philosophy

### 🧱 Modular Sandbox (LEGO-style plug-and-play config)
We deconstruct the complex lifecycle of Agents into clear "building blocks", all supporting one-click enable/disable via the UI:
- **LEGO Base (Harness Host)**: Uses minimalist `.json` configuration files to define the Agent's system prompt presets and initial state. Switch harnesses in seconds via the left panel.
- **Pluggable Feature Slots (Modular Features)**:
  - **API Self-Healing & Disaster Recovery (Error Recovery)**: Features automatic non-blocking exponential backoff retry on 429, automatic failover to fallback models on continuous 529, physical stitching and lossless continuation on `max_tokens` truncation, and infinite loop circuit breakers.
  - **LLM Semantic Compaction (Hard-Compact)**: Triggers emergency history memory compression and transcript archiving when context window is close to full.
  - **Real-time KV Cache Monitor**: Real-time tracking of KV cache utilization for models like DeepSeek.

### 👁️ White-Box Observability (Visual tracking)
Say no to black-box execution! Keep every detail in plain sight:
- **Thinking Chain Rendering**: Native support for Anthropic Extended Thinking. Streams and folds `<thinking>` reasoning trajectories.
- **Tool Call Trajectory**: Intuitively visualizes the entire interaction process, including `tool_use` initiation, input parameters, and actual local tool execution output (streaming shell outputs, web scraping, etc.).
- **Physical Message Merging**: Seamlessly aligns typed stream continuations with history bubbles, preventing logical disruptions or fragmented bubbles.

---

## 🛠️ Quick Start (Get Started in 3 Mins)

### 1. Installation & Execution
Make sure **Node.js** (v18+ recommended) is installed on your computer, then execute:
```bash
# 1. Install dependencies
npm install

# 2. Start (runs both the frontend UI and backend services)
npm run dev
```
Once started, your browser will automatically open the frontend workbench: `http://localhost:5174`.

### 2. Environment Variables (.env)
Create a `.env` file in the root directory (or refer to `.env.example`):
```dotenv
# Tavily Search API — Used by the web search tool (https://tavily.com - 1000 free calls/month)
TAVILY_API_KEY=tvly-your-key-here

# Service port (optional, default: 3001)
PORT=3001
```
*(Tip: LLM API Keys can be dynamically added directly in the left panel of the frontend UI, and the system will automatically persist them.)*

---

## Scheduled Tasks (Cron Scheduler MVP)

Enable **Cron Scheduler** in the Harness experimental features, then ask the agent to create a task in natural language, for example:

```text
Every 10 minutes, check the weather in Linyi and report it.
```

When enabled, the agent receives three tools:

- `schedule_cron`: create a recurring or one-shot job with a five-field cron expression.
- `list_crons`: inspect jobs and their queued/running/succeeded/failed state.
- `cancel_cron`: cancel a job owned by the current Harness.

Durable definitions are stored in `server/scheduler/tasks.json`. Jobs store a model reference rather than an API key, so each run resolves the latest matching model configuration from `.env`. If the Harness is already running, the scheduled event stays queued until it becomes idle.

MVP boundaries:

- Cron syntax supports `*`, `*/N`, exact values, ranges, and comma-separated values.
- Jobs use the server's local timezone.
- Missed runs while the server is stopped are not backfilled.
- Execution mode is currently `main`; isolated sessions, retries, and detailed run history are planned for later phases.

---

## 🔬 5 Basic Harness Preset Experiments

We have pre-configured 5 classic presets ranging from simple to advanced for you, which can be switched in seconds in the left panel to quickly start experimenting:

### 📁 01-chat-bot.json (Basic Chatbot)
* **Positioning**: Understand the most basic ReAct tool-call loop.
* **Highlights**: Equipped with simple tools like city weather queries. Ideal for observing the closed-loop of the LLM analyzing cities, triggering `tool_call`, retrieving data, and summarizing in natural language.
  <details>
  <summary>🔍 Click to expand running demo GIF</summary>

  ![01-chat-bot Demo](docs/images/01-chat-bot-demo.gif)

  </details>

### 📁 02-bash.json (System Interaction)
* **Positioning**: Empower the Agent with filesystem operations and network diagnostics.
* **Highlights**: Equipped with a real Bash executor (with streaming output echo), file read/write, and Tavily real-time web search and extraction. You can type commands like "Find the three largest files in the current directory" to observe the execution path.
  <details>
  <summary>🔍 Click to expand running demo GIF</summary>

  ![02-bash Demo](docs/images/02-bash-demo.gif)

  </details>

### 📁 03-deep-research.json (Deep Research)
* **Positioning**: Learn how the Agent automatically plans and breaks down complex tasks.
* **Highlights**: Combines behaviors defined in `systemPrompt` with local `write_todos`. When facing complex research tasks, the LLM will automatically decompose them into 4-8 TODO steps on the right side and tackle them one by one.
  <details>
  <summary>🔍 Click to expand running demo GIF</summary>

  ![03-deep-research Demo](docs/images/03-deep-research-demo.gif)

  </details>

### 📁 04-subagent.json (Multi-Agent Collaboration)
* **Positioning**: Explore multi-agent division of labor and context isolation.
* **Highlights**: Equipped with the `sub_agent` core tool. When encountering heavy diagnostics or massive context collection tasks, the main Agent will proactively assign tasks and spin up isolated Sub-agents, then receive and integrate their reports, preventing main context overflow.
  <details>
  <summary>🔍 Click to expand running demo GIF</summary>

  ![04-subagent Demo](docs/images/04-subagent-demo.gif)

  </details>

### 📁 05-task-system.json (DAG Task System)
* **Positioning**: Understand complex, long-cycle task decomposition and concurrency safety based on DAG (Directed Acyclic Graph).
* **Highlights**: Equipped with task dependency system tools (`create_task`, `list_tasks`, `claim_task`, `complete_task`). Features built-in Kahn's algorithm for cycle checking, Claim exclusive file locks, and crash self-healing. When facing complex multi-step tasks, the Agent can automatically decompose dependencies, claim tasks, and conquer them one by one like a human engineer.
  <details>
  <summary>🔍 Click to expand running demo GIF</summary>

  ![05-task-system Demo](docs/images/05-task-system-demo.gif)

  </details>

---

## ⚙️ LEGO Sandbox Closed-loop Interaction (How to Customize & Export)

Any experimental adjustments you make in LLM Space can be seamlessly persisted:

1. **Seconds-Level Hot Swap**: Select any basic Harness from the left list, modify the Base System Prompt in the **Prompt Lab**, check the Tools you want to try (e.g., `bash`, `sub_agent`), or toggle the `Error Recovery` self-healing switch in the experimental features section.
2. **White-Box Tracking**: Send a query and observe whether the execution path expanded in the trace panel meets expectations.
3. **One-Click Save**: Once satisfied, click the **"Save"** button at the bottom of the page. The system will immediately generate and export your custom Harness JSON configuration file in the local `harnesses/` directory for future use or sharing.

---

## 🔧 Developer Guide: Develop your first Tool in 30 seconds

If you want to give the Agent new capabilities (e.g., executing database queries or calling custom APIs), it only takes two steps:

### Step 1: Create a JS file under the `server/tools/` directory (e.g., `hello_tool.js`)
```javascript
// server/tools/hello_tool.js
export default {
  name: 'hello_tool',
  description: 'Greet a specific user with a custom message.',
  parameters: {
    type: 'object',
    properties: {
      userName: { type: 'string', description: 'The username to greet' },
      customMsg: { type: 'string', description: 'Additional custom blessing message' }
    },
    required: ['userName']
  },
  async execute({ userName, customMsg = 'Have a great day!' }) {
    // Write your actual business logic here
    return `Hello, ${userName}! ${customMsg}`;
  }
};
```

### Step 2: Import and register it in `server/tools/index.js`
```javascript
// server/tools/index.js
import hello_tool from './hello_tool.js';

export const tools = [
  // ... other tools
  hello_tool
];
```
**Done!** Refresh the frontend page, go to the **🔧 Tools** tab in the Prompt Lab, check the box, and it's ready to use.

---

## 🤝 Contributing
Everyone is welcome to help improve this Agent LEGO sandbox! You can participate by:
- Submitting your custom, creative `Tools` (e.g., integrations with Jira, Notion, etc.);
- Submitting new `Feature` plugins for experimental traits;
- Improving user experience and micro-animations of the trace visualization UI.

If you find this project helpful, please give it a **⭐ Star**. It is the greatest encouragement for open-source authors!
