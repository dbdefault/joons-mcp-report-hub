import test from 'node:test';
import assert from 'node:assert/strict';

import { renderBadge, BADGE_COLORS } from '../src/render/svg.js';
import { PAYLOADS } from './fixtures-summary.js';

const FORBIDDEN = ['<script', '<style', '<image', '<use', '<foreignObject', '<iframe', 'url(', 'xlink:href'];

test('badge uses the fixed template with role img and a title', () => {
  const svg = renderBadge({ label: 'MCP reports', value: 'NO DATA', level: 'info' });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" '));
  assert.ok(svg.includes('role="img"'));
  assert.ok(svg.includes('aria-label="MCP reports: NO DATA"'));
  assert.ok(svg.includes('<title>MCP reports: NO DATA</title>'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
});

test('badge width is 7 px per character plus padding per segment', () => {
  const svg = renderBadge({ label: 'MCP reports', value: 'NO DATA', level: 'info' });
  const labelWidth = 11 * 7 + 10; // 87
  const valueWidth = 7 * 7 + 10; // 59
  assert.ok(svg.includes(`width="${labelWidth + valueWidth}"`));
  assert.ok(svg.includes(`<rect width="${labelWidth}" height="20"`));
  assert.ok(svg.includes(`<rect x="${labelWidth}" width="${valueWidth}" height="20"`));
});

test('badge colors are the fixed hex values with white text', () => {
  assert.ok(renderBadge({ label: 'a', value: 'b', level: 'ok' }).includes(`fill="${BADGE_COLORS.ok}"`));
  assert.ok(renderBadge({ label: 'a', value: 'b', level: 'warning' }).includes(`fill="${BADGE_COLORS.warning}"`));
  assert.ok(renderBadge({ label: 'a', value: 'b', level: 'failure' }).includes(`fill="${BADGE_COLORS.failure}"`));
  assert.ok(renderBadge({ label: 'a', value: 'b', level: 'info' }).includes(`fill="${BADGE_COLORS.info}"`));
  assert.ok(renderBadge({ label: 'a', value: 'b', level: 'ok' }).includes('fill="#ffffff"'));
});

test('unknown level falls back to info gray, never green/red', () => {
  const svg = renderBadge({ label: 'a', value: 'b', level: 'bogus' });
  assert.ok(svg.includes(`fill="${BADGE_COLORS.info}"`));
  assert.ok(!svg.includes(`fill="${BADGE_COLORS.ok}"`));
  assert.ok(!svg.includes(`fill="${BADGE_COLORS.failure}"`));
});

test('hostile label and value are XML-escaped and never raw', () => {
  const svg = renderBadge({ label: PAYLOADS.script, value: PAYLOADS.img, level: 'ok' });
  assert.ok(!svg.includes(PAYLOADS.script));
  assert.ok(!svg.includes('<img'));
  assert.ok(!svg.includes('<script>alert'));
  assert.ok(svg.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(svg.includes('&quot;&gt;&lt;img'));
  for (const marker of FORBIDDEN) {
    assert.ok(!svg.includes(marker), `forbidden in svg: ${marker}`);
  }
});

test('badge output is deterministic', () => {
  const a = renderBadge({ label: 'MCP Diff', value: 'BREAKING', level: 'failure' });
  const b = renderBadge({ label: 'MCP Diff', value: 'BREAKING', level: 'failure' });
  assert.equal(a, b);
  assert.ok(a.includes('<title>MCP Diff: BREAKING</title>'));
});
