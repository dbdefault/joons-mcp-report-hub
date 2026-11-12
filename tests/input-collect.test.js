import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectInputs, DEFAULT_MAX_FILES, MAX_TOTAL_BYTES } from '../src/input/collect.js';

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-collect-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('directory input yields direct *.json children in code-unit order', (t) => {
  const dir = makeTempDir(t);
  fs.mkdirSync(path.join(dir, 'nested'));
  fs.writeFileSync(path.join(dir, 'b.json'), '{}');
  fs.writeFileSync(path.join(dir, 'a.json'), '{}');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'not json');
  fs.writeFileSync(path.join(dir, 'nested', 'z.json'), '{}');
  const { files, problems } = collectInputs(['.'], { cwd: dir });
  assert.deepEqual(
    files.map((f) => path.basename(f.path)),
    ['a.json', 'b.json'],
  );
  assert.deepEqual(problems, []);
  // not recursive, non-JSON ignored
  assert.ok(!files.some((f) => f.path.includes('z.json')));
});

test('explicit file args and directory args mix and sort by resolved path', (t) => {
  const dir = makeTempDir(t);
  const other = makeTempDir(t);
  fs.writeFileSync(path.join(dir, 'm.json'), '{}');
  fs.writeFileSync(path.join(other, 'a.json'), '{}');
  const { files } = collectInputs(['m.json', other], { cwd: dir });
  assert.deepEqual(
    files.map((f) => path.basename(f.path)).sort(),
    ['a.json', 'm.json'],
  );
  for (let i = 1; i < files.length; i += 1) {
    assert.ok(files[i - 1].path <= files[i].path, 'sorted by code unit');
  }
  files.forEach((f, i) => assert.equal(f.index, i));
});

test('explicit non-JSON file arg is accepted (downstream layers decide)', (t) => {
  const dir = makeTempDir(t);
  fs.writeFileSync(path.join(dir, 'note.txt'), 'x');
  const { files } = collectInputs(['note.txt'], { cwd: dir });
  assert.equal(files.length, 1);
});

test('symlink inputs are skipped via lstat', (t) => {
  const dir = makeTempDir(t);
  fs.writeFileSync(path.join(dir, 'real.json'), '{}');
  let made = true;
  try {
    fs.symlinkSync(path.join(dir, 'real.json'), path.join(dir, 'link.json'));
  } catch {
    made = false; // OS without symlink privilege
  }
  const { files, problems } = collectInputs(['.'], { cwd: dir });
  if (made) {
    assert.deepEqual(files.map((f) => path.basename(f.path)), ['real.json']);
    assert.ok(problems.some((p) => p.kind === 'symlink_skipped'));
  } else {
    assert.equal(files.length, 1);
  }
  // explicit symlink arg is skipped too
  if (made) {
    const r = collectInputs(['link.json'], { cwd: dir });
    assert.equal(r.files.length, 0);
    assert.ok(r.problems.some((p) => p.kind === 'symlink_skipped'));
  }
});

test('more than 500 files is refused with a bounded list', (t) => {
  const dir = makeTempDir(t);
  for (let i = 0; i < DEFAULT_MAX_FILES + 5; i += 1) {
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, '0')}.json`), '{}');
  }
  const { files, problems } = collectInputs(['.'], { cwd: dir });
  assert.equal(files.length, DEFAULT_MAX_FILES);
  assert.ok(problems.some((p) => p.kind === 'too_many_files'));
  assert.equal(problems.filter((q) => q.kind === 'too_many_files').length, 1);
});

test('total size over 64 MiB is refused', (t) => {
  const dir = makeTempDir(t);
  const chunk = Buffer.alloc(1024 * 1024, 0x61);
  fs.writeFileSync(path.join(dir, 'a.json'), chunk);
  fs.writeFileSync(path.join(dir, 'b.json'), chunk);
  fs.writeFileSync(path.join(dir, 'c.json'), chunk); // 3 MiB total: fine
  const ok = collectInputs(['.'], { cwd: dir });
  assert.equal(ok.files.length, 3);
  assert.deepEqual(ok.problems, []);

  const big = makeTempDir(t);
  const half = Buffer.alloc(MAX_TOTAL_BYTES / 2, 0x61);
  fs.writeFileSync(path.join(big, 'a.json'), half);
  fs.writeFileSync(path.join(big, 'b.json'), half);
  fs.writeFileSync(path.join(big, 'c.json'), half); // 96 MiB: third refused
  const over = collectInputs(['.'], { cwd: big });
  assert.equal(over.files.length, 2);
  assert.ok(over.problems.some((p) => p.kind === 'total_too_large'));
});

test('missing input path is reported without naming it', (t) => {
  const dir = makeTempDir(t);
  const missing = path.join(dir, 'does-not-exist.json');
  const { files, problems } = collectInputs(['does-not-exist.json'], { cwd: dir });
  assert.equal(files.length, 0);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'file_not_found');
  assert.ok(!problems[0].detail.includes(missing));
  assert.ok(!problems[0].detail.includes('does-not-exist'));
});

test('empty and non-string args are problems, not crashes', (t) => {
  const dir = makeTempDir(t);
  const { files, problems } = collectInputs(['', 42], { cwd: dir });
  assert.equal(files.length, 0);
  assert.equal(problems.length, 2);
  assert.ok(problems.every((p) => p.kind === 'invalid_argument'));
});

test('duplicated explicit file arg appears twice (dedupe is downstream)', (t) => {
  const dir = makeTempDir(t);
  fs.writeFileSync(path.join(dir, 'a.json'), '{}');
  const { files } = collectInputs(['a.json', 'a.json'], { cwd: dir });
  assert.equal(files.length, 2);
});
