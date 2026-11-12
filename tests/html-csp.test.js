import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { renderDashboardHtml } from '../src/render/html.js';
import { richSummary, emptySummary } from './fixtures-summary.js';

function extractBlock(html, tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = html.indexOf(open);
  const end = html.indexOf(close);
  assert.ok(start !== -1 && end !== -1 && end > start);
  return html.slice(start + open.length, end);
}

function sha256Base64(text) {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}

test('CSP meta carries the real SHA-256 of the inline style and script', () => {
  const { html } = renderDashboardHtml(richSummary());
  const styleText = extractBlock(html, 'style');
  const scriptText = extractBlock(html, 'script');
  const styleHash = sha256Base64(styleText);
  const scriptHash = sha256Base64(scriptText);
  assert.ok(
    html.includes(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
        `style-src 'sha256-${styleHash}'; script-src 'sha256-${scriptHash}'; ` +
        `img-src data:; base-uri 'none'; form-action 'none'">`
    )
  );
});

test('CSP meta is unique and present for every summary', () => {
  for (const summary of [richSummary(), emptySummary()]) {
    const { html } = renderDashboardHtml(summary);
    assert.equal((html.match(/http-equiv="Content-Security-Policy"/g) || []).length, 1);
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes("base-uri 'none'"));
    assert.ok(html.includes("form-action 'none'"));
    assert.ok(html.includes("img-src data:"));
  }
});

test('inline script contains no report data', () => {
  const { html } = renderDashboardHtml(richSummary());
  const scriptText = extractBlock(html, 'script');
  assert.ok(!scriptText.includes('tool_denied'));
  assert.ok(!scriptText.includes('report-1'));
  assert.ok(!scriptText.includes('FAIL'));
  assert.ok(scriptText.includes('data-filter'));
  assert.ok(scriptText.includes('expand-all'));
});
