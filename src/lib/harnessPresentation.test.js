import test from 'node:test';
import assert from 'node:assert/strict';

import { getHarnessPresentation } from './harnessPresentation.js';

test('presents display name as primary and immutable id as secondary', () => {
	assert.deepEqual(getHarnessPresentation({ id: 'chat-bot', name: 'Basic Chatbot' }), {
		id: 'chat-bot',
		name: 'Basic Chatbot',
		primary: 'Basic Chatbot',
		secondary: 'chat-bot',
		title: 'Basic Chatbot (chat-bot)',
	});
});

test('normalizes legacy filename-shaped names for display', () => {
	assert.equal(getHarnessPresentation({ id: 'legacy', name: 'Legacy.json' }).primary, 'Legacy');
});

test('uses a stable empty presentation when no harness is selected', () => {
	assert.deepEqual(getHarnessPresentation(null), {
		id: '',
		name: '',
		primary: 'No harness selected',
		secondary: 'Select a harness',
		title: 'No harness selected',
	});
});
