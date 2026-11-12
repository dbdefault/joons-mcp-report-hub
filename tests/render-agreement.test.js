import test from 'node:test';
import assert from 'node:assert/strict';

import { renderSummaryJson } from '../src/render/json.js';
import { renderSummaryMarkdown } from '../src/render/markdown.js';
import { renderSummaryTerminal } from '../src/render/terminal.js';
import { richSummary, passSummary, noDataSummary } from './fixtures-summary.js';

test('json, markdown and terminal agree on overall status and key figures', () => {
  const summary = richSummary();
  const json = JSON.parse(renderSummaryJson(summary));
  const md = renderSummaryMarkdown(summary);
  const term = renderSummaryTerminal(summary);

  assert.equal(json.overall.status, 'FAIL');
  for (const out of [md, term]) {
    assert.ok(out.includes('FAIL'));
    assert.ok(out.includes('80%'));
    assert.ok(out.includes('4 passed, 1 failed'));
  }
  assert.ok(md.includes('tool\\_denied'));
  assert.ok(term.includes('tool_denied'));
  assert.ok(md.includes('description\\_missing'));
  assert.ok(term.includes('description_missing'));
  assert.ok(md.includes('invalid\\_json'));
  assert.ok(term.includes('invalid_json'));
  assert.ok(md.includes('report\\-9'));
  assert.ok(term.includes('report-9'));
  assert.equal(json.testSuccessRate.percent, 80);
  assert.ok(md.includes('tool\\_removed'));
  assert.ok(term.includes('tool_removed'));
});

test('json, markdown and terminal agree for PASS and NO_DATA summaries', () => {
  const pass = passSummary();
  const passJson = JSON.parse(renderSummaryJson(pass));
  assert.equal(passJson.overall.status, 'PASS');
  assert.ok(renderSummaryMarkdown(pass).includes('100%'));
  assert.ok(renderSummaryTerminal(pass).includes('100%'));

  const noData = noDataSummary();
  const noDataJson = JSON.parse(renderSummaryJson(noData));
  assert.equal(noDataJson.overall.status, 'NO_DATA');
  assert.ok(renderSummaryMarkdown(noData).includes('no\\_verdict\\_reports'));
  assert.ok(renderSummaryTerminal(noData).includes('no_verdict_reports'));
  assert.ok(renderSummaryMarkdown(noData).includes('Mock recording'));
  assert.ok(renderSummaryTerminal(noData).includes('Mock recording (not a test result)'));
});
