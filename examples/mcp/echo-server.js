#!/usr/bin/env node

import { stdin, stdout } from 'node:process';
import { encodeJsonRpcMessage, JsonRpcMessageParser } from '../../server/mcp/mcpJsonRpc.js';

const tools = [{
	name: 'echo',
	description: 'Echo text back to the caller.',
	inputSchema: {
		type: 'object',
		properties: {
			text: { type: 'string', description: 'Text to echo.' },
		},
		required: ['text'],
	},
	annotations: { readOnlyHint: true },
}];

function send(message) {
	stdout.write(encodeJsonRpcMessage(message));
}

async function handle(message) {
	if (message.method === 'initialize') {
		send({
			jsonrpc: '2.0',
			id: message.id,
			result: {
				protocolVersion: '2025-06-18',
				capabilities: { tools: {} },
				serverInfo: { name: 'llm-space-echo', version: '0.1.0' },
				instructions: 'Echo server for LLM Space MCP tests.',
			},
		});
		return;
	}

	if (message.method === 'tools/list') {
		send({ jsonrpc: '2.0', id: message.id, result: { tools } });
		return;
	}

	if (message.method === 'tools/call') {
		send({
			jsonrpc: '2.0',
			id: message.id,
			result: {
				content: [{ type: 'text', text: `echo: ${message.params?.arguments?.text || ''}` }],
			},
		});
		return;
	}

	if (message.id !== undefined) {
		send({
			jsonrpc: '2.0',
			id: message.id,
			error: { code: -32601, message: `Unknown method: ${message.method}` },
		});
	}
}

const parser = new JsonRpcMessageParser();
stdin.on('data', (chunk) => {
	for (const message of parser.push(chunk)) {
		handle(message).catch((err) => {
			if (message.id !== undefined) {
				send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: err.message } });
			}
		});
	}
});
