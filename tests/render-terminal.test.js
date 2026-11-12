import test from 'node:test';
import assert from 'node:assert/strict';

import { renderSummaryTerminal } from '../src/render/terminal.js';
import {
  richSummary,
  hostileSummary,
  manyFindingsSummary,
  validationOnlySummary,
} from './fixtures-summary.js';

test('terminal starts with the overall line', () => {
  assert.ok(renderSummaryTerminal(richSummary()).startsWith('MCP Report Hub: FAIL\n'));
  assert.ok(renderSummaryTerminal(validationOnlySummary()).startsWith('MCP Report Hub: FAIL\n'));
});

test('terminal prints the counts line', () => {
  const out = renderSummaryTerminal(richSummary());
  assert.ok(out.includes('Counts: 9 files, 6 reports, 1 duplicate, 1 ignored, 1 rejected'));
});

test('terminal prints the test success rate', () => {
  const out = renderSummaryTerminal(richSummary());
  assert.ok(out.includes('Test success rate: 80% (4 passed, 1 failed)'));
});

test('terminal shows every status with its kind label', () => {
  const out = renderSummaryTerminal(richSummary());
  assert.ok(out.includes('probe: PASS (Server health)'));
  assert.ok(out.includes('diff: high (Change risk)'));
  assert.ok(out.includes('policy-gate: FAIL (Policy compliance)'));
  assert.ok(out.includes('mock-server: RECORDED (Mock recording (not a test result))'));
  assert.ok(out.includes('contract-runner: FAIL (Test results)'));
  const validationOut = renderSummaryTerminal(validationOnlySummary());
  assert.ok(validationOut.includes('policy-gate: INVALID (Input validation)'));
});

test('terminal shows a no-reports state for empty products', () => {
  const out = renderSummaryTerminal(validationOnlySummary());
  assert.ok(out.includes('probe: no reports'));
});

test('terminal emits no ANSI even for hostile input', () => {
  const out = renderSummaryTerminal(hostileSummary());
  assert.ok(!out.includes('\u001B'));
  assert.ok(!out.includes('\u202E'));
  assert.ok(out.includes('red spoofed-RLIname'));
});

test('terminal caps the findings list at 20', () => {
  const out = renderSummaryTerminal(manyFindingsSummary());
  const findingLines = out.split('\n').filter((line) => /^  \[(fail|warn|info)\]/.test(line));
  assert.equal(findingLines.length, 20);
  assert.ok(findingLines.some((line) => line.includes('CODE_0')));
  assert.ok(!out.includes('CODE_11'));
});

test('terminal lists problems with kind, source and detail', () => {
  const out = renderSummaryTerminal(richSummary());
  assert.ok(out.includes('- invalid_json (report-9): line 3 column 5'));
});
