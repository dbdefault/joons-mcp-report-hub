import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDashboardHtml } from '../src/render/html.js';
import {
  richSummary,
  passSummary,
  warnSummary,
  noDataSummary,
  emptySummary,
  hostileSummary,
  PAYLOADS,
} from './fixtures-summary.js';

const FORBIDDEN = [
  'onerror=',
  'onload=',
  ' href=',
  ' src=',
  'url(',
  'http:',
  'https:',
  '@import',
  '<link',
  '<iframe',
  '<form',
  '<img',
  '<![CDATA[',
];

function assertNoForbiddenStrings(html) {
  for (const marker of FORBIDDEN) {
    assert.ok(!html.includes(marker), `forbidden string in output: ${marker}`);
  }
  assert.equal(html.split('<script').length, 2, 'exactly one inline <script>');
  assert.equal(html.split('</script>').length, 2, 'exactly one inline </script>');
  assert.equal(html.split('<style').length, 2, 'exactly one inline <style>');
  assert.equal(html.split('</style>').length, 2, 'exactly one inline </style>');
}

test('hostile payloads never appear raw in the dashboard', () => {
  const { html } = renderDashboardHtml(hostileSummary());
  assert.ok(!html.includes(PAYLOADS.script));
  assert.ok(!html.includes(PAYLOADS.img));
  assert.ok(!html.includes(PAYLOADS.jsUrl));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.equal(html.split('</script>').length, 2, 'only the inline script closing tag may exist');
});

test('hostile payloads appear only escaped', () => {
  const { html } = renderDashboardHtml(hostileSummary());
  assert.ok(html.includes('&lt;script&gt;alert&#40;1&#41;&lt;/script&gt;'));
  assert.ok(html.includes('&quot;&gt;&lt;img src&#61;x onerror&#61;alert&#40;1&#41;&gt;'));
  assert.ok(html.includes('&lt;/script&gt;'));
  assert.ok(html.includes('hostile-&lt;script&gt;.json'));
});

test('control and bidi characters never reach the dashboard', () => {
  const { html } = renderDashboardHtml(hostileSummary());
  assert.ok(!html.includes('\u001B'));
  assert.ok(!html.includes('\u202E'));
});

test('oversize payload is rendered in full but stays inert', () => {
  const { html } = renderDashboardHtml(hostileSummary());
  assert.ok(html.includes('A'.repeat(10000)));
  assertNoForbiddenStrings(html);
});

test('every fixture renders with no external references and a single script/style', () => {
  for (const summary of [richSummary(), passSummary(), warnSummary(), noDataSummary(), emptySummary(), hostileSummary()]) {
    const { html } = renderDashboardHtml(summary);
    assertNoForbiddenStrings(html);
  }
});

test('escaped cdata payload is inert text outside any markup construct', () => {
  const { html } = renderDashboardHtml(hostileSummary());
  assert.ok(html.includes(']]&gt;'));
  assert.ok(!html.includes('<![CDATA['));
});
