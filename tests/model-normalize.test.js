// Unit tests for src/model/normalize.js and the util/security stubs it relies on.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPlainObject, hasOwn, safePathSegment, sha256Hex,
} from '../src/util/object.js';
import {
  SAFE_VERSION_RE, isSafeVersion, isIsoTimestamp, redactText,
} from '../src/security/redact.js';
import {
  MalformedError, reqObject, optObject, reqArray, reqString, reqEnum,
  reqCount, optCount, optDurationMs, optTimestamp, optDate, safeVersion,
  pointer, shortHash, FindingAggregator, sortedObject, LEVEL_RANK,
} from '../src/model/normalize.js';

// ---------- util/object ----------

test('isPlainObject accepts objects and null-proto objects, rejects arrays and null', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject(Object.create(null)), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject('x'), false);
});

test('hasOwn sees own keys only, including own __proto__ keys', () => {
  const obj = JSON.parse('{"__proto__":1,"a":2}');
  assert.equal(hasOwn(obj, '__proto__'), true);
  assert.equal(hasOwn(obj, 'a'), true);
  assert.equal(hasOwn(obj, 'toString'), false);
});

test('safePathSegment keeps safe tokens and falls back to the index', () => {
  assert.equal(safePathSegment('summary', 0), 'summary');
  assert.equal(safePathSegment('tools', 3), 'tools');
  assert.equal(safePathSegment('../evil', 0), '<unknown key #0>');
  assert.equal(safePathSegment('', 2), '<unknown key #2>');
  assert.equal(safePathSegment('a/b', 1), '<unknown key #1>');
  assert.equal(safePathSegment(0, 0), '0');
});

test('sha256Hex returns a 64-char hex digest', () => {
  const h = sha256Hex(Buffer.from('abc'));
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.equal(h, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

// ---------- security/redact ----------

test('isSafeVersion follows the contract pattern', () => {
  assert.equal(SAFE_VERSION_RE.source, '^[0-9]{1,6}(\\.[0-9]{1,6}){0,3}(-[0-9A-Za-z.]{1,24})?$');
  assert.equal(isSafeVersion('0.1.0'), true);
  assert.equal(isSafeVersion('1.0.0-rc.1+build'), false);
  assert.equal(isSafeVersion('bad version'), false);
  assert.equal(isSafeVersion(''), false);
  assert.equal(isSafeVersion('a'.repeat(65)), false);
  assert.equal(isSafeVersion(3), false);
});

test('isIsoTimestamp follows the contract pattern', () => {
  assert.equal(isIsoTimestamp('2026-11-12T14:26:17.773Z'), true);
  assert.equal(isIsoTimestamp('2026-11-12T14:26:17+09:00'), true);
  assert.equal(isIsoTimestamp('2026-11-12 14:26:17'), false);
  assert.equal(isIsoTimestamp('2027-01-01'), false);
  assert.equal(isIsoTimestamp(123), false);
});

test('redactText masks URLs, paths, e-mail, IPs, secrets and opaque tokens', () => {
  const input = 'open https://internal.example/x?q=1 at C:\\Users\\example-user\\x.js or /home/example-user/project/x.js and ~/project/x.js, mail a.b+c@example.com from 10.0.0.1, token=ghp_EXAMPLE0123456789abcdefghijklmn, Authorization: Bearer abcdef1234567890, plus dGhpcyBpcyBhIGxvbmcgdG9rZW4gdGVzdA==';
  const out = redactText(input, { maxLength: 1000 });
  assert.equal(out.includes('https://'), false);
  assert.equal(out.includes('example-user'), false);
  assert.equal(out.includes('/home/example-user'), false);
  assert.equal(out.includes('~/project'), false);
  assert.equal(out.includes('a.b+c@example.com'), false);
  assert.equal(out.includes('10.0.0.1'), false);
  assert.equal(out.includes('ghp_EXAMPLE'), false);
  assert.equal(out.includes('[URL]'), true);
  assert.equal(out.includes('[PATH]'), true);
  assert.equal(out.includes('[EMAIL]'), true);
  assert.equal(out.includes('[IP]'), true);
  assert.equal(out.includes('token=[MASKED]'), true);
  assert.equal(out.includes('Bearer'), false);
  assert.equal(out.includes('[REDACTED]'), true);
});

test('redactText strips control, bidi and format characters', () => {
  const input = 'a\u0000b\u007fc\u200Ed\u202Ae\u2066f\u001bg';
  const out = redactText(input);
  assert.equal(out.includes('\u0000'), false);
  assert.equal(out.includes('\u007f'), false);
  assert.equal(out.includes('\u200e'), false);
  assert.equal(out.includes('\u202a'), false);
  assert.equal(out.includes('\u2066'), false);
  assert.equal(out.includes('\u001b'), false);
  assert.equal(out, 'abcdefg');
});

test('redactText truncates to maxLength with ellipsis and defaults to 200', () => {
  assert.equal(redactText('y '.repeat(250)).length, 203);
  assert.equal(redactText('y '.repeat(250)).endsWith('...'), true);
  assert.equal(redactText('short'), 'short');
  assert.equal(redactText(null), null);
  assert.equal(redactText(42), null);
});

test('redactText masks sensitive name=value pairs case-insensitively', () => {
  assert.equal(redactText('api_key=secret123'), 'api_key=[MASKED]');
  assert.equal(redactText('SESSION: abcdef'), 'SESSION=[MASKED]');
  assert.equal(redactText('"token":"abcdef"'), 'token=[MASKED]');
});

// ---------- normalize helpers ----------

test('reqObject/optObject/reqArray/reqString throw MalformedError with the pointer', () => {
  for (const fn of [reqObject, reqArray]) {
    assert.throws(() => fn('x', '/p'), (e) => e instanceof MalformedError && e.pointer === '/p');
  }
  assert.throws(() => optObject('x', '/q'), (e) => e.pointer === '/q');
  assert.equal(optObject(null, '/q'), null);
  assert.equal(optObject(undefined, '/q'), null);
  assert.throws(() => reqString(1, '/r'), (e) => e.pointer === '/r');
});

test('reqCount and optCount enforce integers in 0..1e9', () => {
  assert.equal(reqCount(0, '/c'), 0);
  assert.equal(reqCount(1e9, '/c'), 1e9);
  for (const bad of [-1, 1.5, 1e9 + 1, NaN, '3', null]) {
    assert.throws(() => reqCount(bad, '/c'), (e) => e instanceof MalformedError);
  }
  assert.equal(optCount(-1), null);
  assert.equal(optCount(7), 7);
  assert.equal(optCount('x'), null);
});

test('optDurationMs accepts finite numbers >= 0, rejects the rest', () => {
  assert.equal(optDurationMs(0), 0);
  assert.equal(optDurationMs(1030), 1030);
  assert.equal(optDurationMs(-1), null);
  assert.equal(optDurationMs(Infinity), null);
  assert.equal(optDurationMs('fast'), null);
});

test('reqEnum maps unknown string tokens to unknown and rejects non-strings', () => {
  const known = new Set(['PASS', 'FAIL']);
  assert.equal(reqEnum('PASS', known, '/e'), 'PASS');
  assert.equal(reqEnum('MAYBE', known, '/e'), 'unknown');
  assert.throws(() => reqEnum(3, known, '/e'), (e) => e.pointer === '/e');
});

test('optTimestamp: wrong type throws, bad pattern becomes null', () => {
  assert.equal(optTimestamp('2026-11-12T14:26:17.773Z'), '2026-11-12T14:26:17.773Z');
  assert.equal(optTimestamp('garbage'), null);
  assert.equal(optTimestamp(null), null);
  assert.throws(() => optTimestamp(123, '/t'), (e) => e.pointer === '/t');
});

test('optDate validates real calendar dates in YYYY-MM-DD form', () => {
  assert.equal(optDate('2027-01-01'), '2027-01-01');
  assert.equal(optDate('2027-02-30'), null);
  assert.equal(optDate('2027-13-01'), null);
  assert.equal(optDate('not a date'), null);
  assert.throws(() => optDate(20270101, '/d'), (e) => e.pointer === '/d');
});

test('safeVersion keeps safe versions and nulls the rest', () => {
  assert.equal(safeVersion('0.1.0'), '0.1.0');
  assert.equal(safeVersion('bad version'), null);
  assert.equal(safeVersion(null), null);
});

test('pointer builds safe JSON pointer paths', () => {
  assert.equal(pointer(['summary']), '/summary');
  assert.equal(pointer(['tools', 0, 'changes', 2, 'severity']), '/tools/0/changes/2/severity');
  assert.equal(pointer(['totals', 'byOutcome', 'weird key']), '/totals/byOutcome/<unknown key #2>');
});

test('shortHash keeps the first 12 hex chars', () => {
  assert.equal(shortHash('a'.repeat(64)), 'a'.repeat(12));
  assert.equal(shortHash('xyz'), 'xyz');
});

test('FindingAggregator aggregates by severity+code, sorts deterministically', () => {
  const agg = new FindingAggregator(false);
  agg.add('warn', 'B', null);
  agg.add('fail', 'Z', null);
  agg.add('warn', 'B', null);
  agg.add('fail', 'A', null);
  assert.deepEqual(agg.toArray(), [
    { severity: 'fail', code: 'A', count: 1 },
    { severity: 'fail', code: 'Z', count: 1 },
    { severity: 'warn', code: 'B', count: 2 },
  ]);
});

test('FindingAggregator includes details only when constructed with details mode', () => {
  const withDetails = new FindingAggregator(true);
  withDetails.add('fail', 'A', { subject: 's', message: 'm' });
  assert.deepEqual(withDetails.toArray(), [
    { severity: 'fail', code: 'A', count: 1, details: [{ subject: 's', message: 'm' }] },
  ]);
  const without = new FindingAggregator(false);
  without.add('fail', 'A', { subject: 's', message: 'm' });
  assert.deepEqual(without.toArray(), [{ severity: 'fail', code: 'A', count: 1 }]);
});

test('sortedObject sorts keys and keeps hostile keys as own properties', () => {
  const obj = sortedObject([['b', 1], ['a', 2], ['__proto__', 3]]);
  assert.deepEqual(Object.keys(obj), ['__proto__', 'a', 'b']);
  assert.equal(({}).polluted, undefined);
  assert.equal(obj.a, 2);
});

test('LEVEL_RANK orders none < info < ok < warning < failure', () => {
  assert.ok(LEVEL_RANK.none < LEVEL_RANK.info);
  assert.ok(LEVEL_RANK.info < LEVEL_RANK.ok);
  assert.ok(LEVEL_RANK.ok < LEVEL_RANK.warning);
  assert.ok(LEVEL_RANK.warning < LEVEL_RANK.failure);
});
