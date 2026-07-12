import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function readSource(relativePath) {
	return readFile(path.join(__dirname, relativePath), 'utf8');
}

test('generic title attributes retain their native cursor', async () => {
	const css = await readSource('index.css');
	assert.doesNotMatch(css, /\[title\]\s*\{[^}]*cursor\s*:\s*help/i);
});

test('collapsed workbench panels keep the expand action at the top rail position', async () => {
	const [component, css] = await Promise.all([
		readSource('components/ResizableWorkbenchPanel.jsx'),
		readSource('App.css'),
	]);
	const railMarkup = component.match(/<div className="workbench-panel-rail">([\s\S]*?)<\/div>\n\s*<div/);
	assert.ok(railMarkup, 'expected collapsed rail markup');
	assert.ok(
		railMarkup[1].indexOf('<button') < railMarkup[1].indexOf('<span'),
		'expand control should precede the identifying icon',
	);
	assert.match(css, /\.workbench-panel-rail\s*\{[^}]*justify-content:\s*flex-start/i);
});
