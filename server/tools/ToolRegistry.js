import bash from './bash.js';
import readFile from './read_file.js';
import writeFile from './write_file.js';
import weatherReport from './weather_report.js';
import writeTodos from './write_todos.js';
import webSearch from './web_search.js';
import webFetch from './web_fetch.js';
import subAgent from './sub_agent.js';

/**
 * ToolRegistry — 后端工具注册与管理器
 * 解耦并统一管理系统挂载的所有工具模块
 */
class ToolRegistry {
  constructor() {
    this.tools = {
      bash,
      read_file: readFile,
      write_file: writeFile,
      weather_report: weatherReport,
      write_todos: writeTodos,
      web_search: webSearch,
      web_fetch: webFetch,
      sub_agent: subAgent,
    };
  }

  /**
   * 获取指定工具的 Schema 清单 (符合 Anthropic API Tools 规范)
   * @param {Array<string>} enabledToolNames 启用的工具名列表，若为空则返回全部
   * @returns {Array<Object>}
   */
  getSchemas(enabledToolNames = []) {
    const targetTools = enabledToolNames.length > 0
      ? enabledToolNames.map(name => this.tools[name]).filter(Boolean)
      : Object.values(this.tools);

    return targetTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(tool.parameters || {}).map(([k, v]) => [
            k, 
            { type: v.type || 'string', description: v.description || '' }
          ])
        ),
        required: Object.entries(tool.parameters || {}).filter(([, v]) => v.required).map(([k]) => k),
      }
    }));
  }

  /**
   * 获取特定工具的定义
   * @param {string} name 工具名称
   * @returns {Object|null}
   */
  getTool(name) {
    return this.tools[name] || null;
  }

  /**
   * 执行指定工具
   * @param {string} toolName 工具名
   * @param {Object} toolInput 输入参数
   * @param {Function} onData 可选的流式输出回调
   * @returns {Promise<any>}
   */
  async execute(toolName, toolInput, onData) {
    const tool = this.getTool(toolName);
    if (!tool) {
      throw new Error(`未知工具: ${toolName}`);
    }
    return await tool.execute(toolInput || {}, onData);
  }
}

export const toolRegistry = new ToolRegistry();
export default toolRegistry;
