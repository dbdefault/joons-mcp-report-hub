// E2E 9: output-directory protection (exit 4).
//   - an existing FILE as --out is refused;
//   - a non-empty foreign directory (no marker) is refused, unless --force; even then the
//     foreign file must survive (nothing is ever deleted);
//   - a directory already marked with .joons-report-hub-output is reused;
//   - an input file living inside the output directory is refused;
//   - a symlinked output path is refused (skipped on platforms that forbid link creation).

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

function passingDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-od-in-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  fs.copyFileSync(path.join(REAL, 'probe/probe-pass-stdio.json'), path.join(dir, 'ok.json'));
  return dir;
}

test('output target that is an existing file -> exit 4', (t) => {
  const inDir = passingDir(t);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-od-')), 'a-file');
  t.after(() => { fs.rmSync(path.dirname(out), { recursive: true, force: true }); });
  fs.writeFileSync(out, 'precious');
  const res = run(['build', inDir, '--out', out]);
  assert.equal(res.status, 4);
  assert.equal(fs.readFileSync(out, 'utf8'), 'precious', 'must not touch the file');
});

test('non-empty foreign directory refused; --force works and never deletes', (t) => {
  const inDir = passingDir(t);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-od-foreign-'));
  t.after(() => { fs.rmSync(out, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(out, 'keep.txt'), 'precious');

  const refused = run(['build', inDir, '--out', out]);
  assert.equal(refused.status, 4);
  assert.equal(fs.readFileSync(path.join(out, 'keep.txt'), 'utf8'), 'precious');

  const forced = run(['build', inDir, '--out', out, '--force']);
  assert.equal(forced.status, 0, `expected 0, got ${forced.status}: ${forced.stderr}`);
  assert.equal(fs.readFileSync(path.join(out, 'keep.txt'), 'utf8'), 'precious', '--force must never delete');
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
  assert.ok(fs.existsSync(path.join(out, '.joons-report-hub-output')), 'marker written');
});

test('a marked directory is reused without --force', (t) => {
  const inDir = passingDir(t);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-od-marker-'));
  t.after(() => { fs.rmSync(out, { recursive: true, force: true }); });

  const first = run(['build', inDir, '--out', out]);
  assert.equal(first.status, 0);
  const marker = path.join(out, '.joons-report-hub-output');
  const before = fs.statSync(marker).mtimeMs;

  const second = run(['build', inDir, '--out', out]);
  assert.equal(second.status, 0, `expected 0, got ${second.status}: ${second.stderr}`);
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
  assert.ok(fs.statSync(marker).mtimeMs >= before);
});

test('an input file inside the output directory -> exit 4', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-od-nested-'));
  t.after(() => { fs.rmSync(base, { recursive: true, force: true }); });
  const out = path.join(base, 'out');
  fs.mkdirSync(out);
  fs.copyFileSync(path.join(REAL, 'probe/probe-pass-stdio.json'), path.join(out, 'input.json'));
  const res = run(['build', out, '--out', out]);
  assert.equal(res.status, 4);
  assert.ok(fs.existsSync(path.join(out, 'input.json')), 'input must survive');
  assert.ok(!fs.existsSync(path.join(out, 'index.html')), 'no outputs written');
});

test('a symlinked output path is refused (exit 4)', (t) => {
  const inDir = passingDir(t);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-od-link-'));
  t.after(() => { fs.rmSync(base, { recursive: true, force: true }); });
  const target = path.join(base, 'target');
  fs.mkdirSync(target);
  const link = path.join(base, 'link');
  try {
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    t.skip('symlink creation not permitted on this platform');
    return;
  }
  const res = run(['build', inDir, '--out', link]);
  assert.equal(res.status, 4);
});
