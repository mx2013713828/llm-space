import { toolRegistry } from './ToolRegistry.js';
import { getToolName } from '../agent/toolPool.js';

export function getToolSchemas() {
  return toolRegistry.getSchemas();
}

export function getToolSchemasForTools(tools = [], registry = toolRegistry) {
  const enabledToolNames = (Array.isArray(tools) ? tools : []).map(getToolName).filter(Boolean);
  return registry.getSchemas(enabledToolNames);
}

export async function executeTool(toolName, toolInput, onData) {
  return toolRegistry.execute(toolName, toolInput, onData);
}

export async function executeToolsParallel(toolCalls) {
  return Promise.all(
    toolCalls.map(({ toolName, toolInput }) => toolRegistry.execute(toolName, toolInput)
      .then(output => ({ ok: true, output: String(output) }))
      .catch(err => ({ ok: false, output: `[工具执行错误] ${err.message}` }))
    )
  );
}

export default toolRegistry;
