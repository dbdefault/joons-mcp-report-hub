// E2E 3: --stable determinism.
//   - two runs over the same inputs produce byte-identical output files;
//   - shuffling the input list produces byte-identical outputs too (report order is
//     sorted by product/reportType/timestamp/sha, never by input order);
//   - generatedAt is null with --stable and not null without it.

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

function snapshotBytes(dir) {
  const map = new Map();
  for (const f of listFiles(dir)) {
    map.set(path.relative(dir, f), fs.readFileSync(f));
  }
  return map;
}

function expectSameBytes(t, a, b, label) {
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), `${label}: same file set`);
  for (const [rel, bytes] of a) {
    assert.ok(b.get(rel)?.equals(bytes), `${label}: ${rel} differs`);
  }
}

const dirInputs = PRODUCT_DIRS.map((d) => path.join(REAL, d));
// explicit file list in sorted order, for the shuffle test
const fileInputs = PRODUCT_DIRS.flatMap((d) =>
  fs.readdirSync(path.join(REAL, d))
    .filter((n) => n.endsWith('.json'))
    .map((n) => path.join(REAL, d, n))
).sort();

test('build --stable: two runs byte-identical', (t) => {
  const out1 = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-st1-'));
  const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-st2-'));
  t.after(() => {
    fs.rmSync(out1, { recursive: true, force: true });
    fs.rmSync(out2, { recursive: true, force: true });
  });

  const r1 = run(['build', ...dirInputs, '--out', out1, '--stable']);
  const r2 = run(['build', ...dirInputs, '--out', out2, '--stable']);
  assert.equal(r1.status, 1, 'overall FAIL -> exit 1');
  assert.equal(r2.status, 1);
  expectSameBytes(t, snapshotBytes(out1), snapshotBytes(out2), 'two stable runs');

  const s = JSON.parse(fs.readFileSync(path.join(out1, 'summary.json'), 'utf8'));
  assert.equal(s.generatedAt, null);
  assert.equal(s.mode.stable, true);
});

test('build --stable: shuffled input order gives byte-identical outputs', (t) => {
  const out1 = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-st3-'));
  const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-st4-'));
  t.after(() => {
    fs.rmSync(out1, { recursive: true, force: true });
    fs.rmSync(out2, { recursive: true, force: true });
  });

  const shuffled = [...fileInputs].reverse(); // a deterministic, clearly different order
  assert.notDeepEqual(shuffled, fileInputs);
  const r1 = run(['build', ...fileInputs, '--out', out1, '--stable']);
  const r2 = run(['build', ...shuffled, '--out', out2, '--stable']);
  assert.equal(r1.status, 1);
  assert.equal(r2.status, 1);
  expectSameBytes(t, snapshotBytes(out1), snapshotBytes(out2), 'shuffled inputs');
});

test('summary --stable: stdout identical across runs and input orders', (t) => {
  const base = run(['summary', ...dirInputs, '--format', 'json', '--stable']);
  const again = run(['summary', ...dirInputs, '--format', 'json', '--stable']);
  const shuffled = run(['summary', ...[...fileInputs].reverse(), '--format', 'json', '--stable']);
  assert.equal(base.status, 1);
  assert.equal(again.status, 1);
  assert.equal(shuffled.status, 1);
  assert.equal(base.stdout, again.stdout, 'two stable runs differ');
  assert.equal(base.stdout, shuffled.stdout, 'shuffled inputs differ');
  assert.equal(JSON.parse(base.stdout).generatedAt, null);

  const nonStable = run(['summary', ...dirInputs, '--format', 'json']);
  assert.equal(nonStable.status, 1);
  assert.ok(JSON.parse(nonStable.stdout).generatedAt, 'generatedAt set without --stable');
});
