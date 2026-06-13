# 任务系统提示词一键注入与客制化设计方案 (XML 规范)

本设计文档旨在为 **LLM Space** 开发任务系统提示词的运行时自动装配、XML 隔离与高级自定义（支持一键 Reset 和显式保存）能力。

---

## 1. 架构目标与设计原则

为了摆脱各个 Harness 预设 JSON 文件中对任务系统引导 Prompt 的重复编写，并允许高级开发者微调操作规范，本设计遵循以下原则：

1. **运行时实时装配**：大段的工具行为指南 Prompt 不写入物理预设文件的 `systemPrompt` 中，而是保存在 `features` 配置项下。在运行时由生命周期插件（Plugins）在 `preLLM` 阶段实时拼装进 `context.systemPrompt`，保护前缀缓存（Prompt Cache）的静态命中。
2. **XML 包装与唯一性（Idempotence）**：使用结构清晰的 XML 标签（如 `<task_system_guidelines>`）包装规范。系统通过标签进行去重检测，保障发给大模型的提示词中有且仅有一份规范，防范重复注入。
3. **极简 UX 与本地 Buffer 控制**：非必要不显示。只有展开高级面板时才展示 Prompt 框；采用本地状态缓冲区（Buffer），必须点击“保存”按钮才写盘，Reset 按钮只清空本地缓存而不立即写盘。

---

## 2. 详细技术实现方案

### 2.1 数据模型扩展 (`FeatureSchema.js`)

在 `src/lib/FeatureSchema.js` 的 `task_manager` 组的 `children` 中新增两个子特性：

* **`todo_prompt`**：
  * 类型：`text_area`
  * 默认值：
    ```xml
    <todo_mode_guidelines>
    You must use the `write_todos` tool to manage your development board to keep your progress synchronized with the user:
    1. Upon receiving a complex request, immediately call `write_todos` to break down the task into 4-8 pending sub-tasks.
    2. Each time you complete a sub-task, call `write_todos` to mark its status as "completed".
    3. Ensure your task board status aligns with your actual implementation progress. Never write code for multiple turns without updating the task board.
    </todo_mode_guidelines>
    ```
* **`task_system_prompt`**：
  * 类型：`text_area`
  * 默认值：
    ```xml
    <task_system_guidelines>
    When facing complex development tasks, you must use the task dependency system to organize your workflow:
    1. First, analyze the requirements and create a dependency tree of Tasks using `create_task`. Declare upstream dependencies using `blockedBy` (comma-separated IDs).
    2. Call `list_tasks` to inspect the status of all current tasks.
    3. Before writing any code, call `claim_task` to claim a pending task that is not blocked by any uncompleted upstream dependencies.
    4. Once claimed successfully, use `bash`, `read_file`, and `write_file` to implement, debug, and verify the task.
    5. Upon completion, call `complete_task` to mark it as "completed", which will automatically unlock downstream dependent tasks.
    6. Do not write code for multiple consecutive turns without updating the task board status.
    </task_system_guidelines>
    ```

同时，扩展 `FeatureSchema` 对 `type === 'text_area'` 的元数据识别。

---

### 2.2 前端配置面板改造 (`PromptLabPage.jsx`)

1. **`text_area` 渲染器实现**：
   在二级特性渲染循环中，增加对 `subMeta.type === 'text_area'` 的分支支持。
2. **手风琴折叠面板与条件展示**：
   * 根据当前 `task_manager.mode` 的选择，只展示个人关联模式的配置区域。
   * 配置区域默认折叠为一行灰色文字：“⚙️ 自定义任务流提示词 (XML)...”。点击后展开。
3. **编辑缓冲与显式保存交互**：
   * 引入局部 React State：`const [localPrompt, setLocalPrompt] = useState(initialValue)`。
   * 用户修改文本框时，仅更新 `localPrompt`，页面不闪烁，后台不写盘。
   * 渲染两个按钮：
     * **「💾 保存 Prompt」**：点击时，调用 `handleSubFeatureChange(key, subKey, localPrompt)` 触发落盘并保存，按钮短暂变为 “✅ 已保存”。
     * **「🔄 恢复默认」**：点击时，仅执行 `setLocalPrompt(subMeta.defaultValue)`。用户必须在此之后再次点击「💾 保存」才会落盘生效。

---

### 2.3 后端插件实时编译 (`Plugins`)

1. **`TodoNagPlugin.js`**：
   在 `preLLM` 阶段装配提示词：
   * 从 `executor.features.task_manager.todo_prompt` 读取配置。若为空，回退使用 Schema 默认值。
   * 检查 `context.systemPrompt`，如果已包含 `<todo_mode_guidelines>` 标签，跳过追加；否则追加到 `context.systemPrompt` 末尾。
2. **`TaskSystemPlugin.js`**：
   in `preLLM` 阶段装配提示词：
   * 从 `executor.features.task_manager.task_system_prompt` 读取配置。若为空，回退使用 Schema 默认值。
   * 检查 `context.systemPrompt`，如果已包含 `<task_system_guidelines>` 标签，跳过追加；否则追加到 `context.systemPrompt` 末尾。

---

## 3. 验证与测试方案

### 3.1 单元自检
* 确认修改后项目无 ESLint 语法错误。
* 点击「恢复默认」后，确认输入框文本立即变回，但本地配置文件（JSON）内容在保存前未改变。
* 点击「保存」后，确认在对应的 Harness JSON 配置文件中，`todo_prompt` 或 `task_system_prompt` 字段被成功写入。

### 3.2 运行效果验证
* 启动 Agent Executor，发送复杂指令，从大模型的 API payload（使用 Context Inspector 工具）中确认注入的 XML 规则格式正确，且有且仅有一份，无重复注入。
