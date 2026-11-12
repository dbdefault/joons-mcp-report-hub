import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlainObject,
  hasOwn,
  safePathSegment,
  stripControls,
  sha256Hex,
} from '../src/util/object.js';

test('isPlainObject accepts literals and null-prototype objects', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
  assert.equal(isPlainObject(Object.create(null)), true);
  const parsed = JSON.parse('{"__proto__":1}');
  assert.equal(isPlainObject(parsed), true);
});

test('isPlainObject rejects non-objects and foreign prototypes', () => {
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject(undefined), false);
  assert.equal(isPlainObject('x'), false);
  assert.equal(isPlainObject(42), false);
  assert.equal(isPlainObject(true), false);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject([{}]), false);
  assert.equal(isPlainObject(() => {}), false);
  class Foo {}
  assert.equal(isPlainObject(new Foo()), false);
  assert.equal(isPlainObject(new Date()), false);
  // object inheriting from a plain object is not plain itself
  assert.equal(isPlainObject(Object.create({})), false);
});

test('hasOwn sees own keys including JSON __proto__', () => {
  assert.equal(hasOwn({ a: 1 }, 'a'), true);
  assert.equal(hasOwn({ a: 1 }, 'b'), false);
  assert.equal(hasOwn({}, 'toString'), false);
  const parsed = JSON.parse('{"__proto__":7}');
  assert.equal(hasOwn(parsed, '__proto__'), true);
  assert.equal(parsed.__proto__, 7);
  assert.equal(hasOwn(Object.create(null), 'x'), false);
});

test('safePathSegment shows safe keys, hides unsafe with stable index', () => {
  assert.equal(safePathSegment('tools.count', 0), 'tools.count');
  assert.equal(safePathSegment('summary', 3), 'summary');
  assert.equal(safePathSegment('__proto__', 0), '__proto__');
  assert.equal(safePathSegment('a$b-c_d', 1), 'a$b-c_d');
  assert.equal(safePathSegment('', 2), '<unknown key #2>');
  assert.equal(safePathSegment('x'.repeat(64), 0), 'x'.repeat(64));
  assert.equal(safePathSegment('x'.repeat(65), 5), '<unknown key #5>');
  assert.equal(safePathSegment('has space', 7), '<unknown key #7>');
  assert.equal(safePathSegment('semi;colon', 1), '<unknown key #1>');
  assert.equal(safePathSegment('../../etc', 9), '<unknown key #9>');
  assert.equal(safePathSegment(12, 4), '12');
  assert.equal(safePathSegment(null, 4), '<unknown key #4>');
});

test('stripControls removes C0, DEL, C1, bidi, format separators', () => {
  const bidi = 'a\u200eb\u200fc\u202ad\u202be\u2066f\u2069g\u061ch';
  assert.equal(stripControls(bidi), 'abcdefgh');
  assert.equal(stripControls('x\u2028y\u2029z'), 'xyz');
  assert.equal(stripControls('a\u0000b\u007fc\u009fd'), 'abcd');
  assert.equal(stripControls('a\rb\fc\vd'), 'abcd');
});

test('stripControls keepNewlines keeps \n and \t only', () => {
  assert.equal(stripControls('a\nb\tc', { keepNewlines: true }), 'a\nb\tc');
  assert.equal(stripControls('a\nb\tc'), 'abc');
  assert.equal(stripControls('a\nb\tc\r', { keepNewlines: true }), 'a\nb\tc');
});

test('stripControls removes ANSI CSI sequences and keeps payload text', () => {
  assert.equal(stripControls('\x1b[31mred\x1b[0m'), 'red');
  assert.equal(stripControls('\x1b[1;42mbold\x1b[m'), 'bold');
  assert.equal(stripControls('a\x1b[2Kb'), 'ab');
});

test('stripControls removes OSC sequences', () => {
  assert.equal(stripControls('\x1b]0;window title\x07text'), 'text');
  assert.equal(stripControls('\x1b]8;;https://example.invalid/x\x1b\\link'), 'link');
});

test('stripControls drops lone ESC and two-byte Fe sequences', () => {
  assert.equal(stripControls('a\x1bMb'), 'ab'); // ESC M
  assert.equal(stripControls('a\x1bc'), 'ac');
  assert.equal(stripControls('\x1b'), '');
});

test('stripControls on unterminated OSC consumes to end without hanging', () => {
  const s = '\x1b]0;' + 'z'.repeat(100000);
  assert.equal(stripControls(s), '');
});

test('sha256Hex matches known vector', () => {
  assert.equal(
    sha256Hex(Buffer.from('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    sha256Hex(new Uint8Array([])),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});
