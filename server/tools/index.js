import bash from './bash.js';
import readFile from './read_file.js';
import writeFile from './write_file.js';
import weatherReport from './weather_report.js';
import writeTodos from './write_todos.js';
import webSearch from './web_search.js';
import webFetch from './web_fetch.js';
import subAgent from './sub_agent.js';

const tools = {
  bash,
  read_file: readFile,
  write_file: writeFile,
  weather_report: weatherReport,
  write_todos: writeTodos,
  web_search: webSearch,
  web_fetch: webFetch,
  sub_agent: subAgent,
};

// 获取可用工具清单，用于传给大模型 (兼容 Anthropic 规范)
export function getToolSchemas() {
  return Object.values(tools).map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(tool.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }])
      ),
      required: Object.entries(tool.parameters).filter(([, v]) => v.required).map(([k]) => k),
    }
  }));
}

// 单工具执行
export async function executeTool(toolName, toolInput, onData) {
  const tool = tools[toolName];
  if (!tool) {
    throw new Error(`未知工具: ${toolName}`);
  }
  return await tool.execute(toolInput, onData);
}

// 并行执行多个工具（接受 [{toolName, toolInput, id}] 数组，返回同序结果）
export async function executeToolsParallel(toolCalls) {
  return Promise.all(
    toolCalls.map(({ toolName, toolInput }) => executeTool(toolName, toolInput)
      .then(output => ({ ok: true, output: String(output) }))
      .catch(err => ({ ok: false, output: `[工具执行错误] ${err.message}` }))
    )
  );
}

export default tools;
