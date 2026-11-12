import test from 'node:test';
import assert from 'node:assert/strict';

import { renderSummaryMarkdown, MARKDOWN_FOOTER } from '../src/render/markdown.js';
import {
  richSummary,
  passSummary,
  noDataSummary,
  hostileSummary,
  PAYLOADS,
} from './fixtures-summary.js';

test('markdown title carries the overall status', () => {
  assert.ok(renderSummaryMarkdown(richSummary()).startsWith('# MCP Report Hub: FAIL\n'));
  assert.ok(renderSummaryMarkdown(passSummary()).startsWith('# MCP Report Hub: PASS\n'));
  assert.ok(renderSummaryMarkdown(noDataSummary()).startsWith('# MCP Report Hub: NO\\_DATA\n'));
});

test('markdown lists overall reasons', () => {
  const md = renderSummaryMarkdown(richSummary());
  assert.ok(md.includes('- failing\\_report'));
  assert.ok(md.includes('- input\\_problem'));
});

test('markdown products table lists all five products', () => {
  const md = renderSummaryMarkdown(richSummary());
  for (const product of ['probe', 'diff', 'policy\\-gate', 'mock\\-server', 'contract\\-runner']) {
    assert.ok(md.includes(`| ${product} |`), `missing product row: ${product}`);
  }
  assert.ok(md.includes('| policy\\-gate | 2 | failure | FAIL (Policy compliance) |'));
});

test('markdown shows the no-reports state for empty products', () => {
  const md = renderSummaryMarkdown(noDataSummary());
  assert.ok(md.includes('| probe | 0 | none | no reports |'));
});

test('markdown shows the test success rate with the floored percent', () => {
  assert.ok(renderSummaryMarkdown(richSummary()).includes('80% (4 passed, 1 failed)'));
  assert.ok(renderSummaryMarkdown(noDataSummary()).includes('No test results.'));
});

test('markdown lists findings failures first, then warnings, then info', () => {
  const md = renderSummaryMarkdown(richSummary());
  const failDiff = md.indexOf('tool\\_removed');
  const failPolicy = md.indexOf('tool\\_denied');
  const warnProbe = md.indexOf('TOOL\\_DESCRIPTION\\_MISSING');
  const warnPolicy = md.indexOf('description\\_missing');
  const infoDiff = md.indexOf('property\\_added');
  assert.ok(failDiff !== -1 && failPolicy !== -1 && warnProbe !== -1 && warnPolicy !== -1 && infoDiff !== -1);
  assert.ok(failDiff < warnProbe, 'fail finding must precede warn finding');
  assert.ok(failPolicy < warnProbe, 'fail finding must precede warn finding across products');
  assert.ok(warnProbe < infoDiff, 'warn finding must precede info finding');
});

test('markdown lists problems with kind, source label and detail', () => {
  const md = renderSummaryMarkdown(richSummary());
  assert.ok(md.includes('- invalid\\_json (report\\-9): line 3 column 5'));
});

test('markdown footer states the no-MCP-server guarantee', () => {
  const md = renderSummaryMarkdown(richSummary());
  assert.ok(md.includes(MARKDOWN_FOOTER));
  assert.ok(md.trimEnd().endsWith(MARKDOWN_FOOTER));
});

test('markdown escapes hostile payloads in rendered fields', () => {
  const md = renderSummaryMarkdown(hostileSummary());
  assert.ok(!md.includes(PAYLOADS.script));
  assert.ok(md.includes('\\<script\\>alert\\(1\\)\\</script\\>'));
});

test('markdown strips ANSI and bidi controls from problem details', () => {
  const md = renderSummaryMarkdown(hostileSummary());
  assert.ok(!md.includes('\u001B'));
  assert.ok(!md.includes('\u202E'));
  assert.ok(md.includes('red spoofed\\-RLIname'));
});
