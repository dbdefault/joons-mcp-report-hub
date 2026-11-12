import test from 'node:test';
import assert from 'node:assert/strict';

import { renderSummaryJson } from '../src/render/json.js';
import { richSummary, hostileSummary, emptySummary, PAYLOADS } from './fixtures-summary.js';

test('json render is exactly JSON.stringify(summary, null, 2) plus a newline', () => {
  const summary = richSummary();
  assert.equal(renderSummaryJson(summary), JSON.stringify(summary, null, 2) + '\n');
});

test('json render ends with a single trailing newline', () => {
  const out = renderSummaryJson(emptySummary());
  assert.ok(out.endsWith('\n'));
  assert.ok(!out.endsWith('\n\n'));
});

test('json render is deterministic for identical input', () => {
  const summary = richSummary();
  assert.equal(renderSummaryJson(summary), renderSummaryJson(richSummary()));
});

test('json render round-trips to an equal summary', () => {
  const summary = richSummary();
  assert.deepEqual(JSON.parse(renderSummaryJson(summary)), summary);
});

test('json render keeps hostile strings as data without raw control bytes', () => {
  const out = renderSummaryJson(hostileSummary());
  assert.ok(!out.includes('\u001B'));
  assert.ok(out.includes('\\u001b'));
  assert.deepEqual(JSON.parse(out).reports[0].findings[0].details[0].subject, PAYLOADS.script);
  assert.deepEqual(JSON.parse(out).reports[0].findings[0].details[0].message, PAYLOADS.img);
});

test('json render handles undefined input as null', () => {
  assert.equal(renderSummaryJson(undefined), 'null\n');
});
