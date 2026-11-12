import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readReportFile,
  parseJsonText,
  InputError,
  DEFAULT_MAX_BYTES,
} from '../src/input/read.js';

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-read-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function nest(open, close, depth) {
  let s = '';
  for (let i = 0; i < depth; i += 1) s += open;
  s += '1';
  for (let i = 0; i < depth; i += 1) s += close;
  return s;
}

// ---- parseJsonText: depth boundaries ----

test('parseJsonText accepts nesting depth 64 (arrays and objects)', () => {
  assert.deepEqual(parseJsonText(nest('[', ']', 64)), JSON.parse(nest('[', ']', 64)));
  let cur = parseJsonText(nest('{"a":', '}', 64));
  while (typeof cur === 'object' && cur !== null) cur = cur.a;
  assert.equal(cur, 1);
});

test('parseJsonText refuses depth 65 (arrays and objects)', () => {
  for (const s of [nest('[', ']', 65), nest('{"a":', '}', 65)]) {
    assert.throws(
      () => parseJsonText(s),
      (err) => err instanceof InputError && err.kind === 'depth_exceeded',
    );
  }
});

test('parseJsonText handles 100k nesting without stack overflow', () => {
  const deep = nest('[', ']', 100000);
  assert.throws(
    () => parseJsonText(deep),
    (err) => err instanceof InputError && err.kind === 'depth_exceeded',
  );
});

// ---- parseJsonText: node and string/key limits ----

test('parseJsonText enforces the 500000 node limit', () => {
  const okJson = `[${'1,'.repeat(499998)}1]`;
  assert.equal(parseJsonText(okJson).length, 499999);
  const tooBig = `[${'1,'.repeat(499999)}1]`;
  assert.throws(
    () => parseJsonText(tooBig),
    (err) => err instanceof InputError && err.kind === 'limit_exceeded',
  );
});

test('parseJsonText enforces the 100000 code-unit string limit', () => {
  assert.equal(parseJsonText(`"${'x'.repeat(100000)}"`).length, 100000);
  assert.throws(
    () => parseJsonText(`"${'x'.repeat(100001)}"`),
    (err) => err instanceof InputError && err.kind === 'limit_exceeded',
  );
});

test('parseJsonText enforces the 100000 code-unit key limit', () => {
  assert.doesNotThrow(() => parseJsonText(`{"${'k'.repeat(100000)}":1}`));
  assert.throws(
    () => parseJsonText(`{"${'k'.repeat(100001)}":1}`),
    (err) => err instanceof InputError && err.kind === 'limit_exceeded',
  );
});

test('parseJsonText accepts custom limits', () => {
  assert.throws(
    () => parseJsonText(nest('[', ']', 5), { maxDepth: 4 }),
    (err) => err.kind === 'depth_exceeded',
  );
  assert.doesNotThrow(() => parseJsonText('[[[[1]]]]', { maxDepth: 5 }));
});

// ---- parseJsonText: BOM ----

test('parseJsonText strips one BOM', () => {
  assert.deepEqual(parseJsonText('\uFEFF{"a":1}'), { a: 1 });
});

test('parseJsonText refuses a double BOM as invalid JSON at 1:1', () => {
  assert.throws(
    () => parseJsonText('\uFEFF\uFEFF{"a":1}'),
    (err) =>
      err instanceof InputError &&
      err.kind === 'invalid_json' &&
      err.message === 'line 1 column 1',
  );
});

// ---- parseJsonText: line/column ----

test('parseJsonText reports line and column with CRLF input', () => {
  assert.throws(
    () => parseJsonText('{\r\n"x": @\r\n}'),
    (err) => err.kind === 'invalid_json' && err.message === 'line 2 column 6',
  );
});

test('parseJsonText reports line/column for single-line errors', () => {
  assert.throws(
    () => parseJsonText('{"a":1,}'),
    (err) => err.kind === 'invalid_json' && err.message === 'line 1 column 8',
  );
});

test('parseJsonText reports end position for truncated JSON', () => {
  assert.throws(
    () => parseJsonText('{"a":'),
    (err) => err.kind === 'invalid_json' && err.message === 'line 1 column 6',
  );
});

test('parseJsonText error messages carry no content', () => {
  try {
    parseJsonText('{"secret-content-here": @!}');
    assert.fail('should throw');
  } catch (err) {
    assert.match(err.message, /^line \d+ column \d+$/);
    assert.ok(!err.message.includes('secret-content-here'));
  }
});

// ---- readReportFile ----

test('readReportFile reads UTF-8 and strips one BOM', (t) => {
  const dir = makeTempDir(t);
  const p = path.join(dir, 'bom.json');
  fs.writeFileSync(p, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}')]));
  const { bytes, text } = readReportFile(p);
  assert.equal(text, '{"a":1}');
  assert.equal(bytes.length, 10);
});

test('readReportFile throws file_not_found without naming the path', (t) => {
  const dir = makeTempDir(t);
  const p = path.join(dir, 'missing.json');
  assert.throws(
    () => readReportFile(p),
    (err) => {
      assert.equal(err.kind, 'file_not_found');
      assert.ok(!err.message.includes(p));
      return err instanceof InputError;
    },
  );
});

test('readReportFile refuses directories as read_failed', (t) => {
  const dir = makeTempDir(t);
  assert.throws(() => readReportFile(dir), (err) => err.kind === 'read_failed');
});

test('readReportFile rejects invalid UTF-8 as invalid_utf8', (t) => {
  const dir = makeTempDir(t);
  const p = path.join(dir, 'bad.json');
  fs.writeFileSync(p, Buffer.from([0x22, 0x80, 0x22, 0x0a]));
  assert.throws(() => readReportFile(p), (err) => err.kind === 'invalid_utf8');
});

test('readReportFile enforces the size limit by stat before reading', (t) => {
  const dir = makeTempDir(t);
  const at = path.join(dir, 'at.json');
  const over = path.join(dir, 'over.json');
  fs.writeFileSync(at, Buffer.alloc(DEFAULT_MAX_BYTES, 0x20));
  fs.writeFileSync(over, Buffer.alloc(DEFAULT_MAX_BYTES + 1, 0x20));
  const { text } = readReportFile(at);
  assert.equal(text.length, DEFAULT_MAX_BYTES);
  assert.throws(() => readReportFile(over), (err) => err.kind === 'file_too_large');
});

test('readReportFile honors a custom maxBytes boundary', (t) => {
  const dir = makeTempDir(t);
  const p = path.join(dir, 'x.json');
  fs.writeFileSync(p, '12345');
  assert.equal(readReportFile(p, { maxBytes: 5 }).text, '12345');
  assert.throws(() => readReportFile(p, { maxBytes: 4 }), (err) => err.kind === 'file_too_large');
});

test('prototype keys in JSON stay inert data', (t) => {
  const dir = makeTempDir(t);
  const p = path.join(dir, 'proto.json');
  fs.writeFileSync(p, '{"__proto__":{"polluted":1},"constructor":{"x":2},"a":3}');
  const { text } = readReportFile(p);
  const value = parseJsonText(text);
  assert.equal({}.polluted, undefined);
  assert.equal(value.a, 3);
  assert.ok(Object.prototype.hasOwnProperty.call(value, '__proto__'));
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
});
