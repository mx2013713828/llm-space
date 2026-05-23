import { toolRegistry } from './ToolRegistry.js';

export function getToolSchemas() {
  return toolRegistry.getSchemas();
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
