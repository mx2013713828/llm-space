# 前端视觉重塑与极客美化实施计划 (曜石暗色风)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底重构 LLM Space 前端视觉界面，提供高对比度、呼吸流光与磨砂霓虹交织的曜石暗色极客调试台界面。

**Architecture:** 
1. 通过全局 `src/index.css` 设定高品质的 `Plus Jakarta Sans` 字体与曜石碳蓝底色系统，重构幽灵按钮及输入聚焦。
2. 在 `src/App.css` 与 `src/components/TrajectoryView.jsx` 中升级 Token 占用进度条为 10px 粗、流光闪烁且数值常驻两侧的底部仪表盘。
3. 磨砂玻璃化 `MessageBubbles.jsx` 中的重发按钮为英文 `⟲ REWIND` 并增加霓虹紫发光悬浮。
4. 增强 `PromptLabPage.jsx` 保存按钮，引入受控状态机，支持 loading 转圈与弹性打勾成功反馈。

**Tech Stack:** React 18, CSS 3 (Vanilla CSS with custom keyframes & backdrop-filter).

---

### Task 1: 全局基础、字体与幽灵按钮明度优化

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: 在全局样式中引入并更新 Plus Jakarta Sans 字体**

修改 `src/index.css`，在顶部 Google Fonts 导入行，将 Inter 替换为 Plus Jakarta Sans，并修改 `--font-sans` 变量：
```css
/* ===== Google Fonts ===== */
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

/* 以及修改 :root 变量 */
:root {
  ...
  --font-sans: 'Plus Jakarta Sans', -apple-system, sans-serif;
  ...
}
```

- [ ] **Step 2: 调暗全局背景，应用径向曜石渐变**

修改 `src/index.css` 的 `body` 样式，增加曜石渐变光晕：
```css
body {
  font-family: var(--font-sans);
  background: radial-gradient(circle at 50% 50%, #0c0f20 0%, #050811 100%);
  color: var(--text-primary);
  min-height: 100vh;
  overflow: hidden;
}
```

- [ ] **Step 3: 优化幽灵按钮和图标按钮默认对比度**

修改 `src/index.css` 中 `.btn-ghost` 及相关悬浮样式：
```css
.btn-ghost {
  background: rgba(255, 255, 255, 0.02);
  color: #a5b7d6;
  border: 1px solid #263654;
}
.btn-ghost:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-color: var(--blue);
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.15);
}
```

- [ ] **Step 4: 增强输入框和文本域聚焦发光**

修改 `src/index.css` 中的 `.input:focus, .textarea:focus` 样式：
```css
.input:focus, .textarea:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 14px rgba(59, 130, 246, 0.25);
}
```

- [ ] **Step 5: 验证并提交**

运行：`git diff src/index.css`
期待：确认字体导入正常，幽灵按钮与聚焦高亮样式生效。
提交：
```bash
git add src/index.css
git commit -m "style: 升级主体字体为 Plus Jakarta Sans 并优化背景对比度"
```

---

### Task 2: Shimmering Token 仪表盘设计与重构

**Files:**
- Modify: `src/App.css`
- Modify: `src/components/TrajectoryView.jsx`

- [ ] **Step 1: 在 App.css 中新增流光进度条和呼吸渐变样式**

在 `src/App.css` 尾部追加进度条增强样式，包括 10px 粗度、霓虹渐变和平移流光关键帧动画：
```css
/* Token 进度条增强 */
.token-dashboard {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(11, 14, 23, 0.6);
  border-top: 1px solid var(--border);
  backdrop-filter: blur(8px);
}

.token-info-text {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}

.token-info-text span {
  font-weight: 600;
}

.token-info-current-normal {
  color: var(--blue);
}

.token-info-current-warning {
  color: var(--amber);
}

.token-info-current-danger {
  color: var(--red);
}

.progress-bar-wide {
  flex: 1;
  height: 10px;
  background: #0b0e17;
  border-radius: 99px;
  border: 1px solid rgba(255, 255, 255, 0.03);
  overflow: hidden;
  position: relative;
}

.progress-fill-glow {
  height: 100%;
  border-radius: 99px;
  transition: width 0.6s var(--ease-smooth);
  background: linear-gradient(90deg, #3b82f6 0%, #a855f7 50%, #ec4899 100%);
  background-size: 200% 100%;
  animation: tokenShimmer 4s linear infinite;
}

.progress-fill-warning {
  background: linear-gradient(90deg, #f59e0b 0%, #d97706 100%);
}

.progress-fill-danger {
  background: linear-gradient(90deg, #ef4444 0%, #dc2626 100%);
}

@keyframes tokenShimmer {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
```

- [ ] **Step 2: 重写 TrajectoryView.jsx 的 Token 进度条结构**

修改 `src/components/TrajectoryView.jsx`。将原来的 `progress-bar` 从消息流顶部/侧边移除，改造成在 TrajectoryView 右下角固定的仪表页脚 `token-dashboard`，使其常驻：
```jsx
// 替代原本在 TrajectoryView 中渲染的细长进度条：
const tokenPercent = Math.min(100, (currentTokens / maxTokens) * 100);
let tokenColorClass = "token-info-current-normal";
let progressFillClass = "progress-fill-glow";

if (tokenPercent >= 95) {
  tokenColorClass = "token-info-current-danger";
  progressFillClass = "progress-fill-danger";
} else if (tokenPercent >= 80) {
  tokenColorClass = "token-info-current-warning";
  progressFillClass = "progress-fill-warning";
}

// 在轨迹视图的最底部插入页脚：
<div className="token-dashboard">
  <div className="token-info-text">
    Tokens: <span className={tokenColorClass}>{currentTokens.toLocaleString()}</span> / {maxTokens.toLocaleString()}
  </div>
  <div className="progress-bar-wide">
    <div 
      className={progressFillClass} 
      style={{ width: `${tokenPercent}%` }}
    />
  </div>
  <div className="token-info-text" style={{ width: '40px', textAlign: 'right' }}>
    {tokenPercent.toFixed(1)}%
  </div>
</div>
```

- [ ] **Step 3: 优化 TrajectoryView 的纵向布局**

在 `TrajectoryView.jsx` 的渲染结构中，需要用 Flex 纵向布局把消息列表与这个底部状态页脚 `token-dashboard` 隔开，以防底部栏遮挡消息内容。
```jsx
return (
  <div className="trajectory-panel" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
    {/* 消息滚动区域 */}
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* 消息循环 */}
    </div>
    {/* 底部 Token 页脚 */}
    <div className="token-dashboard">
      ...
    </div>
  </div>
);
```

- [ ] **Step 4: 确认并提交**

运行：`npm run build` 确认 React JSX 解析正确。
提交：
```bash
git add src/App.css src/components/TrajectoryView.jsx
git commit -m "feat: 升级常驻 10px 流光 Token 占用仪表盘"
```

---

### Task 3: Rewind 磨砂玻璃霓虹胶囊按钮重置

**Files:**
- Modify: `src/App.css`
- Modify: `src/components/MessageBubbles.jsx`

- [ ] **Step 1: 在 App.css 中添加磨砂玻璃胶囊按钮样式**

在 `src/App.css` 中定义 `.btn-rewind` 类，指定磨砂背景、细边框、外阴影发光，并在 Hover 时旋转图标：
```css
/* REWIND 胶囊按钮 */
.msg-user-container {
  position: relative;
}

.btn-rewind {
  position: absolute;
  top: 8px;
  right: 12px;
  opacity: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 99px;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
  background: rgba(168, 85, 247, 0.06);
  border: 1px solid rgba(168, 85, 247, 0.25);
  color: #d8b4fe;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 10;
}

.msg-user-container:hover .btn-rewind {
  opacity: 0.85;
}

.btn-rewind:hover {
  opacity: 1 !important;
  color: #f3e8ff;
  border-color: rgba(168, 85, 247, 0.6);
  box-shadow: 0 0 12px rgba(168, 85, 247, 0.45), inset 0 0 4px rgba(168, 85, 247, 0.2);
}

.btn-rewind svg {
  transition: transform 0.2s ease;
}

.btn-rewind:hover svg {
  transform: rotate(-180deg);
}
```

- [ ] **Step 2: 修改 MessageBubbles.jsx 重写重试按钮**

修改 `src/components/MessageBubbles.jsx` 中的 `UserMessage` 组件。将原来的 `⟲ 重试此轮` 按钮更新为大写的 `⟲ REWIND` 并附带上级包裹容器和 SVG 重置图标：
```jsx
// 替代原先在 UserMessage 中的 `⟲ 重试此轮` 按钮：
export function UserMessage({ message, onRetry }) {
  return (
    <div className="msg-user-container">
      {onRetry && (
        <button 
          className="btn-rewind" 
          onClick={onRetry} 
          title="回滚到本轮对话之前重新开始"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
          REWIND
        </button>
      )}
      <div className="message-bubble msg-user">
        <div className="msg-user-header">
          {/* 保持头部正常渲染 */}
        </div>
        {/* 内容 */}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验证并提交**

运行：`npm run build`
期待：没有 JSX 渲染冲突，包裹类无语法错误。
提交：
```bash
git add src/App.css src/components/MessageBubbles.jsx
git commit -m "feat: 重新设计 User 消息气泡的磨砂玻璃 REWIND 胶囊按钮"
```

---

### Task 4: Stateful 配置保存状态机反馈实现

**Files:**
- Modify: `src/App.css`
- Modify: `src/pages/PromptLabPage.jsx`

- [ ] **Step 1: 在 App.css 中加入弹性放大和旋转动画**

在 `src/App.css` 尾部追加弹性回弹 `@keyframes bounce-in` 以及 Loading 旋转组件：
```css
/* 保存状态机过渡 */
.btn-save-saving {
  background: var(--bg-elevated) !important;
  color: var(--text-secondary) !important;
  border: 1px solid var(--border) !important;
  cursor: not-allowed !important;
}

.btn-save-saved {
  background: linear-gradient(135deg, #10b981, #059669) !important;
  color: #ffffff !important;
  box-shadow: 0 0 16px rgba(16, 185, 129, 0.4) !important;
  animation: bounce-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;
}

.animate-spin-fast {
  animation: spin 0.8s linear infinite;
}

@keyframes bounce-in {
  0% { transform: scale(0.85); opacity: 0; }
  60% { transform: scale(1.05); opacity: 1; }
  100% { transform: scale(1); }
}
```

- [ ] **Step 2: 在 PromptLabPage.jsx 中声明并挂载保存状态机**

修改 `src/pages/PromptLabPage.jsx`：
1. 导入 `useState` 并声明 `saveStatus` 状态。
2. 重写 `handleSave` 逻辑，在保存过程中过渡状态。
```jsx
// 声明状态：
const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'

// 修改保存事件处理器 handleSave：
const handleSave = async () => {
  setSaveStatus('saving');
  try {
    // 触发原本的保存接口逻辑，如 await onSave(...) 或 fetch(...)
    await onSaveConfig(config);
    // 保存成功，设为 saved 并触发 1.5s 后回弹：
    setSaveStatus('saved');
    setTimeout(() => {
      setSaveStatus('idle');
    }, 1500);
  } catch (err) {
    console.error(err);
    setSaveStatus('idle'); // 发生异常回退
  }
};
```

- [ ] **Step 3: 渲染有状态的保存按钮内容与样式**

在 `PromptLabPage.jsx` 中，对“保存配置”按钮的渲染部分进行受控改造：
```jsx
let btnClass = "btn btn-primary";
let btnText = "Save Config";
let btnIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
    <polyline points="17 21 17 13 7 13 7 21"/>
    <polyline points="7 3 7 8 15 8"/>
  </svg>
);

if (saveStatus === 'saving') {
  btnClass = "btn btn-save-saving";
  btnText = "Saving...";
  btnIcon = (
    <svg className="animate-spin-fast" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="12" y1="2" x2="12" y2="6"/>
      <line x1="12" y1="18" x2="12" y2="22"/>
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
      <line x1="2" y1="12" x2="6" y2="12"/>
      <line x1="18" y1="12" x2="22" y2="12"/>
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
    </svg>
  );
} else if (saveStatus === 'saved') {
  btnClass = "btn btn-save-saved";
  btnText = "Saved ✓";
  btnIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

// 按钮渲染：
<button 
  className={btnClass} 
  onClick={handleSave}
  disabled={saveStatus !== 'idle'}
>
  {btnIcon}
  <span>{btnText}</span>
</button>
```

- [ ] **Step 4: 确认并提交**

运行：`npm run build`
期待：保存按钮三状态逻辑无语法阻碍。
提交：
```bash
git add src/App.css src/pages/PromptLabPage.jsx
git commit -m "feat: 实现 Prompt 实验室保存配置的 Saving & Saved 状态机反馈"
```

---

### Task 5: 生产构建校验与视觉全自检

**Files:**
- None (Verification only)

- [ ] **Step 1: 执行 npm run build 进行整体静态类型和语法编译验证**

运行：`npm run build`
期待：生成 `dist` 静态资源目录，且编译终端无任何 Error 或 Warning。

- [ ] **Step 2: 运行开发服务进行视觉核验**

运行：`npm run dev`
期待：确认本地服务 3000/5173/5174 端口可用，前端网页字体变为 `Plus Jakarta Sans`，且 Token 进度条流光正常，Rewind 悬浮交互与保存反馈效果完整。
