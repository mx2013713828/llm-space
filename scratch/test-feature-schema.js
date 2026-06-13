import { FEATURE_SCHEMA as FeatureSchema, parseFeatures } from '../src/lib/FeatureSchema.js';

// 1. 结构自检
const taskManager = FeatureSchema.task_manager;
console.assert(taskManager !== undefined, 'task_manager 特性不存在');
console.assert(taskManager.children.todo_prompt !== undefined, 'todo_prompt 属性未定义');
console.assert(taskManager.children.task_system_prompt !== undefined, 'task_system_prompt 属性未定义');
console.assert(taskManager.children.todo_prompt.type === 'text_area', 'todo_prompt 类型应为 text_area');

// 2. 解析逻辑自检
// 验证当父级设为 true 时，非布尔子项是否正确保留其默认值/类型，而不是被污染为布尔值
const parsedTrue = parseFeatures({ task_manager: true });
console.assert(parsedTrue.task_manager.enabled === true, 'task_manager 应启用');
console.assert(parsedTrue.task_manager.mode === 'todo', `mode 应回退为默认字符串 'todo'，实际为: ${parsedTrue.task_manager.mode}`);
console.assert(typeof parsedTrue.task_manager.todo_prompt === 'string', 'todo_prompt 应为字符串');

// 验证自定义配置解析
const parsedCustom = parseFeatures({
  task_manager: {
    enabled: true,
    mode: 'task_system',
    todo_prompt: 'custom_prompt'
  }
});
console.assert(parsedCustom.task_manager.mode === 'task_system', '自定义 mode 解析失败');
console.assert(parsedCustom.task_manager.todo_prompt === 'custom_prompt', '自定义 todo_prompt 解析失败');

console.log('✅ FeatureSchema task_manager 字段及解析自检全部通过');
