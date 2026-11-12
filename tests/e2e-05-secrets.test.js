// E2E 5: planted-secret tests. Copies of real reports are written to a temp dir with
// obviously fictional secrets, paths, tokens, URLs and hostile strings injected into tool
// names, messages, labels, target fields, failure messages and stderrTail.
//
// Default mode: none of the planted strings may appear in ANY output file or in
// stdout/stderr (free text is dropped entirely).
// --details mode: paths/tokens/URLs must be redacted by redactText ([PATH]/[URL]/[REDACTED]/
// [MASKED] markers appear instead), control/bidi characters are stripped, and markup is
// escaped in HTML (no raw '<script>' text).

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

const PATH_WIN = 'C:\\Users\\example-user\\project\\x.js';
const PATH_POSIX = '/home/example-user/project/x.js';
const TOKEN = 'ghp_EXAMPLE0123456789abcdefghijklmn';
const URL = 'https://user:pass@internal.example.invalid/x?token=abc';
const SCRIPT = '<script>alert(1)</script>';
const BIDI = 'name\u202Ereversed';
const ANSI = 'red\u001B[31m';

// planted strings that must NEVER appear raw in any output (both modes)
const NEVER_RAW = [PATH_WIN, PATH_POSIX, TOKEN, URL, SCRIPT, BIDI, ANSI, 'example-user', 'ghp_EXAMPLE', 'internal.example.invalid', 'user:pass', '\u202E', '\u001B'];

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

function readAll(dir) {
  return listFiles(dir)
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');
}

function load(rel) {
  return JSON.parse(fs.readFileSync(path.join(REAL, rel), 'utf8'));
}

function buildPlantedDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-secret-in-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const planted = [PATH_WIN, PATH_POSIX, TOKEN, URL, SCRIPT, BIDI, ANSI].join(' | ');

  // probe: tool names, finding messages/tool, server name, target fields, failure text
  const probe = load('probe/probe-fail-bad-schema.json');
  probe.server.name = `srv${SCRIPT}`;
  probe.target.args = [PATH_WIN, PATH_POSIX];
  probe.findings[0].tool = `tool${SCRIPT}`;
  probe.findings[0].message = planted;
  probe.findings[1].message = `schema at ${PATH_WIN} for token ${TOKEN}`;
  fs.writeFileSync(path.join(dir, 'probe.json'), JSON.stringify(probe, null, 2));

  const handshake = load('probe/probe-fail-handshake.json');
  handshake.failure.message = `handshake failed see ${URL}`;
  handshake.failure.stderrTail = `stderr: ${PATH_POSIX} ${TOKEN} ${BIDI}`;
  fs.writeFileSync(path.join(dir, 'handshake.json'), JSON.stringify(handshake, null, 2));

  // diff: labels, tool names, change messages
  const diff = load('diff/diff-compare-breaking.json');
  diff.before.label = `before-${SCRIPT}`;
  diff.after.label = `after-${TOKEN}`;
  diff.tools[0].name = `create-${SCRIPT}`;
  diff.tools[0].changes[0].message = `removed via ${PATH_POSIX} from ${URL}`;
  fs.writeFileSync(path.join(dir, 'diff.json'), JSON.stringify(diff, null, 2));

  // policy-gate: label, server name, tool names, finding messages
  const policy = load('policy-gate/check-warn.json');
  policy.snapshot.label = `snap${ANSI}`;
  policy.snapshot.server.name = `srv ${PATH_WIN}`;
  policy.findings[0].tool = `watch${SCRIPT}`;
  policy.findings[0].message = `missing ${URL} and ${TOKEN}`;
  fs.writeFileSync(path.join(dir, 'policy.json'), JSON.stringify(policy, null, 2));

  // contract-runner: suite name, test ids, assertion, failure message, target title
  const contract = load('contract-runner/run-failing.json');
  contract.suite.name = `suite ${PATH_POSIX}`;
  contract.target.server.title = `MOCK ${SCRIPT}`;
  contract.results[0].id = `wrong-${SCRIPT}`;
  contract.results[0].failures[0].assertion = `text.equals ${TOKEN}`;
  contract.results[0].failures[0].message = `boom ${URL} ${PATH_WIN}`;
  fs.writeFileSync(path.join(dir, 'contract.json'), JSON.stringify(contract, null, 2));

  // mock-server: scenario, mockOf, hostile tool-map key, hostile outcome key
  const mock = load('mock-server/session-report-default.json');
  mock.scenario = `default ${SCRIPT}`;
  mock.server.mockOf = `shop ${URL}`;
  mock.tools[`<img src=x onerror=alert(1)>`] = { calls: 1, lastArguments: {} };
  fs.writeFileSync(path.join(dir, 'mock.json'), JSON.stringify(mock, null, 2));

  return dir;
}

test('default mode: planted strings appear in no output file and no stream', (t) => {
  const inDir = buildPlantedDir(t);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-secret-out-'));
  t.after(() => { fs.rmSync(outDir, { recursive: true, force: true }); });

  const build = run(['build', inDir, '--out', outDir]);
  assert.equal(build.status, 1, 'failing reports -> exit 1');
  let haystack = readAll(outDir) + build.stdout + build.stderr;

  const term = run(['summary', inDir]);
  haystack += term.stdout + term.stderr;
  const md = run(['summary', inDir, '--format', 'markdown']);
  haystack += md.stdout + md.stderr;
  const validate = run(['validate', inDir]);
  haystack += validate.stdout + validate.stderr;

  for (const needle of NEVER_RAW) {
    assert.equal(haystack.includes(needle), false, `planted string leaked: ${JSON.stringify(needle)}`);
  }
});

test('--details mode: paths/tokens/URLs redacted, markup escaped, controls stripped', (t) => {
  const inDir = buildPlantedDir(t);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-secret-det-'));
  t.after(() => { fs.rmSync(outDir, { recursive: true, force: true }); });

  const build = run(['build', inDir, '--out', outDir, '--details']);
  assert.equal(build.status, 1);
  const everything = readAll(outDir);
  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  const s = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf8'));
  assert.equal(s.mode.details, true);

  // redactions: raw secrets never survive details mode
  for (const needle of ['example-user', 'ghp_EXAMPLE', 'internal.example.invalid', 'user:pass', '\u202E', '\u001B']) {
    assert.equal(everything.includes(needle), false, `secret leaked in details mode: ${needle}`);
  }
  // redaction markers did the work
  assert.ok(everything.includes('[PATH]'), 'expected [PATH] marker');
  assert.ok(everything.includes('[URL]'), 'expected [URL] marker');
  assert.ok(everything.includes('[REDACTED]') || everything.includes('[MASKED]'), 'expected token marker');

  // markup never appears raw in the dashboard (escaped, not injected)
  assert.ok(!html.includes(SCRIPT), 'raw script markup in dashboard');
  assert.ok(!html.includes('<img src=x'), 'raw img markup in dashboard');
  assert.ok(!html.includes('onerror='), 'event handler in dashboard');
  // the summary notes that details may contain internal names
  assert.ok(s.mode.details === true);
});
