import test from 'node:test';
import assert from 'node:assert/strict';

import { toolRegistry } from './ToolRegistry.js';

test('registers the agent team tool schemas', () => {
  const names = toolRegistry.getSchemas([
    'spawn_teammate',
    'send_team_message',
    'check_team_inbox',
  ]).map(tool => tool.name);

  assert.deepEqual(names, [
    'spawn_teammate',
    'send_team_message',
    'check_team_inbox',
  ]);

  assert.equal(toolRegistry.getTool('spawn_teammate')?.name, 'spawn_teammate');
  assert.equal(toolRegistry.getTool('send_team_message')?.name, 'send_team_message');
  assert.equal(toolRegistry.getTool('check_team_inbox')?.name, 'check_team_inbox');
});
