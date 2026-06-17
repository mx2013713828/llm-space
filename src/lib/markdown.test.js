import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownBlocks } from './markdown.js';

test('parses headings, paragraphs, and unordered lists', () => {
  assert.deepEqual(parseMarkdownBlocks('# Title\n\nHello **world**\n\n- one\n- two'), [
    { type: 'heading', level: 1, text: 'Title' },
    { type: 'paragraph', text: 'Hello **world**' },
    { type: 'list', ordered: false, items: ['one', 'two'] },
  ]);
});

test('parses fenced code blocks', () => {
  assert.deepEqual(parseMarkdownBlocks('```js\nconsole.log(1)\n```'), [
    { type: 'code', language: 'js', text: 'console.log(1)' },
  ]);
});

test('keeps raw html as text content', () => {
  assert.deepEqual(parseMarkdownBlocks('<img src=x onerror=alert(1)>'), [
    { type: 'paragraph', text: '<img src=x onerror=alert(1)>' },
  ]);
});
