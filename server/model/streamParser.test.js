import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnthropicCompatibleStreamState,
  normalizeAnthropicCompatibleEvent,
  parseProviderSseLines,
} from './streamParser.js';

test('parseProviderSseLines parses data lines and reports malformed JSON without throwing', () => {
  const events = parseProviderSseLines([
    'event: message_start',
    'data: {"type":"message_start","message":{"model":"deepseek-v4","usage":{"input_tokens":42}}}',
    'data: {not-json',
    'data: [DONE]',
    '',
  ]);

  assert.deepEqual(events[0], {
    type: 'message_start',
    message: {
      model: 'deepseek-v4',
      usage: { input_tokens: 42 },
    },
  });
  assert.equal(events[1]?.type, 'parse_error');
  assert.equal(events[1]?.raw, '{not-json');
  assert.match(events[1]?.error, /JSON|token|property/i);
  assert.equal(events.length, 2);
});

test('normalizeAnthropicCompatibleEvent emits provider-neutral thinking and text events', () => {
  const state = createAnthropicCompatibleStreamState();
  const normalized = [
    ...normalizeAnthropicCompatibleEvent({
      type: 'message_start',
      message: { model: 'deepseek-v4', usage: { input_tokens: 10 } },
    }, state),
    ...normalizeAnthropicCompatibleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', signature: 'sig' },
    }, state),
    ...normalizeAnthropicCompatibleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Plan.' },
    }, state),
    ...normalizeAnthropicCompatibleEvent({ type: 'content_block_stop', index: 0 }, state),
    ...normalizeAnthropicCompatibleEvent({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'text' },
    }, state),
    ...normalizeAnthropicCompatibleEvent({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: 'Answer.' },
    }, state),
    ...normalizeAnthropicCompatibleEvent({ type: 'content_block_stop', index: 1 }, state),
    ...normalizeAnthropicCompatibleEvent({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 5 },
    }, state),
  ];

  assert.deepEqual(normalized, [
    { type: 'message_start', model: 'deepseek-v4', usage: { input_tokens: 10 } },
    { type: 'thinking_start', index: 0, signature: 'sig' },
    { type: 'thinking_delta', index: 0, text: 'Plan.' },
    { type: 'thinking_end', index: 0 },
    { type: 'text_start', index: 1 },
    { type: 'text_delta', index: 1, text: 'Answer.' },
    { type: 'text_end', index: 1 },
    { type: 'message_delta', stopReason: 'end_turn', usage: { output_tokens: 5 } },
  ]);
});

test('normalizeAnthropicCompatibleEvent tracks interleaved content indexes independently', () => {
  const state = createAnthropicCompatibleStreamState();
  const normalized = [
    ...normalizeAnthropicCompatibleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text' },
    }, state),
    ...normalizeAnthropicCompatibleEvent({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'weather_report' },
    }, state),
    ...normalizeAnthropicCompatibleEvent({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"city"' },
    }, state),
    ...normalizeAnthropicCompatibleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Checking.' },
    }, state),
    ...normalizeAnthropicCompatibleEvent({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: ':"Linyi"}' },
    }, state),
    ...normalizeAnthropicCompatibleEvent({ type: 'content_block_stop', index: 1 }, state),
    ...normalizeAnthropicCompatibleEvent({ type: 'content_block_stop', index: 0 }, state),
  ];

  assert.deepEqual(normalized, [
    { type: 'text_start', index: 0 },
    { type: 'tool_start', index: 1, id: 'toolu_1', name: 'weather_report' },
    { type: 'tool_input_delta', index: 1, partialJson: '{"city"' },
    { type: 'text_delta', index: 0, text: 'Checking.' },
    { type: 'tool_input_delta', index: 1, partialJson: ':"Linyi"}' },
    { type: 'tool_end', index: 1 },
    { type: 'text_end', index: 0 },
  ]);
});

test('normalizeAnthropicCompatibleEvent recovers when text_delta arrives on a thinking index', () => {
  const state = createAnthropicCompatibleStreamState();
  const normalized = [
    ...normalizeAnthropicCompatibleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', signature: '' },
    }, state),
    ...normalizeAnthropicCompatibleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: '[Thinking folded] response' },
    }, state),
    ...normalizeAnthropicCompatibleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Weather report.' },
    }, state),
    ...normalizeAnthropicCompatibleEvent({ type: 'content_block_stop', index: 0 }, state),
  ];

  assert.deepEqual(normalized, [
    { type: 'thinking_start', index: 0, signature: '' },
    { type: 'thinking_delta', index: 0, text: '[Thinking folded] response' },
    { type: 'thinking_end', index: 0 },
    { type: 'text_start', index: 0, recovered: true },
    { type: 'text_delta', index: 0, text: 'Weather report.' },
    { type: 'text_end', index: 0 },
  ]);
});

test('normalizeAnthropicCompatibleEvent maps provider stream errors', () => {
  const state = createAnthropicCompatibleStreamState();

  assert.deepEqual(normalizeAnthropicCompatibleEvent({
    type: 'error',
    error: { message: 'model overloaded' },
  }, state), [
    { type: 'provider_error', message: 'model overloaded' },
  ]);
});
