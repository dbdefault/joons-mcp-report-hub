// Tests for src/args.js: every usage error case, option forms, defaults.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, sanitizeOptionName } from '../src/args.js';

test('missing command is a usage error naming the fix', () => {
  const r = parseArgs([]);
  assert.equal(r.ok, false);
  assert.match(r.message, /missing command/);
  assert.match(r.message, /fix:/);
});

test('unknown command is a usage error with sanitized command echo', () => {
  const r = parseArgs(['frobnicate', 'input.json']);
  assert.equal(r.ok, false);
  assert.match(r.message, /unknown command 'frobnicate'/);
  assert.match(r.message, /fix:/);
  const r2 = parseArgs(['../evil', 'input.json']);
  assert.equal(r2.ok, false);
  assert.doesNotMatch(r2.message, /\.\./);
});

test('unknown option is a usage error naming the option and the fix', () => {
  const r = parseArgs(['summary', 'input.json', '--bogus']);
  assert.equal(r.ok, false);
  assert.match(r.message, /unknown option '--bogus'/);
  assert.match(r.message, /fix:/);
});

test('unknown single-dash option is a usage error', () => {
  const r = parseArgs(['summary', 'input.json', '-x']);
  assert.equal(r.ok, false);
  assert.match(r.message, /unknown option '-x'/);
});

test('option echo is sanitized and truncated to 64 characters', () => {
  const raw = `${'a'.repeat(10)}/.${'b'.repeat(60)}`;
  const r = parseArgs(['summary', 'input.json', `--${raw}`]);
  assert.equal(r.ok, false);
  const expected = sanitizeOptionName(raw);
  assert.ok(expected.length <= 64);
  assert.match(r.message, new RegExp(`'--${expected}'`));
  assert.doesNotMatch(r.message, /\//);
  assert.doesNotMatch(r.message, /\./);
});

test('option valid for another command but not this one is unknown here', () => {
  for (const argv of [
    ['summary', 'input.json', '--force'],
    ['summary', 'input.json', '--quiet'],
    ['badge', 'input.json', '--details', '--out', 'd'],
    ['badge', 'input.json', '--quiet', '--out', 'd'],
    ['validate', 'input.json', '--strict'],
    ['validate', 'input.json', '--fail-on', 'none'],
    ['build', 'input.json', '--format', 'json', '--out', 'd'],
  ]) {
    const r = parseArgs(argv);
    assert.equal(r.ok, false, argv.join(' '));
    assert.match(r.message, /unknown option/);
  }
});

test('duplicate single-value option is a usage error', () => {
  const r = parseArgs(['build', 'a.json', '--out', 'd1', '--out', 'd2']);
  assert.equal(r.ok, false);
  assert.match(r.message, /'--out'.*more than once/);
  assert.match(r.message, /fix:/);
  const r2 = parseArgs(['summary', 'a.json', '--fail-on', 'failure', '--fail-on', 'none']);
  assert.equal(r2.ok, false);
  assert.match(r2.message, /'--fail-on'.*more than once/);
});

test('repeating a boolean flag is accepted', () => {
  const r = parseArgs(['summary', 'a.json', '--strict', '--strict']);
  assert.equal(r.ok, true);
  assert.equal(r.options.strict, true);
});

test('missing input is a usage error', () => {
  const r = parseArgs(['summary']);
  assert.equal(r.ok, false);
  assert.match(r.message, /no input file/);
  assert.match(r.message, /fix:/);
  const r2 = parseArgs(['build', '--out', 'dir']);
  assert.equal(r2.ok, false);
  assert.match(r2.message, /no input file/);
});

test('missing --out for build and badge is a usage error', () => {
  for (const command of ['build', 'badge']) {
    const r = parseArgs([command, 'input.json']);
    assert.equal(r.ok, false, command);
    assert.match(r.message, /'--out'/);
    assert.match(r.message, /fix:/);
  }
});

test('bad enum value is a usage error listing allowed values', () => {
  const r = parseArgs(['summary', 'a.json', '--fail-on', 'banana']);
  assert.equal(r.ok, false);
  assert.match(r.message, /invalid value for option '--fail-on'/);
  assert.match(r.message, /failure, warning, none/);
  const r2 = parseArgs(['validate', 'a.json', '--format', 'markdown']);
  assert.equal(r2.ok, false);
  const r3 = parseArgs(['summary', 'a.json', '--duplicates', 'first']);
  assert.equal(r3.ok, false);
});

test('value option without a value is a usage error', () => {
  const r = parseArgs(['build', 'a.json', '--out']);
  assert.equal(r.ok, false);
  assert.match(r.message, /'--out' needs a value/);
  const r2 = parseArgs(['build', 'a.json', '--out', '--strict']);
  assert.equal(r2.ok, false);
  assert.match(r2.message, /'--out' needs a value/);
  const r3 = parseArgs(['build', 'a.json', '--out=']);
  assert.equal(r3.ok, false);
});

test('boolean option with a value is a usage error', () => {
  const r = parseArgs(['summary', 'a.json', '--stable=yes']);
  assert.equal(r.ok, false);
  assert.match(r.message, /'--stable' takes no value/);
});

test('--opt=v and --opt v forms are equivalent', () => {
  const a = parseArgs(['build', 'in.json', '--out', 'dir1']);
  const b = parseArgs(['build', 'in.json', '--out=dir1']);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.options.out, 'dir1');
  assert.equal(b.options.out, 'dir1');
  const c = parseArgs(['summary', 'in.json', '--fail-on=warning']);
  assert.equal(c.options.failOn, 'warning');
});

test('-- terminator makes later dash-prefixed tokens inputs', () => {
  const r = parseArgs(['summary', '--', '--weird', '-x']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.inputs, ['--weird', '-x']);
});

test('defaults: duplicates keep-first, fail-on failure, format per command', () => {
  const s = parseArgs(['summary', 'in.json']);
  assert.equal(s.options.duplicates, 'keep-first');
  assert.equal(s.options.failOn, 'failure');
  assert.equal(s.options.format, 'terminal');
  assert.equal(s.options.details, false);
  assert.equal(s.options.showFileNames, false);
  const v = parseArgs(['validate', 'in.json']);
  assert.equal(v.options.format, 'terminal');
  const b = parseArgs(['build', 'in.json', '--out', 'd']);
  assert.equal(b.options.format, null);
});
