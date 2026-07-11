import test from 'node:test';
import assert from 'node:assert/strict';

import {
	encodeJsonRpcMessage,
	JsonRpcMessageParser,
} from './mcpJsonRpc.js';

test('encodes stdio JSON-RPC as one newline-delimited message', () => {
	const encoded = encodeJsonRpcMessage({ jsonrpc: '2.0', id: 1, result: { ok: true } });
	assert.equal(encoded, '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n');

	const parser = new JsonRpcMessageParser();
	const chunks = [
		encoded.slice(0, 8),
		encoded.slice(8, 20),
		encoded.slice(20),
	];
	const messages = chunks.flatMap(chunk => parser.push(Buffer.from(chunk)));
	assert.deepEqual(messages, [{ jsonrpc: '2.0', id: 1, result: { ok: true } }]);
});

test('parses legacy Content-Length framed JSON-RPC responses', () => {
	const body = '{"jsonrpc":"2.0","id":1,"result":"ok"}';
	const parser = new JsonRpcMessageParser();
	const messages = parser.push(Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`));
	assert.deepEqual(messages, [{ jsonrpc: '2.0', id: 1, result: 'ok' }]);
});

test('parses newline-delimited JSON-RPC responses', () => {
	const parser = new JsonRpcMessageParser();
	const messages = parser.push(Buffer.from('{"jsonrpc":"2.0","id":1,"result":"ok"}\n'));
	assert.deepEqual(messages, [{ jsonrpc: '2.0', id: 1, result: 'ok' }]);
});
