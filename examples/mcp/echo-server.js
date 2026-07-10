#!/usr/bin/env node

import { stdin, stdout } from 'node:process';

function encode(message) {
	const body = JSON.stringify(message);
	return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

class Parser {
	constructor() {
		this.buffer = Buffer.alloc(0);
	}

	push(chunk) {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		const messages = [];
		while (true) {
			const headerEnd = this.buffer.indexOf('\r\n\r\n');
			if (headerEnd < 0) break;
			const header = this.buffer.slice(0, headerEnd).toString('utf8');
			const match = /content-length:\s*(\d+)/i.exec(header);
			if (!match) break;
			const length = Number(match[1]);
			const bodyStart = headerEnd + 4;
			const bodyEnd = bodyStart + length;
			if (this.buffer.length < bodyEnd) break;
			messages.push(JSON.parse(this.buffer.slice(bodyStart, bodyEnd).toString('utf8')));
			this.buffer = this.buffer.slice(bodyEnd);
		}
		return messages;
	}
}

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
	stdout.write(encode(message));
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

const parser = new Parser();
stdin.on('data', (chunk) => {
	for (const message of parser.push(chunk)) {
		handle(message).catch((err) => {
			if (message.id !== undefined) {
				send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: err.message } });
			}
		});
	}
});
