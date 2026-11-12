import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  prepareOutputDir,
  writeFileAtomic,
  OutputError,
  MARKER_NAME,
  isFixedFileName,
} from '../src/output/safe-dir.js';

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-out-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('prepareOutputDir creates a missing directory and writes the marker', (t) => {
  const base = makeTempDir(t);
  const out = path.join(base, 'deep', 'out');
  const resolved = prepareOutputDir(out, { inputPaths: [] });
  assert.equal(resolved, path.resolve(out));
  assert.ok(fs.statSync(out).isDirectory());
  assert.ok(fs.existsSync(path.join(out, MARKER_NAME)));
});

test('a file target is refused', (t) => {
  const base = makeTempDir(t);
  const file = path.join(base, 'file.txt');
  fs.writeFileSync(file, 'x');
  assert.throws(
    () => prepareOutputDir(file, {}),
    (err) => err instanceof OutputError && err.reason === 'file_target' && err.exitCode === 4,
  );
});

test('a non-empty foreign directory is refused without force', (t) => {
  const base = makeTempDir(t);
  const out = path.join(base, 'out');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'foreign.txt'), 'keep me');
  assert.throws(
    () => prepareOutputDir(out, {}),
    (err) => err instanceof OutputError && err.reason === 'foreign_directory',
  );
  // refused means untouched
  assert.ok(fs.existsSync(path.join(out, 'foreign.txt')));
  assert.ok(!fs.existsSync(path.join(out, MARKER_NAME)));
});

test('a foreign directory with our marker is accepted', (t) => {
  const base = makeTempDir(t);
  const out = path.join(base, 'out');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'old-summary.json'), '{}');
  fs.writeFileSync(path.join(out, MARKER_NAME), 'joons-mcp-report-hub output directory\n');
  assert.doesNotThrow(() => prepareOutputDir(out, {}));
});

test('--force accepts a foreign directory and never deletes anything', (t) => {
  const base = makeTempDir(t);
  const out = path.join(base, 'out');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'precious.txt'), 'keep');
  assert.doesNotThrow(() => prepareOutputDir(out, { force: true }));
  assert.ok(fs.existsSync(path.join(out, 'precious.txt')));
  assert.ok(fs.existsSync(path.join(out, MARKER_NAME)));
});

test('an empty existing directory is accepted and marked', (t) => {
  const base = makeTempDir(t);
  const out = path.join(base, 'out');
  fs.mkdirSync(out);
  assert.doesNotThrow(() => prepareOutputDir(out, {}));
  assert.ok(fs.existsSync(path.join(out, MARKER_NAME)));
});

test('an input file inside the output directory is refused', (t) => {
  const base = makeTempDir(t);
  const out = path.join(base, 'out');
  fs.mkdirSync(out);
  const input = path.join(out, 'report.json');
  fs.writeFileSync(input, '{}');
  assert.throws(
    () => prepareOutputDir(out, { inputPaths: [input] }),
    (err) => err instanceof OutputError && err.reason === 'output_overlaps_input',
  );
});

test('output directory equal to an input directory is refused', (t) => {
  const base = makeTempDir(t);
  const inputDir = path.join(base, 'inputs');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'a.json');
  fs.writeFileSync(input, '{}');
  assert.throws(
    () => prepareOutputDir(inputDir, { inputPaths: [input] }),
    (err) => err instanceof OutputError && err.reason === 'output_overlaps_input',
  );
});

test('output directory nested inside an input directory is allowed', (t) => {
  const base = makeTempDir(t);
  const inputDir = path.join(base, 'inputs');
  fs.mkdirSync(inputDir);
  const input = path.join(inputDir, 'a.json');
  fs.writeFileSync(input, '{}');
  const out = path.join(inputDir, 'report-out');
  assert.doesNotThrow(() => prepareOutputDir(out, { inputPaths: [input] }));
});

test('a symlinked path component is refused where the OS allows symlinks', (t) => {
  const base = makeTempDir(t);
  const real = path.join(base, 'real');
  fs.mkdirSync(real);
  const link = path.join(base, 'link');
  try {
    fs.symlinkSync(real, link, 'dir');
  } catch {
    return; // platform without symlink privilege: nothing to assert
  }
  assert.throws(
    () => prepareOutputDir(path.join(link, 'out'), {}),
    (err) => err instanceof OutputError && err.reason === 'symlink_component',
  );
  // a symlink used directly as the output path is refused too
  const link2 = path.join(base, 'link2');
  try {
    fs.symlinkSync(real, link2, 'dir');
  } catch {
    return;
  }
  assert.throws(
    () => prepareOutputDir(link2, {}),
    (err) => err instanceof OutputError && err.reason === 'symlink_component',
  );
});

test('only fixed file names are writable', () => {
  for (const ok of [
    'index.html', 'summary.json', 'summary.md', MARKER_NAME,
    'badges/overall.svg', 'badges/probe.svg', 'badges/policy-gate.svg',
  ]) {
    assert.ok(isFixedFileName(ok), ok);
  }
  for (const bad of [
    '../escape.html', '..\\escape.html', 'x.txt', 'evil.svg',
    'badges/hacker.svg', 'badges/overall.png', 'badges/../summary.json',
    'Index.html', '/tmp/x', 'badges/overall.svg/extra', 'summary.json ',
    'badges/.svg',
  ]) {
    assert.ok(!isFixedFileName(bad), bad);
  }
});

test('writeFileAtomic writes content and returns the target path', (t) => {
  const base = makeTempDir(t);
  const out = prepareOutputDir(path.join(base, 'out'), {});
  const target = writeFileAtomic(out, 'summary.json', '{"a":1}');
  assert.equal(fs.readFileSync(target, 'utf8'), '{"a":1}');
});

test('writeFileAtomic creates the badges directory on demand', (t) => {
  const base = makeTempDir(t);
  const out = prepareOutputDir(path.join(base, 'out'), {});
  const target = writeFileAtomic(out, 'badges/overall.svg', '<svg/>');
  assert.equal(fs.readFileSync(target, 'utf8'), '<svg/>');
});

test('writeFileAtomic refuses non-fixed names without touching disk', (t) => {
  const base = makeTempDir(t);
  const out = prepareOutputDir(path.join(base, 'out'), {});
  assert.throws(
    () => writeFileAtomic(out, '../escape.txt', 'x'),
    (err) => err instanceof OutputError && err.reason === 'invalid_name',
  );
  assert.ok(!fs.existsSync(path.join(base, 'escape.txt')));
});

test('a failed atomic write removes its temp file and nothing else', (t) => {
  const base = makeTempDir(t);
  const out = prepareOutputDir(path.join(base, 'out'), {});
  // make the target name occupied by a directory so rename must fail
  fs.mkdirSync(path.join(out, 'index.html'));
  assert.throws(
    () => writeFileAtomic(out, 'index.html', 'content'),
    (err) => err instanceof OutputError && err.reason === 'write_failed',
  );
  const leftovers = fs.readdirSync(out).filter(
    (n) => n.startsWith('.index.html.') && n.endsWith('.tmp'),
  );
  assert.deepEqual(leftovers, []);
  assert.ok(fs.statSync(path.join(out, 'index.html')).isDirectory());
});

test('writeFileAtomic fails cleanly for a missing directory', (t) => {
  const base = makeTempDir(t);
  assert.throws(
    () => writeFileAtomic(path.join(base, 'nope'), 'summary.json', '{}'),
    (err) => err instanceof OutputError && err.reason === 'write_failed',
  );
});

test('error messages never contain paths', (t) => {
  const base = makeTempDir(t);
  const file = path.join(base, 'secret-name.txt');
  fs.writeFileSync(file, 'x');
  try {
    prepareOutputDir(file, {});
    assert.fail('should throw');
  } catch (err) {
    assert.ok(!err.message.includes(base));
    assert.ok(!err.message.includes('secret-name'));
  }
});
