import test from 'node:test';
import assert from 'node:assert/strict';
import {
  redactText,
  SAFE_VERSION_RE,
  isSafeVersion,
  isIsoTimestamp,
  isRealYmdDate,
} from '../src/security/redact.js';

test('Windows drive paths are replaced', () => {
  assert.equal(
    redactText('open C:\\Users\\example-user\\project\\x.js now'),
    'open [PATH] now',
  );
  assert.equal(redactText('file C:\\temp\\out.txt'), 'file [PATH]');
});

test('UNC paths are replaced', () => {
  assert.equal(redactText('\\\\fileserver\\share\\doc.txt'), '[PATH]');
});

test('POSIX absolute paths with 2+ segments are replaced', () => {
  assert.equal(redactText('cat /home/example-user/project/x.js'), 'cat [PATH]');
  assert.equal(redactText('root /a/b'), 'root [PATH]');
});

test('POSIX single segment and relative paths are left alone', () => {
  assert.equal(redactText('ls /tmp'), 'ls /tmp');
  assert.equal(redactText('run src/main.js'), 'run src/main.js');
  assert.equal(redactText('and/or'), 'and/or');
});

test('home-relative ~/ paths are replaced', () => {
  assert.equal(redactText('edit ~/project/x.js please'), 'edit [PATH] please');
});

test('URLs with scheme are replaced (http, https, file)', () => {
  assert.equal(
    redactText('go https://example.com/a?token=abc&x=1 y'),
    'go [URL] y',
  );
  assert.equal(
    redactText('open http://example-user@examplehost:8080/p?q=1'),
    'open [URL]',
  );
  assert.equal(redactText('see file://examplehost/share/d.txt'), 'see [URL]');
});

test('email addresses are replaced', () => {
  assert.equal(
    redactText('mail example-user@example.com end'),
    'mail [EMAIL] end',
  );
});

test('IPv4 addresses are replaced', () => {
  assert.equal(redactText('ping 192.168.0.1 now'), 'ping [IP] now');
  assert.equal(redactText('v 10.0.0.255'), 'v [IP]');
});

test('Bearer tokens keep the word Bearer, mask the token', () => {
  assert.equal(
    redactText('Bearer abcDEF0123456789.+/=_-xyz'),
    'Bearer [TOKEN]',
  );
  assert.equal(redactText('bearer xyz123ABC'), 'Bearer [TOKEN]');
});

test('JWTs are replaced', () => {
  const jwt =
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJleGFtcGxlIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c';
  assert.equal(redactText(`token ${jwt} done`), 'token [TOKEN] done');
});

test('sensitive name=value pairs mask every listed name', () => {
  const names = [
    'password', 'passwd', 'secret', 'token', 'apikey', 'api_key', 'api-key',
    'authorization', 'auth', 'credential', 'cookie', 'session',
    'privatekey', 'private_key',
  ];
  for (const name of names) {
    assert.equal(redactText(`${name}=s3cr3t-value`), `${name}=[MASKED]`, name);
  }
});

test('sensitive JSON-style pairs normalize and mask the value', () => {
  assert.equal(redactText('{"token":"abc123"}'), '{token=[MASKED]}');
  assert.equal(redactText('{"api_key": "xyz987"}'), '{api_key=[MASKED]}');
});

test('sensitive colon pairs normalize the separator', () => {
  assert.equal(redactText('secret: s3cr3t'), 'secret=[MASKED]');
  assert.equal(redactText('Session: abc'), 'Session=[MASKED]');
});

test('pair masking is case-insensitive and keeps suffixes', () => {
  assert.equal(redactText('TOKEN=abc'), 'TOKEN=[MASKED]');
  assert.equal(redactText('sessionId=42'), 'sessionId=[MASKED]');
  assert.equal(redactText('apiKey=x'), 'apiKey=[MASKED]');
});

test('opaque tokens of 24+ chars are redacted, short ones survive', () => {
  assert.equal(redactText('abcdef0123456789ABCDEF00'), '[REDACTED]');
  assert.equal(
    redactText('use ghp_EXAMPLE0000000000000000000000000000 here'),
    'use [REDACTED] here',
  );
  assert.equal(redactText('short abcdefghijklmnopqrs end'), 'short abcdefghijklmnopqrs end');
});

test('pair masking wins over opaque-token for name=value', () => {
  assert.equal(
    redactText('token=abcdef0123456789ABCDEF00'),
    'token=[MASKED]',
  );
});

test('Authorization+Bearer collapses through ordered passes deterministically', () => {
  const once = redactText('Authorization: Bearer abcDEF0123456789');
  assert.equal(once, 'Authorization=[MASKED] [TOKEN]');
  assert.equal(redactText(once), once, 'idempotent');
});

test('redactText is idempotent on a composite sample', () => {
  const sample =
    'mail example-user@example.com; token=abc123; see /home/example-user/x.js ' +
    'and C:\\tmp\\f.txt and https://example.invalid/a?x=1 ping 10.1.2.3 ' +
    'ghp_EXAMPLE0000000000000000000000000000';
  const once = redactText(sample);
  const twice = redactText(once);
  assert.equal(twice, once);
  assert.ok(!once.includes('example-user@'));
  assert.ok(!once.includes('abc123'));
  assert.ok(!once.includes('10.1.2.3'));
});

test('controls are stripped before redaction', () => {
  assert.equal(redactText('a\u2028b'), 'ab');
  assert.equal(redactText('\x1b[31mhttps://example.invalid\x1b[0m'), '[URL]');
  assert.equal(redactText('x\u202Ay\u202Cz'), 'xyz');
});

test('truncation appends ... beyond maxLength', () => {
  assert.equal(
    redactText('word '.repeat(30), { maxLength: 10 }),
    'word word ...',
  );
  assert.equal(redactText('word '.repeat(2), { maxLength: 10 }), 'word word ');
  const long = 'b '.repeat(600); // 1200 chars
  assert.equal(redactText(long), 'b '.repeat(100) + '...');
});

test('1 MB hostile input is redacted in under 200 ms (no ReDoS)', () => {
  const unit =
    'a@. C:\\x\\y ~/p/q \\\\s\\sh ' + 'q'.repeat(30) + ' eyJx.y.z ' +
    'ab=cd ' + '/seg/ments/here ' + '\x1b[31m' + 'z'.repeat(50) + ' ';
  const times = 1600;
  let hostile = '';
  while (hostile.length < 1024 * 1024) hostile += unit;
  const start = performance.now();
  const out = redactText(hostile);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 200, `redaction took ${elapsed} ms`);
  assert.ok(!hostile.includes('[REDACTED]')); // sanity: input differs
  assert.ok(out.length <= hostile.length);
});

test('SAFE_VERSION_RE matches product versions', () => {
  assert.ok(SAFE_VERSION_RE.test('0.1.0'));
  assert.ok(!SAFE_VERSION_RE.test('1.2.3-rc.1+build'));
  assert.ok(!SAFE_VERSION_RE.test('-1.0'));
  assert.ok(!SAFE_VERSION_RE.test('x'.repeat(65)), 'max 64 chars');
});

test('isSafeVersion validates shape only', () => {
  assert.equal(isSafeVersion('0.1.0'), true);
  assert.equal(isSafeVersion('2025-11-25'), false);
  assert.equal(isSafeVersion(''), false);
  assert.equal(isSafeVersion('../x'), false);
  assert.equal(isSafeVersion('<script>'), false);
  assert.equal(isSafeVersion(12), false);
  assert.equal(isSafeVersion(null), false);
});

test('isIsoTimestamp matches ISO-8601 shape', () => {
  assert.equal(isIsoTimestamp('2026-11-12T14:26:17.773Z'), true);
  assert.equal(isIsoTimestamp('2026-11-12T14:26:17+09:00'), true);
  assert.equal(isIsoTimestamp('2026-11-12T14:26:17Z'), true);
  assert.equal(isIsoTimestamp('2026-11-12 14:26:17'), false);
  assert.equal(isIsoTimestamp('14:26:17Z'), false);
  assert.equal(isIsoTimestamp('2026-11-12'), false);
  assert.equal(isIsoTimestamp(null), false);
});

test('isRealYmdDate validates real calendar dates', () => {
  assert.equal(isRealYmdDate('2026-11-12'), true);
  assert.equal(isRealYmdDate('2024-02-29'), true, 'leap day');
  assert.equal(isRealYmdDate('2023-02-29'), false, 'not a leap year');
  assert.equal(isRealYmdDate('2026-13-01'), false);
  assert.equal(isRealYmdDate('2026-00-10'), false);
  assert.equal(isRealYmdDate('2026-11-31'), false);
  assert.equal(isRealYmdDate('11-12-2026'), false);
  assert.equal(isRealYmdDate('2026/11/12'), false);
});
