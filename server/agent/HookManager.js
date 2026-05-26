export class HookManager {
  constructor() {
    this.hooks = {
      onLoopStart: [],
      preLLM: [],
      preToolUse: [],
      postToolUse: [],
      onLoopEnd: []
    };
  }

  /**
   * 注册一个插件。插件是一个包含生命周期方法的对象。
   * @param {Object} plugin 
   */
  register(plugin) {
    for (const hookName of Object.keys(this.hooks)) {
      if (typeof plugin[hookName] === 'function') {
        this.hooks[hookName].push(plugin[hookName].bind(plugin));
      }
    }
  }

  /**
   * 按顺序分发生命周期事件
   * @param {string} hookName 生命周期名称
   * @param {Object} context 上下文状态
   */
  async dispatch(hookName, context) {
    if (!this.hooks[hookName]) return;
    for (const hookFn of this.hooks[hookName]) {
      await hookFn(context);
    }
  }
}
