import bash from './bash.js';
import readFile from './read_file.js';
import writeFile from './write_file.js';
import weatherReport from './weather_report.js';
import writeTodos from './write_todos.js';
import webSearch from './web_search.js';
import webFetch from './web_fetch.js';
import subAgent from './sub_agent.js';
import createTask from './create_task.js';
import listTasks from './list_tasks.js';
import getTask from './get_task.js';
import claimTask from './claim_task.js';
import completeTask from './complete_task.js';
import queryBackgroundTasks from './query_background_tasks.js';
import scheduleCron from './schedule_cron.js';
import listCrons from './list_crons.js';
import cancelCron from './cancel_cron.js';
import getCurrentTime from './get_current_time.js';
import spawnTeammate from './spawn_teammate.js';
import sendTeamMessage from './send_team_message.js';
import checkTeamInbox from './check_team_inbox.js';
import waitForTeammates from './wait_for_teammates.js';
import listMountedKnowledgeBases from './list_mounted_knowledge_bases.js';
import queryKnowledgeBase from './query_knowledge_base.js';
import { validateToolInput } from './toolValidation.js';

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
      create_task: createTask,
      list_tasks: listTasks,
      get_task: getTask,
      claim_task: claimTask,
      complete_task: completeTask,
      query_background_tasks: queryBackgroundTasks,
      schedule_cron: scheduleCron,
      list_crons: listCrons,
      cancel_cron: cancelCron,
      get_current_time: getCurrentTime,
      spawn_teammate: spawnTeammate,
      send_team_message: sendTeamMessage,
      check_team_inbox: checkTeamInbox,
      wait_for_teammates: waitForTeammates,
      list_mounted_knowledge_bases: listMountedKnowledgeBases,
      query_knowledge_base: queryKnowledgeBase,
    };
  }

  /**
   * 获取指定工具的 Schema 清单 (符合 Anthropic API Tools 规范)
   * @param {Array<string>} enabledToolNames 启用的工具名列表，若为空则返回全部
   * @returns {Array<Object>}
   */
  getSchemas(enabledToolNames) {
    const targetTools = Array.isArray(enabledToolNames)
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

  validate(toolName, toolInput) {
    return validateToolInput(this.getTool(toolName), toolInput);
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
