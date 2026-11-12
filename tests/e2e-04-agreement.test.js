// E2E 4: JSON / Markdown / terminal summaries of the same inputs agree on the overall
// status and the numbers (JSON is the reference).

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

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function makeDir(t, entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-agree-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  for (const [name, src] of entries) {
    fs.copyFileSync(path.join(REAL, src), path.join(dir, name));
  }
  return dir;
}

function summaries(dir) {
  const json = run(['summary', dir, '--format', 'json']);
  const markdown = run(['summary', dir, '--format', 'markdown']);
  const terminal = run(['summary', dir]);
  assert.equal(markdown.status, json.status, 'markdown/json exit codes differ');
  assert.equal(terminal.status, json.status, 'terminal/json exit codes differ');
  return { json, markdown, terminal, s: JSON.parse(json.stdout) };
}

test('passing set: all three formats agree (overall PASS, 3 reports, 100%)', (t) => {
  const dir = makeDir(t, [
    ['a-probe.json', 'probe/probe-pass-stdio.json'],
    ['b-policy.json', 'policy-gate/check-pass.json'],
    ['c-contract.json', 'contract-runner/run-outage-pass.json'],
  ]);
  const { s, markdown, terminal } = summaries(dir);

  assert.equal(s.overall.status, 'PASS');
  assert.deepEqual(s.totals, { files: 3, reports: 3, duplicates: 0, ignored: 0, rejected: 0 });
  assert.deepEqual(s.testSuccessRate, { passed: 2, failed: 0, percent: 100 });

  const md = markdown.stdout;
  const term = terminal.stdout;
  assert.ok(md.includes('# MCP Report Hub: PASS'), 'markdown overall line');
  assert.ok(term.includes('PASS'), 'terminal overall line');
  for (const product of ['probe', 'policy-gate', 'contract-runner']) {
    assert.ok(md.includes(product.replace(/-/g, '\\-')), `markdown missing ${product}`);
    assert.ok(term.includes(product), `terminal missing ${product}`);
  }
  // counts: 3 files / 3 reports and the 100% success rate appear everywhere
  assert.ok(md.includes('3'), 'markdown missing totals');
  assert.ok(term.includes('3'), 'terminal missing totals');
  assert.ok(md.includes('100'), 'markdown missing success rate');
  assert.ok(term.includes('100'), 'terminal missing success rate');
  assert.ok(md.includes('Generated from JSON reports only; no MCP server was contacted.'));

  // markdown renders the status kind labels next to values (six kinds never conflated)
  assert.ok(md.includes('Server health'), 'markdown missing kind label');
  assert.ok(md.includes('Policy compliance'), 'markdown missing kind label');
  assert.ok(md.includes('Test results'), 'markdown missing kind label');
});

test('failing set: all three formats agree on FAIL, findings and counts', (t) => {
  const dir = makeDir(t, [['run.json', 'contract-runner/run-failing.json']]);
  const { s, markdown, terminal } = summaries(dir);

  assert.equal(s.overall.status, 'FAIL');
  assert.deepEqual(s.totals, { files: 1, reports: 1, duplicates: 0, ignored: 0, rejected: 0 });
  assert.equal(s.products['contract-runner'].counts.failed, 3);
  assert.equal(s.products['contract-runner'].counts.passed, 0);
  assert.equal(s.products['contract-runner'].counts.skipped, 1);
  assert.equal(s.testSuccessRate.percent, 0, '0 passed / 3 failed -> 0, never rounded up');

  // failing assertion roots of run-failing.json: text.equals, fields/price.type -> fields, tool
  const codes = s.reports[0].findings.map((f) => f.code);
  assert.ok(codes.includes('text.equals'));
  assert.ok(codes.includes('fields'));
  assert.ok(codes.includes('tool'));
  for (const code of codes) {
    assert.ok(markdown.stdout.includes(code), `markdown missing finding ${code}`);
    assert.ok(terminal.stdout.includes(code), `terminal missing finding ${code}`);
  }
  assert.ok(markdown.stdout.includes('# MCP Report Hub: FAIL'));
  assert.ok(terminal.stdout.includes('FAIL'));
  assert.ok(markdown.stdout.includes('Test results'));
});

test('summary --out FILE writes the chosen format and refuses to overwrite an input', (t) => {
  const dir = makeDir(t, [['ok.json', 'probe/probe-pass-stdio.json']]);
  const outFile = path.join(dir, 'report.md');
  const ok = run(['summary', dir, '--format', 'markdown', '--out', outFile]);
  assert.equal(ok.status, 0);
  assert.ok(fs.readFileSync(outFile, 'utf8').includes('# MCP Report Hub: PASS'));

  const refuse = run(['summary', dir, '--format', 'markdown', '--out', path.join(dir, 'ok.json')]);
  assert.notEqual(refuse.status, 0, 'writing onto an input file must be refused');
});
