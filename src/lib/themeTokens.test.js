import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const cssPath = new URL('../index.css', import.meta.url);
const appCssPath = new URL('../App.css', import.meta.url);

function declarationsFor(selector, css) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'));
  return new Set(match?.[1].match(/--[A-Za-z0-9-]+(?=\s*:)/g) || []);
}

test('each theme defines every CSS custom property used by the interface', async () => {
  const [css, appCss] = await Promise.all([readFile(cssPath, 'utf8'), readFile(appCssPath, 'utf8')]);
  const usedTokens = new Set([...`${css}\n${appCss}`.matchAll(/var\((--[A-Za-z0-9-]+)/g)].map(([, token]) => token));
  const sharedTokens = declarationsFor(':root', css);

  for (const theme of ['[data-theme="dark"]', '[data-theme="light"]']) {
    const definedTokens = new Set([...sharedTokens, ...declarationsFor(theme, css)]);
    const missingTokens = [...usedTokens].filter((token) => !definedTokens.has(token));

    assert.deepEqual(missingTokens, [], `${theme} is missing: ${missingTokens.join(', ')}`);
  }
});
