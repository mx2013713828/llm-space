import { toolRegistry } from './ToolRegistry.js';
import { getToolName } from '../agent/toolPool.js';

export function getToolSchemas() {
  return toolRegistry.getSchemas();
}

export function getToolSchemasForTools(tools = [], registry = toolRegistry) {
  const enabledTools = Array.isArray(tools) ? tools : [];
  const builtinNames = enabledTools
    .filter(tool => typeof tool === 'string')
    .map(getToolName)
    .filter(Boolean);
  const schemas = registry.getSchemas(builtinNames);
  const dynamicSchemas = enabledTools
    .filter(tool => tool && typeof tool === 'object')
    .map(tool => ({
      name: tool.name,
      description: tool.description || '',
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
  return [...schemas, ...dynamicSchemas];
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
