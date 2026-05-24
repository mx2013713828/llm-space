---
name: Jest 单元测试编写规范 (Jest Testing)
description: 本指南规范了项目单元测试的设计原则及语法约定。
---

# Jest 单元测试编写规范 (Jest Testing)

本指南规范了项目单元测试的设计原则及语法约定。

## 1. 测试文件命名
测试文件应当与源文件同名，并采用 `.test.js` 后缀，存放于 `tests/` 目录中。
例如：`src/lib/messageBuilder.js` 对应测试文件 `tests/messageBuilder.test.js`。

## 2. 测试套件设计
使用 `describe` 对同一模块的不同场景进行分组：
```javascript
describe('messageBuilder', () => {
  describe('alignRequestPayload', () => {
    it('should align payload correctly', () => { ... });
  });
});
```

## 3. Mock 模拟规范
使用 `jest.mock()` 模拟外部网络或大型模块的依赖，保持单元测试的纯粹性。
