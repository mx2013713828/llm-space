import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveMcpApprovalPolicy } from './mcpPolicy.js';

const readTool = { mcp: { serverId: 'echo', toolName: 'echo' }, annotations: { readOnlyHint: true } };
const writeTool = { mcp: { serverId: 'github', toolName: 'create_issue' }, annotations: {} };

test('uses read-only default and fails closed for unknown MCP tools', () => {
	assert.deepEqual(resolveMcpApprovalPolicy({ mount: { approvalMode: 'auto_readonly' }, toolDefinition: readTool }), {
		mode: 'auto_readonly', source: 'harness', requiresApproval: false,
	});
	assert.equal(resolveMcpApprovalPolicy({ mount: { approvalMode: 'auto_readonly' }, toolDefinition: writeTool }).requiresApproval, true);
});

test('gives tool policy precedence over server and harness policy', () => {
	const result = resolveMcpApprovalPolicy({
		mount: { approvalMode: 'ask_all', serverApprovalModes: { github: 'ask_all' }, toolApprovalModes: { github: { create_issue: 'auto_all' } } },
		toolDefinition: writeTool,
	});
	assert.deepEqual(result, { mode: 'auto_all', source: 'tool', requiresApproval: false });
});
