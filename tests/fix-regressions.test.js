import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareOutputDir, MARKER_NAME } from '../src/output/safe-dir.js';
import { redactText } from '../src/security/redact.js';

const cli = path.resolve('bin/joons-mcp-report-hub.js');
const base = JSON.parse(fs.readFileSync('examples/reports/probe-fail.json', 'utf8'));
function temp(fn) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-fix-')); try { fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); } }
function run(...args) { return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' }); }

test('RA-01 case-insensitive existing output overlap', { skip: !['win32', 'darwin'].includes(process.platform) }, () => temp(d => {
  const file = path.join(d, 'sample.json'); fs.writeFileSync(file, '{}');
  assert.throws(() => prepareOutputDir(d.toUpperCase(), { inputPaths: [file], force: true }), { reason: 'output_overlaps_input' });
}));
test('RA-02 marker must be regular file', () => temp(d => {
  fs.mkdirSync(path.join(d, MARKER_NAME));
  assert.throws(() => prepareOutputDir(d), { reason: 'foreign_directory' });
}));
test('RR-001 shipped documentation excludes private development path', () => {
  const privatePath = ['C:', 'AI' + '_work', 'oss', 'hub_env'].join('/');
  assert.equal(fs.readFileSync('docs/SCHEMAS.md', 'utf8').includes(privatePath), false);
});
test('RR-002 RR-004 invalid version is omitted from default output', () => temp(d => {
  const p = path.join(d, 'input.json');
  for (const v of ['sk-FAKE000', 'alice', 'private.host.example', 'MYENVVALUE']) {
    const report = structuredClone(base); report.tool.version = v; fs.writeFileSync(p, JSON.stringify(report));
    const r = run('summary', p, '--format', 'json', '--fail-on', 'none');
    assert.equal(r.status, 0); const parsed = JSON.parse(r.stdout);
    assert.equal(Object.hasOwn(parsed.reports[0], 'productVersion'), false);
    assert.equal(r.stdout.includes(v), false);
  }
}));
test('RR-003 short credential prefixes are redacted', () => {
  for (const s of ['sk-FAKE000', 'ghp_ABCDEF', 'gho_ABCDEF', 'github_pat_ABCDEF', 'AKIAABCDEF', 'xoxb-ABCDEF', 'xoxa-ABCDEF', 'xoxp-ABCDEF', 'glpat-ABCDEF', 'Bearer ABCDEF']) assert.equal(redactText(s).includes(s), false, s);
});
test('RR-005 strict rejects depth and file-size failures with accepted input', () => temp(d => {
  const good = path.join(d, 'good.json'); const bad = path.join(d, 'bad.json'); fs.writeFileSync(good, JSON.stringify(base));
  for (const payload of ['['.repeat(100) + ']'.repeat(100), JSON.stringify('x'.repeat(8 * 1024 * 1024))]) {
    fs.writeFileSync(bad, payload); const r = run('summary', good, bad, '--strict', '--fail-on', 'none', '--format', 'json'); assert.equal(r.status, 2);
  }
}));
test('RR duplicate keys use the last value', () => temp(d => {
  const p = path.join(d, 'input.json'); fs.writeFileSync(p, JSON.stringify(base).replace('"status":"FAIL"', '"status":"PASS","status":"FAIL"'));
  const r = run('summary', p, '--format', 'json', '--fail-on', 'none'); assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).reports[0].status.value, 'FAIL');
}));
test('attack: version grammar boundaries retain only valid numeric versions', () => temp(d => {
  const p = path.join(d, 'input.json');
  for (const [v, valid] of [['1.2.3-rc.1', true], ['1234567.1', false], ['1.2.3.4.5', false], ['1-user_name', false]]) {
    const report = structuredClone(base); report.tool.version = v; fs.writeFileSync(p, JSON.stringify(report));
    const r = run('summary', p, '--format', 'json', '--fail-on', 'none'); assert.equal(r.status, 0);
    assert.equal(Object.hasOwn(JSON.parse(r.stdout).reports[0], 'productVersion'), valid, v);
  }
}));
test('attack: symlink marker is refused even with force', (t) => temp(d => {
  const target = path.join(d, 'target'); fs.writeFileSync(target, '');
  try { fs.symlinkSync(target, path.join(d, MARKER_NAME), 'file'); } catch (e) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) { t.skip('file symlink unavailable'); return; } throw e; }
  assert.throws(() => prepareOutputDir(d, { force: true }), { reason: 'foreign_directory' });
}));
test('attack: strict permits ignored snapshots and rejects duplicates when requested', () => temp(d => {
  const good = path.join(d, 'good.json'); const duplicate = path.join(d, 'copy.json'); const ignored = path.join(d, 'snapshot.json');
  fs.writeFileSync(good, JSON.stringify(base)); fs.copyFileSync(good, duplicate);
  fs.writeFileSync(ignored, JSON.stringify({ format: 'joons-mcp-diff/snapshot', schemaVersion: 1 }));
  assert.equal(run('summary', good, ignored, '--strict', '--fail-on', 'none').status, 0);
  assert.equal(run('summary', good, duplicate, '--strict', '--duplicates', 'error', '--fail-on', 'none').status, 2);
}));

test('RR2-001 encoded and format-split credentials are masked without normal text changes', () => temp(d => {
  const p = path.join(d, 'input.json');
  const values = ['s\u200bk-FAKE000', 'sk%2DFAKE000', Buffer.from('sk-FAKE000').toString('base64'), Buffer.from('ghp_FAKE000').toString('base64url'), 's%6B%2DFAKE000'];
  for (const value of values) {
    const report = structuredClone(base); report.failure.message = `before ${value} after`; fs.writeFileSync(p, JSON.stringify(report));
    const r = run('summary', p, '--details', '--format', 'json', '--fail-on', 'none');
    assert.equal(r.status, 0); const text = JSON.stringify(JSON.parse(r.stdout).reports[0].findings);
    assert.ok(!text.includes(value), value); assert.ok(text.includes('[REDACTED]'), value);
  }
  for (const value of ['Please ask-me about the task-force today.', 'ordinary words and short text', 'bad %ZZ stays here']) assert.equal(redactText(value), value);
}));
test('RR-001 residual private path strings absent from tree', () => {
  const forbidden = [['AI', '_work'].join(''), ['C:', '/Users'].join('')];
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { if (entry.name.startsWith('.')) continue; const p = path.join(dir, entry.name); if (entry.isDirectory()) walk(p); else if (entry.isFile()) { const s = fs.readFileSync(p, 'utf8'); for (const word of forbidden) assert.equal(s.includes(word), false, p); } } };
  walk('.');
});
test('RA2-01 privacy version grammar documents omission', () => {
  const s = fs.readFileSync('docs/PRIVACY.md', 'utf8');
  assert.ok(s.includes('^[0-9]{1,6}(\\.[0-9]{1,6}){0,3}(-[0-9A-Za-z.]{1,24})?$'));
  assert.match(s, /probe `tool\.version`[^\n]*omitt/i);
});
test('RA2-02 privacy documents redaction passes and split-field limitation', () => {
  const s = fs.readFileSync('docs/PRIVACY.md', 'utf8');
  assert.match(s, /credential.prefix/i); assert.match(s, /base64url/i); assert.match(s, /split.field/i);
  assert.match(fs.readFileSync('SECURITY.md', 'utf8'), /split.field/i);
});

test('RR3-001 Unicode format characters and fillers cannot split credentials', () => {
  const points = [];
  for (let i = 0; i <= 0x10ffff; i++) if (/\p{Cf}/u.test(String.fromCodePoint(i))) points.push(i);
  points.push(0x180e, 0x115f, 0x1160, 0x3164, 0xffa0, 0x034f);
  for (let i = 0xfe00; i <= 0xfe0f; i++) points.push(i);
  for (let i = 0xe0000; i <= 0xe007f; i++) points.push(i);
  for (const point of new Set(points)) {
    const out = redactText('s' + String.fromCodePoint(point) + 'k-FAKE000');
    assert.ok(!out.includes('FAKE000'), `U+${point.toString(16)}`);
  }
});
test('RR3-002 one megabyte redaction performance', { skip: !!process.env.CI_SLOW }, () => {
  const failures = [];
  for (const [name, text] of Object.entries({ percent: '%41'.repeat(349525), email: 'a'.repeat(1048576) + '@', base64: 'Y'.repeat(1048576) })) {
    const times = [];
    for (let i = 0; i < 3; i++) { const start = performance.now(); redactText(text); times.push(performance.now() - start); }
    times.sort((a, b) => a - b);
    console.log(`RR3 timing ${name}: ${times.map(x => x.toFixed(1)).join(', ')} ms; median ${times[1].toFixed(1)} ms`);
    if (times[1] >= 200) failures.push(`${name} median ${times[1].toFixed(1)} ms`);
  }
  assert.deepEqual(failures, []);
});
test('RA-01 privacy documents encoded Bearer credentials', () => {
  const s = fs.readFileSync('docs/PRIVACY.md', 'utf8');
  assert.match(s, /base64[^\n]*(?:\n[^\n]*){0,3}Bearer/);
  assert.equal(redactText(Buffer.from('Bearer ABCDEF').toString('base64')), '[REDACTED]');
});
