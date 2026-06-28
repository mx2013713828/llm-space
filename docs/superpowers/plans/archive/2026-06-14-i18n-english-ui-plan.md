# Pure English Frontend & Dual README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all user-facing hardcoded Chinese UI elements, labels, settings, and FeatureSchema descriptions with native English terminology, and restructure the README into separate English (default) and Simplified Chinese editions.

**Architecture:** Systematic file-by-file text replacement. Convert `FeatureSchema.js` settings metadata to English. Update UI pages and components to display native English words. Reorganize README files to default to English `README.md` and keep a Chinese version at `README.zh-CN.md` with reciprocal banner links.

**Tech Stack:** React 18, JSON harnesses configurations, markdown documentation.

---

### Task 1: English Translation of FeatureSchema and Harness Presets

**Files:**
- Modify: `src/lib/FeatureSchema.js`
- Modify: `harnesses/01-chat-bot.json`
- Modify: `harnesses/02-bash.json`
- Modify: `harnesses/03-deep-research.json`
- Modify: `harnesses/04-subagent.json`
- Modify: `harnesses/05-task-system.json`

- [ ] **Step 1: Replace all titles, labels, descriptions, and defaults in FeatureSchema.js with native English terminology**
  Open [FeatureSchema.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/lib/FeatureSchema.js) and replace all Chinese strings with native English terms (including `failSafeValue`, `label`, `description`, and select options).

- [ ] **Step 2: Translate titles and descriptions in harness JSON presets**
  Open files under `harnesses/` and replace their `"name"` and `"description"` attributes with English.

- [ ] **Step 3: Verify build success**
  Run: `npm run build`
  Expected: PASS

- [ ] **Step 4: Commit schema and harness configurations**
  ```bash
  git add src/lib/FeatureSchema.js harnesses/
  git commit -m "chore: translate feature schema and harness presets to English"
  ```

---

### Task 2: Translate Front-end JSX UI Components and Pages

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/pages/TrajectoryPage.jsx`
- Modify: `src/pages/PromptLabPage.jsx`
- Modify: `src/components/ConfigPanel.jsx`
- Modify: `src/components/ContextInspector.jsx`
- Modify: `src/components/MessageBubbles.jsx`
- Modify: `src/components/TodoList.jsx`
- Modify: `src/components/TrajectoryView.jsx`
- Modify: `src/hooks/useModels.js`

- [ ] **Step 1: Replace App.jsx Chinese texts with native English terminology**
  Open [App.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/App.jsx) and replace sidebars, tab titles, key-manager titles, placeholder alerts, and button names.

- [ ] **Step 2: Replace PromptLabPage.jsx and TrajectoryPage.jsx texts with native English**
  Open [PromptLabPage.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/pages/PromptLabPage.jsx) and [TrajectoryPage.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/pages/TrajectoryPage.jsx) to replace all tabs, input labels, status alerts, warnings, and button texts with English.

- [ ] **Step 3: Replace config, trajectory, list, and inspection components texts with native English**
  Replace all user-facing Chinese strings in:
  - [ConfigPanel.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/components/ConfigPanel.jsx)
  - [ContextInspector.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/components/ContextInspector.jsx)
  - [MessageBubbles.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/components/MessageBubbles.jsx)
  - [TodoList.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/components/TodoList.jsx)
  - [TrajectoryView.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/components/TrajectoryView.jsx)
  - [useModels.js](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/hooks/useModels.js) (the alert string)

- [ ] **Step 4: Verify build and lint checks**
  Run: `npm run build && npm run lint`
  Ensure no new lint warnings/errors in the modified components.

- [ ] **Step 5: Commit UI translations**
  ```bash
  git add src/
  git commit -m "feat: translate all JSX components and pages to English"
  ```

---

### Task 3: Restructure README and Establish Dual-Language Documentation

**Files:**
- Create: `README.zh-CN.md`
- Modify: `README.md`

- [ ] **Step 1: Create README.zh-CN.md by copying the original Chinese readme**
  Duplicate current Chinese `README.md` to `README.zh-CN.md` and add a top banner linking back to the English version.

- [ ] **Step 2: Translate README.md to English**
  Translate all sections of `README.md` to English using native English documentation terminology. Add a top banner linking to the Simplified Chinese version.

- [ ] **Step 3: Commit README files**
  ```bash
  git add README.md README.zh-CN.md
  git commit -m "docs: separate README into English README.md and Chinese README.zh-CN.md"
  ```
