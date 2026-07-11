import { spawn } from 'child_process';

import { encodeJsonRpcMessage, JsonRpcMessageParser } from './mcpJsonRpc.js';

function hasHeader(headers, targetName) {
	const normalizedTarget = String(targetName).toLowerCase();
	return Object.keys(headers).some(name => name.toLowerCase() === normalizedTarget);
}

function setHeader(headers, name, value) {
	const existingName = Object.keys(headers).find(key => key.toLowerCase() === String(name).toLowerCase());
	if (existingName) delete headers[existingName];
	headers[name] = value;
}

export function buildMcpStdioEnvironment(server = {}, inheritedEnv = process.env) {
	return { ...inheritedEnv, ...(server.env || {}) };
}

export function buildMcpHttpHeaders(server = {}, processEnv = process.env) {
	const headers = {
		'content-type': 'application/json',
		accept: 'application/json, text/event-stream',
	};
	for (const [name, value] of Object.entries(server.headers || {})) {
		setHeader(headers, name, value);
	}
	if (server.auth?.type === 'bearer' && server.auth.env && !hasHeader(headers, 'authorization')) {
		const token = processEnv[server.auth.env];
		if (token) setHeader(headers, 'Authorization', `Bearer ${token}`);
	}
	return headers;
}

export class McpClient {
	constructor({ server, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
		this.server = server;
		this.fetchImpl = fetchImpl;
		this.timeoutMs = timeoutMs;
		this.nextId = 1;
		this.pending = new Map();
		this.process = null;
		this.parser = new JsonRpcMessageParser();
		this.initialized = false;
		this.serverInfo = null;
		this.instructions = '';
	}

	async connect() {
		if (this.initialized) return this.getStatus();
		if (this.server.transport === 'streamable_http') {
			const result = await this.request('initialize', this.#initializeParams());
			this.serverInfo = result.serverInfo || null;
			this.instructions = result.instructions || '';
			this.initialized = true;
			return this.getStatus();
		}

		this.process = spawn(this.server.command, this.server.args || [], {
			cwd: this.server.cwd || process.cwd(),
			env: buildMcpStdioEnvironment(this.server),
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		this.process.stdout.on('data', chunk => {
			for (const message of this.parser.push(chunk)) {
				this.#handleMessage(message);
			}
		});

		this.process.stderr.on('data', () => {});
		this.process.on('exit', () => {
			for (const { reject } of this.pending.values()) {
				reject(new Error(`MCP server exited: ${this.server.id}`));
			}
			this.pending.clear();
			this.initialized = false;
		});

		const result = await this.request('initialize', this.#initializeParams());
		this.serverInfo = result.serverInfo || null;
		this.instructions = result.instructions || '';
		this.initialized = true;
		this.notify('notifications/initialized', {});
		return this.getStatus();
	}

	getStatus() {
		return {
			serverId: this.server.id,
			status: this.initialized ? 'connected' : 'disconnected',
			serverInfo: this.serverInfo,
			instructions: this.instructions,
		};
	}

	async listTools() {
		await this.connect();
		const result = await this.request('tools/list', {});
		return Array.isArray(result.tools) ? result.tools : [];
	}

	async callTool(name, args = {}) {
		await this.connect();
		return this.request('tools/call', { name, arguments: args || {} });
	}

	notify(method, params = {}) {
		const message = { jsonrpc: '2.0', method, params };
		if (this.server.transport === 'streamable_http') return;
		this.process?.stdin?.write(encodeJsonRpcMessage(message));
	}

	async request(method, params = {}) {
		if (this.server.transport === 'streamable_http') {
			return this.#httpRequest(method, params);
		}
		const id = this.nextId++;
		const message = { jsonrpc: '2.0', id, method, params };
		const promise = new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`MCP request timed out: ${method}`));
			}, this.timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
		});
		this.process.stdin.write(encodeJsonRpcMessage(message));
		return promise;
	}

	async disconnect() {
		if (this.process) {
			this.process.kill();
			this.process = null;
		}
		this.initialized = false;
	}

	#handleMessage(message) {
		if (message.id === undefined) return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pending.delete(message.id);
		if (message.error) {
			pending.reject(new Error(message.error.message || 'MCP request failed'));
		} else {
			pending.resolve(message.result || {});
		}
	}

	async #httpRequest(method, params) {
		const id = this.nextId++;
		const headers = buildMcpHttpHeaders(this.server);
		const res = await this.fetchImpl(this.server.url, {
			method: 'POST',
			headers,
			body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
		});
		const text = await res.text();
		if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text}`);
		const parsed = JSON.parse(text);
		if (parsed.error) throw new Error(parsed.error.message || 'MCP HTTP request failed');
		return parsed.result || {};
	}

	#initializeParams() {
		return {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'llm-space', version: '0.1.0' },
		};
	}
}
