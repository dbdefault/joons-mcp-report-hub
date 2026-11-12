// E2E 2: `build` on the full real fixture set writes the fixed output files, and
// summary.json matches hand-computed expectations. The arithmetic below was computed by
// reading the 41 fixture files in tests/fixtures/real/:
//
//   totals: files 41
//           duplicates 9  = diff high-risk group (4 identical bytes -> 3 extra)
//                           + diff no-change pair (2 -> 1)
//                           + policy-gate validate-policy-ok/valid pair (2 -> 1)
//                           + mock-server four identical valid reports (4 -> 3)
//                           + contract-runner validate-suite-ok/valid pair (2 -> 1)
//           ignored 4     = the four joons-mcp-diff/snapshot files
//           reports 28    = 41 - 9 - 4   (probe 6, diff 2, policy-gate 6, mock 7, contract 7)
//           rejected 0
//
//   probe levels:   FAIL (bad-schema: 2 fail findings), FAIL (handshake failure),
//                   WARNING (redaction), PASS, PASS, WARNING (empty tools) -> failure
//   diff levels:    risk high x1, risk none x1 -> failure (high), worstStatus "high"
//   policy levels:  FAIL x1, PASS x2, WARN x1, INVALID x1 (validation) -> failure
//   mock levels:    3 recordings (info), 3 INVALID validations, 4 VALID -> failure
//   contract levels: FAIL x2, PASS x3, VALID x2, INVALID x1 -> failure
//   overall:        FAIL, reasons ["failing_report"] (failures exist -> rule 1)
//
//   testSuccessRate: contract runs only:
//     run-failing        passed 0 failed 3
//     run-mixed-fail-skip passed 2 failed 1
//     run-outage-pass    passed 2 failed 0
//     run-outage-scenario passed 2 failed 0
//     run-shop-pass      passed 9 failed 0
//     sums: passed 15, failed 4 -> FLOOR(100*15/19) = FLOOR(78.9...) = 78
//
//   mock calls badge: totals.calls 5 + 5 + 6 = 16
//   probe findings: findingsFail 3 (bad-schema plus handshake failure), findingsWarning 2
//   diff breaking changes aggregated: 4 (the high-risk compare), 0 (no changes)
//   contract counts: total 4+5+2+2+9=22, passed 15, failed 4, skipped 1+2=3
//
//   deterministic ids: sorted by product order [probe, diff, policy-gate, mock-server,
//   contract-runner], so r1-r6 probe, r7-r8 diff, r9-r14 policy-gate, r15-r21 mock-server,
//   r22-r28 contract-runner.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'joons-mcp-report-hub.js');
const REAL = path.join(ROOT, 'tests', 'fixtures', 'real');
const PRODUCT_DIRS = ['probe', 'diff', 'policy-gate', 'mock-server', 'contract-runner'];
const FIXED_FILES = [
  'index.html',
  'summary.json',
  'summary.md',
  '.joons-report-hub-output',
  'badges/overall.svg',
  'badges/probe.svg',
  'badges/diff.svg',
  'badges/policy-gate.svg',
  'badges/mock-server.svg',
  'badges/contract-runner.svg',
];

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

test('build on the full real set: fixed files, summary values, CSP, badges', (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-build-'));
  t.after(() => { fs.rmSync(out, { recursive: true, force: true }); });

  const res = run(['build', ...PRODUCT_DIRS.map((d) => path.join(REAL, d)), '--out', out]);
  assert.equal(res.status, 1, 'overall FAIL -> exit 1');

  // fixed output names only
  for (const f of FIXED_FILES) {
    assert.ok(fs.existsSync(path.join(out, f)), `missing output ${f}`);
  }
  const written = listFiles(out).map((f) => path.relative(out, f).split(path.sep).join('/')).sort();
  assert.deepEqual(written, [...FIXED_FILES].sort());

  // summary.json: hand-computed expectations (arithmetic documented above)
  const s = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
  assert.equal(s.format, 'joons-mcp-report-hub/summary');
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.tool.name, 'joons-mcp-report-hub');
  assert.equal(s.tool.version, '0.1.0');
  assert.deepEqual(s.mode, { details: false, showFileNames: false, stable: false, duplicates: 'keep-first' });
  assert.equal(s.overall.status, 'FAIL');
  assert.deepEqual(s.overall.reasons, ['failing_report']);
  assert.deepEqual(s.totals, { files: 41, reports: 28, duplicates: 9, ignored: 4, rejected: 0 });
  assert.deepEqual(s.testSuccessRate, { passed: 15, failed: 4, percent: 78 });

  const p = s.products;
  assert.equal(p.probe.reports, 6);
  assert.equal(p.probe.level, 'failure');
  assert.equal(p.probe.worstStatus, 'FAIL');
  assert.equal(p.probe.counts.findingsFail, 3);
  assert.equal(p.probe.counts.findingsWarning, 2);
  assert.equal(p.diff.reports, 2);
  assert.equal(p.diff.level, 'failure');
  assert.equal(p.diff.worstStatus, 'high');
  assert.equal(p.diff.counts.breaking, 4);
  assert.equal(p['policy-gate'].reports, 6);
  assert.equal(p['policy-gate'].level, 'failure');
  assert.equal(p['policy-gate'].worstStatus, 'FAIL');
  assert.equal(p['policy-gate'].counts.fail, 5);
  assert.equal(p['policy-gate'].counts.warn, 1);
  assert.equal(p['mock-server'].reports, 7);
  assert.equal(p['mock-server'].level, 'failure');
  assert.equal(p['mock-server'].worstStatus, 'INVALID');
  assert.equal(p['mock-server'].counts.calls, 16);
  assert.equal(p['contract-runner'].reports, 7);
  assert.equal(p['contract-runner'].level, 'failure');
  assert.equal(p['contract-runner'].worstStatus, 'FAIL');
  assert.deepEqual(
    {
      total: p['contract-runner'].counts.total,
      passed: p['contract-runner'].counts.passed,
      failed: p['contract-runner'].counts.failed,
      skipped: p['contract-runner'].counts.skipped,
    },
    { total: 22, passed: 15, failed: 4, skipped: 3 }
  );

  // deterministic report ids: product order decides the ranges (see header comment)
  assert.equal(s.reports.length, 28);
  const byProduct = (id) => s.reports.find((r) => r.id === `r${id}`).product;
  for (let i = 1; i <= 6; i++) assert.equal(byProduct(i), 'probe');
  for (let i = 7; i <= 8; i++) assert.equal(byProduct(i), 'diff');
  for (let i = 9; i <= 14; i++) assert.equal(byProduct(i), 'policy-gate');
  for (let i = 15; i <= 21; i++) assert.equal(byProduct(i), 'mock-server');
  for (let i = 22; i <= 28; i++) assert.equal(byProduct(i), 'contract-runner');
  const ids = s.reports.map((r) => r.id);
  assert.deepEqual(ids, Array.from({ length: 28 }, (_, i) => `r${i + 1}`));

  // dashboard: CSP meta present, no external references
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(html.includes('<meta http-equiv="Content-Security-Policy"'));
  assert.ok(html.includes("default-src 'none'"));

  // badges agree with the summary
  const badge = (name) => fs.readFileSync(path.join(out, 'badges', `${name}.svg`), 'utf8');
  const overall = badge('overall');
  assert.ok(overall.includes('MCP reports'));
  assert.ok(overall.includes('FAIL'));
  assert.ok(!overall.includes('<script'));
  assert.ok(badge('probe').includes('MCP Probe') && badge('probe').includes('FAIL'));
  assert.ok(badge('diff').includes('MCP Diff') && badge('diff').includes('BREAKING'));
  assert.ok(badge('policy-gate').includes('Policy Gate') && badge('policy-gate').includes('FAIL'));
  assert.ok(badge('mock-server').includes('Mock Server') && badge('mock-server').includes('16 calls'));
  assert.ok(
    badge('contract-runner').includes('Contract Tests') && badge('contract-runner').includes('78% PASS')
  );
  for (const name of ['overall', 'probe', 'diff', 'policy-gate', 'mock-server', 'contract-runner']) {
    const svg = badge(name);
    assert.ok(!svg.includes('PASS') || name !== 'mock-server', 'mock badge is never a verdict');
  }

  // markdown mentions the overall status and the footer
  const md = fs.readFileSync(path.join(out, 'summary.md'), 'utf8');
  assert.ok(md.includes('# MCP Report Hub: FAIL'));
  assert.ok(md.includes('Generated from JSON reports only; no MCP server was contacted.'));
});
