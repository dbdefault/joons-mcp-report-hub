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
  minimalSummary,
  productsMap,
} from './fixtures-summary.js';

test('dashboard is a self-contained document with landmarks and lang', () => {
  const { html } = renderDashboardHtml(richSummary());
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes('<header class="site-header">'));
  assert.ok(html.includes('<main>'));
  assert.ok(html.includes('</footer>'));
  assert.ok(html.includes('<h1>MCP Report Hub</h1>'));
});

test('FAIL state shows status chip, reasons and input counts', () => {
  const { html } = renderDashboardHtml(richSummary());
  assert.ok(html.includes('Overall: FAIL'));
  assert.ok(html.includes('chip-failure'));
  assert.ok(html.includes('failing_report'));
  assert.ok(html.includes('input_problem'));
  assert.ok(html.includes('9 files'));
  assert.ok(html.includes('6 reports'));
  assert.ok(html.includes('1 duplicate'));
});

test('PASS, WARN and NO DATA states render their status text', () => {
  assert.ok(renderDashboardHtml(passSummary()).html.includes('Overall: PASS'));
  assert.ok(renderDashboardHtml(warnSummary()).html.includes('Overall: WARN'));
  assert.ok(renderDashboardHtml(warnSummary()).html.includes('chip-warning'));
  const noData = renderDashboardHtml(noDataSummary()).html;
  assert.ok(noData.includes('Overall: NO DATA'));
  assert.ok(noData.includes('chip-info'));
  assert.ok(noData.includes('no_verdict_reports'));
});

test('product cards cover all five products and the no-reports state', () => {
  const { html } = renderDashboardHtml(richSummary());
  for (const title of ['Probe', 'Diff', 'Policy Gate', 'Mock Server', 'Contract Runner']) {
    assert.ok(html.includes(`<h3>${title}</h3>`), `missing product card: ${title}`);
  }
  assert.ok(html.includes('<p>2 reports</p>'), 'policy-gate has two reports');
  assert.ok(!html.includes('<p>No reports</p>'));

  const validationOnly = renderDashboardHtml(emptySummary()).html;
  assert.equal((validationOnly.match(/<p>No reports<\/p>/g) || []).length, 5);
});

test('failing items are listed before warnings', () => {
  const { html } = renderDashboardHtml(richSummary());
  const section = html.slice(html.indexOf('id="failing-items"'), html.indexOf('id="test-success-rate"'));
  const firstFailure = section.indexOf('[failure]');
  const firstFail = section.indexOf('[fail]');
  const firstWarn = section.indexOf('[warn]');
  assert.ok(firstFailure !== -1 && firstFail !== -1 && firstWarn !== -1);
  assert.ok(firstFailure < firstWarn, 'failure items must precede warning items');
  assert.ok(firstFail < firstWarn, 'fail findings must precede warn findings');
  assert.ok(section.indexOf('tool_removed') < section.indexOf('description_missing'));
  assert.ok(section.includes('INVALID (Input validation)'));
  const warn = renderDashboardHtml(warnSummary()).html;
  const warnSection = warn.slice(warn.indexOf('id="failing-items"'), warn.indexOf('id="test-success-rate"'));
  assert.ok(warnSection.includes('[warning] Probe r1 - WARNING (Server health)'));
});

test('test success rate section shows percent and counts', () => {
  const { html } = renderDashboardHtml(richSummary());
  assert.ok(html.includes('80% (4 passed, 1 failed)'));
  const noData = renderDashboardHtml(noDataSummary()).html;
  assert.ok(noData.includes('No test results recorded.'));
});

test('report table has id, product, status with kind, timestamp and duration', () => {
  const { html } = renderDashboardHtml(richSummary());
  assert.ok(html.includes('<table>'));
  for (const id of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) {
    assert.ok(html.includes(`<td>${id}</td>`), `missing row for ${id}`);
  }
  assert.ok(html.includes('FAIL (Policy compliance)'));
  assert.ok(html.includes('RECORDED (Mock session recording (not a test result))'));
  assert.ok(html.includes('INVALID (Input validation)'));
  assert.ok(html.includes('not available'), 'null timestamp/duration must show not available');
  assert.ok(html.includes('2100 ms'));
  assert.ok(html.includes('data-state="failure"'));
  assert.ok(html.includes('data-state="info"'));
});

test('per-report details elements carry counts, findings and not-available fields', () => {
  const { html } = renderDashboardHtml(richSummary());
  assert.equal((html.match(/<details data-state=/g) || []).length, 6);
  assert.ok(html.includes('tool_denied x2'));
  assert.ok(html.includes('Not available: timestamp, durationMs'));
  assert.ok(html.includes('byOutcome: result: 40, is_error: 2'));
  assert.ok(html.includes('Source: report-1 (a1b2c3d4e5f6)'));
});

test('problems list shows unsupported or rejected inputs', () => {
  const { html } = renderDashboardHtml(richSummary());
  const section = html.slice(html.indexOf('id="problems"'), html.indexOf('id="missing-information"'));
  assert.ok(section.includes('Unsupported or rejected inputs'));
  assert.ok(section.includes('invalid_json - report-9 - line 3 column 5'));
  const pass = renderDashboardHtml(passSummary()).html;
  assert.ok(pass.includes('ignored_input - report-6 - joons-mcp-diff/snapshot'));
  const clean = renderDashboardHtml(
    minimalSummary({
      overall: { status: 'PASS', reasons: [] },
      products: productsMap({
        probe: { reports: 1, level: 'ok', worstStatus: 'PASS', counts: { tools: 1 } },
      }),
      reports: [
        {
          id: 'r1',
          source: { label: 'report-1', sha256: 'a1b2c3d4e5f6', fileName: null },
          product: 'probe',
          reportType: 'probe_report',
          sourceFormat: '(none)',
          schemaVersion: 1,
          productVersion: '0.1.0',
          status: { kind: 'health', value: 'PASS', level: 'ok' },
          timestamp: '2026-11-12T00:00:00.000Z',
          durationMs: 10,
          counts: { tools: 1 },
          findings: [],
          notAvailable: [],
        },
      ],
      problems: [],
      totals: { files: 1, reports: 1, duplicates: 0, ignored: 0, rejected: 0 },
    })
  ).html;
  assert.ok(clean.includes('No unsupported or rejected inputs.'));
});

test('missing-information list aggregates not-available fields per report', () => {
  const { html } = renderDashboardHtml(richSummary());
  const section = html.slice(html.indexOf('id="missing-information"'), html.indexOf('</main>'));
  assert.ok(section.includes('r2: timestamp, durationMs'));
  assert.ok(section.includes('r3: durationMs'));
  assert.ok(section.includes('r4: durationMs'));
});

test('header shows generatedAt or not recorded plus the mode note', () => {
  const { html } = renderDashboardHtml(richSummary());
  assert.ok(html.includes('Generated: 2026-11-12T14:26:17.773Z'));
  assert.ok(html.includes('Mode: details on, file names hidden, duplicates: keep-first'));
  const empty = renderDashboardHtml(emptySummary()).html;
  assert.ok(empty.includes('Generated: not recorded'));
});

test('details-mode warning banner appears only when details is true', () => {
  const { html } = renderDashboardHtml(richSummary());
  assert.ok(html.includes('Details mode is on'));
  assert.ok(html.includes('role="alert"'));
  assert.ok(!renderDashboardHtml(passSummary()).html.includes('Details mode is on'));
  assert.ok(renderDashboardHtml(hostileSummary()).html.includes('Details mode is on'));
});

test('empty summary renders a helpful message', () => {
  const { html } = renderDashboardHtml(emptySummary());
  assert.ok(html.includes('No MCP reports were accepted'));
  assert.ok(html.includes('Overall: NO DATA'));
});

test('footer explains the aggregation rules without links', () => {
  const { html } = renderDashboardHtml(richSummary());
  const footer = html.slice(html.indexOf('<footer'));
  assert.ok(footer.includes('Verdicts are aggregated'));
  assert.ok(footer.includes('mock recordings'));
  assert.ok(!footer.includes('href='));
  assert.ok(!footer.includes('http'));
});
