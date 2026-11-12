// E2E 1: every file in tests/fixtures/real/ is accepted by `validate`, and `summary`
// classifies each file exactly:
//   - probes            -> product probe           / reportType probe_report
//   - diff compare      -> product diff            / reportType diff_result
//   - diff snapshots    -> problem ignored_input   (never an error)
//   - policy check      -> product policy-gate     / reportType policy_check
//   - mock sessions     -> product mock-server     / reportType mock_session
//   - contract runs     -> product contract-runner / reportType contract_run
//   - validations       -> product (of its format) / reportType validation
// Duplicates (identical SHA-256 bytes) are problems of kind `duplicate`, not errors.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'joons-mcp-report-hub.js');
const REAL = path.join(ROOT, 'tests', 'fixtures', 'real');
const PRODUCT_DIRS = ['probe', 'diff', 'policy-gate', 'mock-server', 'contract-runner'];

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

// All real input files (the fixture root holds only sub-directories; a directory input
// reads its direct *.json children, so we pass the five product directories).
const realFiles = PRODUCT_DIRS.flatMap((d) =>
  fs.readdirSync(path.join(REAL, d)).filter((n) => n.endsWith('.json')).map((n) => path.join(REAL, d, n))
);

function sha12(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
}

// hash -> expected classification, derived from the folder and file name
function expectedOf(file) {
  const dir = path.basename(path.dirname(file));
  const name = path.basename(file);
  if (dir === 'probe') return { product: 'probe', reportType: 'probe_report' };
  if (dir === 'diff') {
    if (name.includes('snapshot')) return { ignored: true };
    return { product: 'diff', reportType: 'diff_result' };
  }
  if (dir === 'policy-gate') {
    return name.startsWith('check-')
      ? { product: 'policy-gate', reportType: 'policy_check' }
      : { product: 'policy-gate', reportType: 'validation' };
  }
  if (dir === 'mock-server') {
    return name.startsWith('session-')
      ? { product: 'mock-server', reportType: 'mock_session' }
      : { product: 'mock-server', reportType: 'validation' };
  }
  // contract-runner
  return name.startsWith('run-')
    ? { product: 'contract-runner', reportType: 'contract_run' }
    : { product: 'contract-runner', reportType: 'validation' };
}

const hashToExpected = new Map();
for (const f of realFiles) {
  const key = sha12(f);
  if (hashToExpected.has(key)) {
    // identical bytes: same expected classification, marked as a duplicate
    hashToExpected.get(key).count += 1;
  } else {
    hashToExpected.set(key, { ...expectedOf(f), count: 1 });
  }
}

test('validate accepts every real fixture (duplicates and ignored snapshots allowed)', () => {
  const res = run(['validate', ...PRODUCT_DIRS.map((d) => path.join(REAL, d))]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
});

test('summary classifies every real fixture exactly', () => {
  const res = run(['summary', ...PRODUCT_DIRS.map((d) => path.join(REAL, d)), '--format', 'json']);
  assert.equal(res.status, 1, 'overall must be FAIL (the set contains failing reports)');
  const s = JSON.parse(res.stdout);

  // 41 files on disk: 28 unique reports + 4 ignored snapshots + 9 duplicate problems.
  //   probe:           6 files, all unique                      -> 6 reports
  //   diff:           10 files, 4+2 identical pairs           -> 2 reports + 4 snapshots
  //   policy-gate:     7 files, 1 identical pair              -> 6 reports
  //   mock-server:    10 files, 4 identical valid reports    -> 7 reports
  //   contract-runner: 8 files, 1 identical pair              -> 7 reports
  assert.deepEqual(s.totals, { files: 41, reports: 28, duplicates: 9, ignored: 4, rejected: 0 });
  assert.equal(s.format, 'joons-mcp-report-hub/summary');
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.tool.name, 'joons-mcp-report-hub');
  assert.equal(s.tool.version, '0.1.0');

  // every report is one of the 28 accepted fixtures, with the expected classification
  assert.equal(s.reports.length, 28);
  const seenHashes = new Set();
  for (const r of s.reports) {
    const exp = hashToExpected.get(r.source.sha256);
    assert.ok(exp, `unexpected source hash ${r.source.sha256}`);
    assert.equal(r.product, exp.product, `product for ${r.source.sha256}`);
    assert.equal(r.reportType, exp.reportType, `reportType for ${r.source.sha256}`);
    assert.match(r.source.label, /^report-\d+$/);
    seenHashes.add(r.source.sha256);
  }
  assert.equal(seenHashes.size, 28);

  // per-product report counts
  const counts = Object.fromEntries(Object.entries(s.products).map(([k, v]) => [k, v.reports]));
  assert.deepEqual(counts, {
    probe: 6,
    diff: 2,
    'policy-gate': 6,
    'mock-server': 7,
    'contract-runner': 7,
  });
  for (const k of PRODUCT_DIRS) {
    assert.ok(s.products[k], `products must always list ${k}`);
    assert.notEqual(s.products[k].level, 'none');
  }

  // the four diff snapshots are ignored_input, never errors
  const ignored = s.problems.filter((p) => p.kind === 'ignored_input');
  assert.equal(ignored.length, 4);
  const snapshotHashes = new Set(
    realFiles.filter((f) => path.basename(path.dirname(f)) === 'diff' && path.basename(f).includes('snapshot')).map(sha12)
  );
  for (const p of ignored) assert.ok(snapshotHashes.has(p.source.sha256));

  // 9 duplicate problems; no other problem kinds anywhere
  assert.equal(s.problems.filter((p) => p.kind === 'duplicate').length, 9);
  const kinds = new Set(s.problems.map((p) => p.kind));
  assert.deepEqual([...kinds].sort(), ['duplicate', 'ignored_input']);
  assert.equal(s.totals.rejected, 0);

  // 28 reports + 4 ignored + 9 duplicates = 41 files: everything accounted for
  assert.equal(28 + 4 + 9, s.totals.files);
});
