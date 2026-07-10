import { buildMcpToolName } from './mcpNames.js';

function getSchemaProperties(schema) {
	if (!schema || typeof schema !== 'object') return {};
	if (schema.properties && typeof schema.properties === 'object') return schema.properties;
	return {};
}

function convertPropertySchema(property = {}, required = false) {
	return {
		type: typeof property.type === 'string' ? property.type : 'string',
		description: String(property.description || ''),
		required,
	};
}

export function adaptMcpTool({ server, tool }) {
	const inputSchema = tool?.inputSchema || tool?.input_schema || {};
	const required = new Set(Array.isArray(inputSchema.required) ? inputSchema.required : []);
	const properties = getSchemaProperties(inputSchema);
	const parameters = {};
	for (const [name, property] of Object.entries(properties)) {
		parameters[name] = convertPropertySchema(property, required.has(name));
	}

	const serverName = server?.name || server?.id || 'MCP';
	const serverId = server?.id || serverName;
	const toolName = String(tool?.name || 'tool');
	return {
		name: buildMcpToolName(serverId, toolName),
		description: `[MCP: ${serverName}] ${String(tool?.description || toolName)}`,
		parameters,
		annotations: tool?.annotations || {},
		mcp: {
			serverId: String(serverId),
			serverName,
			toolName,
			originalName: toolName,
		},
	};
}

export function adaptMcpTools({ server, tools = [] }) {
	return (Array.isArray(tools) ? tools : []).map(tool => adaptMcpTool({ server, tool }));
}
