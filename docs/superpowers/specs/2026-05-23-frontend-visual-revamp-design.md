# 前端视觉重塑与极客美化设计说明书 (曜石暗色风)

本设计规范（Spec）旨在彻底重塑 LLM Space 前端调试沙箱界面的视觉调性与交互细节，拒绝平庸的 AI 套路设计，引入高级的极客调试台质感。

---

## 1. 视觉调性与设计原则

*   **风格定义**：曜石暗光极客风（Luxury/Refined Dark + Obsidian Core）。
*   **主体配色**：以曜石碳蓝（`#050811`）为背景基调，使用极光紫（Aurora Purple）与激光蓝（Cyber Blue）渐变作高光，以青色与翠绿作为状态指示色。
*   **字体规范**：
    *   **主 Sans-Serif 字体**：几何科技感强、饱满现代的 `Plus Jakarta Sans`，替代原有的 Inter 字体。
    *   **主 Monospace 字体**：保留 `JetBrains Mono` 作为代码块、数字仪表等技术性内容的呈现字体。
*   **交互调性**：加入磨砂玻璃态（Glassmorphism）、微发光（Subtle Glow）、流光能量动画（Energy Flow）以及弹性状态机过渡（Spring Physics Feedback）。

---

## 2. 详细设计规范

### 2.1 全局基础与对比度修复 (Section 1)
*   **背景径向渐变**：
    在 `body` 挂载一个微弱的紫色与蓝色暗光径向渐变，产生深邃的空间深度：
    `background: radial-gradient(circle at 50% 50%, #0c0f20 0%, #050811 100%)`。
*   **幽灵按钮 (.btn-ghost / .icon-btn) 增强**：
    *   默认边框由 `#1f2d45` 提升为 `#263654`，文字颜色变更为 `#a5b7d6`，避免陷入背景。
    *   Hover 状态下边框升级为激光蓝 `--blue`，带有外阴影发光。
*   **输入框聚焦高光**：
    *   聚焦状态 `.input:focus, .textarea:focus` 边框变色为 `#3b82f6`，追加发光阴影 `0 0 14px rgba(59, 130, 246, 0.25)`。

### 2.2 Shimmering Token 仪表盘 (Section 2)
*   **进度条物理外观**：高度由 `4px` 增粗至 `10px`，圆角为 `99px`，背景为曜石黑 `#0b0e17`。
*   **三色渐变能量条**：填充色为 `linear-gradient(90deg, #3b82f6 0%, #a855f7 50%, #ec4899 100%)`。
*   **平移流光动画**：设定 `background-size: 200% 100%`，配合 CSS 关键帧：
    ```css
    @keyframes tokenShimmer {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    ```
*   **仪表数值排版**：
    在进度条左侧以 `JetBrains Mono` 常驻显示 `Current / Max Tokens` (如 `3,450 / 8,192`)；在右侧以同字体显示百分比 (如 `42.1%`)。
*   **布局与挂载**：常驻固定在轨迹面板的底部状态页脚中。超过 80% 变为橙黄色，超过 95% 变为朱红色。

### 2.3 Rewind 磨砂霓虹胶囊按钮 (Section 3)
*   **命名与排版**：原“重试此轮”按钮改名为 `⟲ REWIND`，采用大写及大字符间距。
*   **磨砂玻璃药丸样式**：
    *   底色为 `rgba(168, 85, 247, 0.06)`，搭配半透明淡紫细边框 `1px solid rgba(168, 85, 247, 0.25)`，模糊度 `backdrop-filter: blur(8px)`。
    *   胶囊圆角 `border-radius: 99px`。
*   **交互动画**：
    *   气泡悬浮时以 `opacity` 渐变滑入。
    *   按钮 Hover 时边框变亮，触发霓虹紫发光阴影 `0 0 12px rgba(168, 85, 247, 0.45)`。里面的 `⟲` 图标执行 `-180deg` 旋转过渡。

### 2.4 Stateful 保存配置状态机反馈 (Section 4)
*   在配置台（PromptLabPage）引入 `saveStatus` 变量 (`'idle' | 'saving' | 'saved'`) 控制保存反馈：
    1.  **`idle`**：文字为 `Save Config`，常规按钮。
    2.  **`saving`**：按钮 `disabled`，文字变为 `Saving...`，左侧图标替换为小旋转 Loading SVG。
    3.  **`saved`**：文字变为 `Saved ✓`，左侧图标为绿色打勾 `✓`，背景变为翠绿色，触发弹性缩放 CSS 动画 `.animate-bounce-in`：
        ```css
        @keyframes bounce-in {
          0% { transform: scale(0.85); opacity: 0; }
          60% { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(1); }
        }
        ```
    4.  展示 `1.5秒` 后淡出淡入切回 `idle`。

---

## 3. 拟修改文件

*   **样式重构**：
    *   [index.css](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/index.css) (字重导入、新 CSS 变量、全局幽灵按钮与聚焦样式)
    *   [App.css](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/App.css) (流光进度条关键帧、Rewind 按钮样式、保存反馈动画)
*   **组件重构**：
    *   [MessageBubbles.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/components/MessageBubbles.jsx) (重构 Rewind 按钮命名、文字和类名)
    *   [TrajectoryView.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/components/TrajectoryView.jsx) (重构 Token 进度条结构、百分比显示并固定到底部 Footer)
    *   [PromptLabPage.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/pages/PromptLabPage.jsx) (重构保存按钮为三状态受控机，加入过渡动画)

---

## 4. 验证计划

*   **静态编译检查**：在终端运行 `npm run build`，确保重构没有导致 React 语法编译报错。
*   **手动视觉自检**：启动 `npm run dev` 并在浏览器中逐项核对：
    1.  字体是否已切换为 `Plus Jakarta Sans`，数字是否仍为 `JetBrains Mono`。
    2.  Token 进度条是否宽度足够，是否流光正常，数值是否常驻两侧。
    3.  鼠标移入 User 气泡时，`⟲ REWIND` 是否优雅出现，悬浮时是否有柔和紫光与旋转动画。
    4.  点击保存配置，是否顺利经历 `Save Config` -> `Saving...` -> `Saved ✓` 的弹性回弹变化，并能否在 1.5 秒后回弹正常。
