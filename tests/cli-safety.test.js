// Safety and CLI surface: planted paths/tokens never reach any output,
// input paths and file contents never appear in stdout/stderr, --help lists
// every command/option/exit code, --version prints 0.1.0, badges agree with
// the summary, and the bin script wires exit codes through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'real');
const PASS = join(FIXTURES, 'probe', 'probe-stdio-pass.json');
const NO_DATA = join(FIXTURES, 'mock-server', 'session-report-default.json');
const CONTRACT_FAIL = join(FIXTURES, 'contract-runner', 'run-mixed-fail-skip.json');

const PLANTED_PATH = 'C:\\Users\\example-user\\project\\x.js';
const PLANTED_TOKEN = 'ghp_EXAMPLE1234abcd5678efgh9012ijkl';
const PLANTED_URL = 'https://internal.example.invalid/secret?token=abc';

function hostileProbeReport() {
  return {
    schemaVersion: 1,
    tool: { name: 'joons-mcp-probe', version: '0.1.0' },
    startedAt: '2026-11-12T14:24:52.098Z',
    finishedAt: '2026-11-12T14:24:53.111Z',
    target: { transport: 'stdio', command: 'node', args: ['server.js'] },
    status: 'WARNING',
    server: { name: 'evil-server', version: '1.0.0' },
    timings: { connectMs: 6, initializeMs: 225, toolsListMs: 98, totalMs: 1014 },
    tools: { count: 1, pages: 1, items: [{ name: 'hello', hasDescription: true, schemaValid: true }] },
    findings: [
      { id: 'TOOLS_EMPTY', severity: 'warning', category: 'tools', message: `ran from ${PLANTED_PATH} with token ${PLANTED_TOKEN} via ${PLANTED_URL}`, tool: '<script>alert(1)</script>' },
    ],
    failure: null,
  };
}

function makeIo(cwd) {
  const out = [];
  const err = [];
  return {
    io: {
      stdout: { write: (s) => { out.push(String(s)); } },
      stderr: { write: (s) => { err.push(String(s)); } },
      cwd,
      env: {},
    },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

async function run(argv, cwd) {
  const h = makeIo(cwd);
  const code = await main(argv, h.io);
  return { code, stdout: h.stdout(), stderr: h.stderr() };
}

function withTemp(t, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-safe-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return fn(dir);
}

function allOutputs(tmp, dir) {
  const outDir = join(tmp, dir);
  const texts = [];
  const walk = (p) => {
    for (const name of readdirSync(p, { withFileTypes: true })) {
      if (name.isDirectory()) walk(join(p, name.name));
      else texts.push(readFileSync(join(p, name.name), 'utf8'));
    }
  };
  walk(outDir);
  return texts;
}

test('planted path, token and URL never reach build outputs or console (default mode)', async (t) => {
  await withTemp(t, async (tmp) => {
    const hostile = join(tmp, 'hostile.json');
    writeFileSync(hostile, JSON.stringify(hostileProbeReport()), 'utf8');
    const out = join(tmp, 'out');
    const r = await run(['build', hostile, '--out', out], tmp);
    assert.equal(r.code, 0, r.stderr);
    const everything = [r.stdout, r.stderr, ...allOutputs(tmp, 'out')].join('\n');
    assert.doesNotMatch(everything, /example-user/);
    assert.doesNotMatch(everything, /ghp_EXAMPLE/);
    assert.doesNotMatch(everything, /internal\.example\.invalid/);
    assert.doesNotMatch(everything, /<script>alert/);
  });
});

test('planted strings stay redacted in --details mode', async (t) => {
  await withTemp(t, async (tmp) => {
    const hostile = join(tmp, 'hostile.json');
    writeFileSync(hostile, JSON.stringify(hostileProbeReport()), 'utf8');
    const r = await run(['summary', hostile, '--details', '--format', 'json'], tmp);
    assert.equal(r.code, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /example-user/);
    assert.doesNotMatch(r.stdout, /ghp_EXAMPLE/);
    assert.doesNotMatch(r.stdout, /internal\.example\.invalid/);
  });
});

test('input paths and file contents never appear in stdout or stderr', async (t) => {
  await withTemp(t, async (tmp) => {
    const r = await run(['summary', PASS], tmp);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stdout, new RegExp(PASS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(r.stderr, /probe-stdio-pass\.json/);
    const r2 = await run(['summary', join(tmp, 'missing.json')], tmp);
    assert.equal(r2.code, 2);
    assert.doesNotMatch(r2.stderr, /missing\.json/);
  });
});

test('usage errors carry the prefix and never print input paths', async (t) => {
  await withTemp(t, async (tmp) => {
    const secret = join(tmp, 'my-secret-file.json');
    writeFileSync(secret, readFileSync(PASS, 'utf8'), 'utf8');
    const r = await run(['summary', secret, '--nope'], tmp);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /^joons-mcp-report-hub: /);
    assert.doesNotMatch(r.stderr, /my-secret-file/);
  });
});

test('--help lists every command, option, default and exit code', async (t) => {
  await withTemp(t, async (tmp) => {
    const r = await run(['--help'], tmp);
    assert.equal(r.code, 0);
    for (const token of [
      'build', 'summary', 'badge', 'validate',
      '--out', '--details', '--show-file-names', '--duplicates', '--strict',
      '--fail-on', '--stable', '--force', '--quiet', '--format',
      'keep-first', 'error', 'failure', 'warning', 'none',
      'terminal', 'json', 'markdown',
      '--help', '--version',
    ]) {
      assert.ok(r.stdout.includes(token), `help text must mention ${token}`);
    }
    assert.match(r.stdout, /[Ee]xit codes?:/, 'help text must list the exit codes');
    for (const code of ['0', '1', '2', '3', '4']) {
      assert.ok(new RegExp(`^\\s*${code}\\s`).test(r.stdout) || r.stdout.includes(` ${code} `), `help must explain exit code ${code}`);
    }
  });
});

test('--version prints 0.1.0', async (t) => {
  await withTemp(t, async (tmp) => {
    const r = await run(['--version'], tmp);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '0.1.0\n');
  });
});

test('badge values agree with the summary status', async (t) => {
  await withTemp(t, async (tmp) => {
    for (const [fixture, expected] of [
      [PASS, 'PASS'],
      [NO_DATA, 'NO DATA'],
    ]) {
      const json = await run(['summary', fixture, '--format', 'json'], tmp);
      const status = JSON.parse(json.stdout).overall.status;
      const out = join(tmp, `badges-${status.replace(/\s/g, '_')}`);
      const badge = await run(['badge', fixture, '--out', out], tmp);
      assert.equal(badge.code, 0, badge.stderr);
      const svg = readFileSync(join(out, 'badges', 'overall.svg'), 'utf8');
      assert.ok(svg.includes(`>${expected}<`), svg);
      assert.match(svg, /role="img"/);
      assert.match(svg, /<title>MCP reports: /);
    }
  });
});

test('contract badge shows the floored success percent and failure level', async (t) => {
  await withTemp(t, async (tmp) => {
    const json = await run(['summary', CONTRACT_FAIL, '--format', 'json'], tmp);
    const doc = JSON.parse(json.stdout);
    assert.equal(doc.overall.status, 'FAIL');
    const out = join(tmp, 'out');
    const badge = await run(['badge', CONTRACT_FAIL, '--out', out], tmp);
    assert.equal(badge.code, 1);
    const svg = readFileSync(join(out, 'badges', 'contract-runner.svg'), 'utf8');
    assert.ok(svg.includes(`${doc.testSuccessRate.percent}% PASS`), svg);
  });
});

test('bin script: --version, exit codes and EPIPE safety are wired through', async (t) => {
  await withTemp(t, async (tmp) => {
    const bin = join(ROOT, 'bin', 'joons-mcp-report-hub.js');
    const v = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
    assert.equal(v.status, 0);
    assert.equal(v.stdout, '0.1.0\n');
    const fail = spawnSync(process.execPath, [bin, 'summary', CONTRACT_FAIL], { encoding: 'utf8' });
    assert.equal(fail.status, 1);
    const usage = spawnSync(process.execPath, [bin, 'summary', '--bogus', PASS], { encoding: 'utf8' });
    assert.equal(usage.status, 3);
    assert.match(usage.stderr, /^joons-mcp-report-hub: /);
    const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Exit codes:/);
  });
});
