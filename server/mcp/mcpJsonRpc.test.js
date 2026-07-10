import test from 'node:test';
import assert from 'node:assert/strict';

import {
	encodeJsonRpcMessage,
	JsonRpcMessageParser,
} from './mcpJsonRpc.js';

test('encodes and parses Content-Length framed JSON-RPC messages', () => {
	const encoded = encodeJsonRpcMessage({ jsonrpc: '2.0', id: 1, result: { ok: true } });
	const parser = new JsonRpcMessageParser();
	const chunks = [
		encoded.slice(0, 8),
		encoded.slice(8, 20),
		encoded.slice(20),
	];
	const messages = chunks.flatMap(chunk => parser.push(Buffer.from(chunk)));
	assert.deepEqual(messages, [{ jsonrpc: '2.0', id: 1, result: { ok: true } }]);
});

test('parses newline-delimited JSON-RPC as a fallback', () => {
	const parser = new JsonRpcMessageParser();
	const messages = parser.push(Buffer.from('{"jsonrpc":"2.0","id":1,"result":"ok"}\n'));
	assert.deepEqual(messages, [{ jsonrpc: '2.0', id: 1, result: 'ok' }]);
});
