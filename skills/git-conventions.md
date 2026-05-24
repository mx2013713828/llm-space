# Git 提交与分支约定 (Git Conventions)

本指南规范了项目中的分支命名及 Commit 提交消息格式，Agent 在执行 Git 提交时必须严格遵守。

## 1. 分支命名规则
*   **新功能开发**：`feature/issue-编号-简短描述` (例如: `feature/issue-102-user-login`)
*   **修复 Bug**：`bugfix/issue-编号-简短描述` (例如: `bugfix/issue-45-fix-cors-error`)
*   **辅助任务/杂务**：`chore/简短描述` (例如: `chore/update-eslint-config`)

## 2. Commit 提交格式 (Conventional Commits)
每次提交的 Commit Message 必须采用业界通用的规范格式：
```text
<type>(<scope>): <subject>
```

### 常用类型 (Types)
*   `feat`：新增功能 (Feature)
*   `fix`：修复 Bug (Bug Fix)
*   `docs`：文档修改 (Documentation)
*   `style`：代码格式调整 (如空格、缩进，不影响运行逻辑)
*   `refactor`：代码重构 (既非 Feature 也非 Bug 修复)
*   `test`：增加或修改测试用例 (Testing)
*   `chore`：构建流程、辅助工具依赖升级变动 (Chore)

### 范围说明 (Scope)
指明受影响的代码范围或模块（例如: `server`、`ui`、`tools`、`auth`）。必须使用小写英文。

### 标题要求 (Subject)
简短阐述本次提交的核心改动，句首不使用大写字母，句尾不加句号。

## 3. 示例展示
*   `feat(auth): add JWT token expiration check`
*   `fix(server): resolve null reference error on file read`
*   `docs(readme): update build and run instructions`
*   `refactor(ui): extract TrajectoryCard component`
