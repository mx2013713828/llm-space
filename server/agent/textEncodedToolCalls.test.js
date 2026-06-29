import test from 'node:test';
import assert from 'node:assert/strict';

import { isToolEnabled, parseTextEncodedToolCalls } from './textEncodedToolCalls.js';

test('parses full-width DSML tool calls into tool names and typed arguments', () => {
  const calls = parseTextEncodedToolCalls(`
<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="wait_for_teammates">
<｜｜DSML｜｜parameter name="timeoutMs" string="false">20000</｜｜DSML｜｜parameter>
<｜｜DSML｜｜parameter name="teamId" string="true">team_1</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>
  `);

  assert.deepEqual(calls, [
    {
      name: 'wait_for_teammates',
      input: {
        timeoutMs: 20000,
        teamId: 'team_1',
      },
    },
  ]);
});

test('does not parse ordinary text as DSML tool calls', () => {
  assert.equal(parseTextEncodedToolCalls('Here is my final answer.'), null);
});

test('checks enabled tools by string or object name', () => {
  assert.equal(isToolEnabled(['bash', { name: 'wait_for_teammates' }], 'wait_for_teammates'), true);
  assert.equal(isToolEnabled(['bash'], 'wait_for_teammates'), false);
});
