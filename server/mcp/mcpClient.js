import { spawn } from 'child_process';

import { encodeJsonRpcMessage, JsonRpcMessageParser } from './mcpJsonRpc.js';

const MAX_DIAGNOSTIC_LENGTH = 2000;

export function classifyMcpError(error) {
	const message = String(error?.message || error || 'Unknown MCP error');
	let code = 'transport_error';
	if (/\b(401|403)\b|unauthori[sz]ed|invalid (api )?key|authentication/i.test(message)) code = 'authentication_failed';
	else if (/timed out|timeout/i.test(message)) code = 'timeout';
	else if (/server exited|process exited|\bexit\b/i.test(message)) code = 'process_exited';
	else if (/spawn|enoent|eacces/i.test(message)) code = 'spawn_failed';
	else if (/initialize/i.test(message)) code = 'initialize_failed';
	else if (/tools\/call|tool call|tools\/list/i.test(message)) code = 'tool_call_failed';
	return { code, message };
}

function appendDiagnostic(current, chunk) {
	const next = `${current || ''}${String(chunk || '')}`;
	return next.length <= MAX_DIAGNOSTIC_LENGTH ? next : next.slice(-MAX_DIAGNOSTIC_LENGTH);
}

function hasHeader(headers, targetName) {
	const normalizedTarget = String(targetName).toLowerCase();
	return Object.keys(headers).some(name => name.toLowerCase() === normalizedTarget);
}

function setHeader(headers, name, value) {
	const existingName = Object.keys(headers).find(key => key.toLowerCase() === String(name).toLowerCase());
	if (existingName) delete headers[existingName];
	headers[name] = value;
}

export function resolveMcpValue(entry, processEnv = process.env) {
	if (typeof entry === 'string' && entry) {
		return { value: entry, source: 'literal', configured: true };
	}
	if (!entry || typeof entry !== 'object') return null;
	if (entry.source === 'literal' && entry.value) {
		return { value: String(entry.value), source: 'literal', configured: true };
	}
	if (entry.source === 'environment' && entry.name && processEnv[entry.name]) {
		return { value: String(processEnv[entry.name]), source: 'environment', configured: true };
	}
	if (entry.source === 'bearer') {
		const token = entry.value || (entry.name ? processEnv[entry.name] : '');
		if (token) return { value: `Bearer ${token}`, source: 'bearer', configured: true };
	}
	return null;
}

export function buildMcpStdioEnvironment(server = {}, inheritedEnv = process.env) {
	const configured = {};
	for (const [name, entry] of Object.entries(server.env || {})) {
		const resolved = resolveMcpValue(entry, inheritedEnv);
		if (resolved) configured[name] = resolved.value;
	}
	return { ...inheritedEnv, ...configured };
}

export function buildMcpHttpHeaders(server = {}, processEnv = process.env) {
	const headers = {
		'content-type': 'application/json',
		accept: 'application/json, text/event-stream',
	};
	for (const [name, entry] of Object.entries(server.headers || {})) {
		const resolved = resolveMcpValue(entry, processEnv);
		if (resolved) setHeader(headers, name, resolved.value);
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
		this.diagnostic = '';
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

		this.process.stderr.on('data', chunk => {
			this.diagnostic = appendDiagnostic(this.diagnostic, chunk);
		});
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
