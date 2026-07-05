import test from 'node:test';
import assert from 'node:assert/strict';

import { toolRegistry } from './ToolRegistry.js';

test('registers the agent team tool schemas', () => {
  const schemas = toolRegistry.getSchemas([
    'spawn_teammate',
    'send_team_message',
    'check_team_inbox',
    'wait_for_teammates',
  ]);
  const names = schemas.map(tool => tool.name);

  assert.deepEqual(names, [
    'spawn_teammate',
    'send_team_message',
    'check_team_inbox',
    'wait_for_teammates',
  ]);

  assert.equal(toolRegistry.getTool('spawn_teammate')?.name, 'spawn_teammate');
  assert.equal(schemas[0].input_schema.properties.maxTurns, undefined);
  assert.equal(toolRegistry.getTool('send_team_message')?.name, 'send_team_message');
  assert.equal(toolRegistry.getTool('check_team_inbox')?.name, 'check_team_inbox');
  assert.equal(toolRegistry.getTool('wait_for_teammates')?.name, 'wait_for_teammates');
});

test('registers knowledge runtime tool schemas', () => {
  const schemas = toolRegistry.getSchemas([
    'list_mounted_knowledge_bases',
    'query_knowledge_base',
  ]);
  const names = schemas.map(tool => tool.name);

  assert.deepEqual(names, [
    'list_mounted_knowledge_bases',
    'query_knowledge_base',
  ]);
  assert.equal(toolRegistry.getTool('list_mounted_knowledge_bases')?.name, 'list_mounted_knowledge_bases');
  assert.equal(toolRegistry.getTool('query_knowledge_base')?.name, 'query_knowledge_base');
  assert.deepEqual(schemas[0].input_schema.required, []);
  assert.deepEqual(schemas[1].input_schema.required, ['query']);
  assert.equal(schemas[1].input_schema.properties.knowledgeBaseIds.type, 'array');
});
