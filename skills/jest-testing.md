# Jest 单元测试编写规范 (Jest Testing)

本指南规范了项目单元测试的设计原则及语法约定。

## 1. 测试文件命名
*   测试文件必须与被测试文件同目录，且采用 `.test.js` 或 `.spec.js` 后缀。
*   例如，被测文件为 `mathUtils.js`，对应的测试文件必须命名为 `mathUtils.test.js`。

## 2. 测试套件结构 (Describe & Test)
使用清晰的层级结构对测试用例进行归类组织，每个 `describe` 块应当专注于一个类或一个函数：
```javascript
describe('mathUtils', () => {
  describe('add', () => {
    test('should add two positive numbers correctly', () => {
      expect(add(2, 3)).toBe(5);
    });

    test('should handle negative numbers', () => {
      expect(add(-1, -1)).toBe(-2);
    });
  });
});
```

## 3. Mock 规范与防御
*   在测试涉及外部网络请求、文件 IO 或系统级高危 API 的函数时，**必须**使用 `jest.mock()` 对其进行防卫性 Mock 拦截。
*   使用 `jest.spyOn()` 监控模块调用，并使用 `mockClear()` 或 `mockReset()` 在 `afterEach` 中还原状态，避免测试用例间的污染。

## 4. 断言最佳实践 (Matchers)
*   判断相等：使用 `toBe()` 进行值对比，使用 `toEqual()` 进行深层对象比对。
*   异常捕获：测试函数抛出异常时，断言必须写为：`expect(() => fn()).toThrow(Error)`。
