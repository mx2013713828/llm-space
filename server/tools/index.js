import bash from './bash.js';
import readFile from './read_file.js';
import writeFile from './write_file.js';
import weatherReport from './weather_report.js';

const tools = {
  bash,
  read_file: readFile,
  write_file: writeFile,
  weather_report: weatherReport,
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

// 统一执行接口
export async function executeTool(toolName, toolInput) {
  const tool = tools[toolName];
  if (!tool) {
    throw new Error(`未知工具: ${toolName}`);
  }
  return await tool.execute(toolInput);
}

export default tools;
