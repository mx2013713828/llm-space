import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelsConfig, upsertModelsConfig } from './modelConfig.js';

test('parses legacy single-line MODELS_CONFIG', () => {
  const envText = 'PORT=3001\nMODELS_CONFIG=[{"id":"1","name":"DeepSeek","modelId":"deepseek-v4","url":"https://api.deepseek.com/anthropic","key":"k"}]\n';

  assert.deepEqual(parseModelsConfig(envText), [
    {
      id: '1',
      name: 'DeepSeek',
      modelId: 'deepseek-v4',
      url: 'https://api.deepseek.com/anthropic',
      key: 'k',
    },
  ]);
});

test('parses pretty multiline MODELS_CONFIG', () => {
  const envText = `PORT=3001
MODELS_CONFIG=[
  {
    "id": "1",
    "name": "DeepSeek",
    "modelId": "deepseek-v4",
    "url": "https://api.deepseek.com/anthropic",
    "key": "k",
    "contextWindow": 128000
  }
]
TAVILY_API_KEY=tvly
`;

  assert.equal(parseModelsConfig(envText)[0].contextWindow, 128000);
});

test('upserts MODELS_CONFIG as standard pretty JSON', () => {
  const envText = 'PORT=3001\nMODELS_CONFIG=[{"id":"old"}]\nTAVILY_API_KEY=tvly\n';
  const updated = upsertModelsConfig(envText, [
    { id: '1', name: 'DeepSeek', modelId: 'deepseek-v4', contextWindow: 128000 },
    { id: '2', name: 'Kimi', modelId: 'kimi-k2', contextWindow: 256000 },
  ]);

  assert.match(updated, /MODELS_CONFIG=\[\n {2}\{/);
  assert.match(updated, /"contextWindow": 128000/);
  assert.match(updated, /TAVILY_API_KEY=tvly/);
  assert.equal(parseModelsConfig(updated).length, 2);
});
