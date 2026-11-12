// E2E 6: HTML/SVG injection. Hostile strings are injected into every free-text field of
// copies of real reports (tool names, server names, messages, labels, suite/test ids,
// failure messages, scenario, and enum fields with hostile values). Outputs must never
// contain injected elements or event handlers:
//   - index.html has exactly one <script> and one <style>;
//   - badges have no <script>, <image>, <use> or <foreignObject>;
//   - forbidden substrings (onload=, onerror=, <img, ]]>, javascript:) never appear raw.

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

const HOSTILE = [
  '<script>alert(1)</script>',
  '" onload="alert(1)',
  '</script><script>alert(2)</script>',
  ']]>',
  '<img src=x onerror=alert(1)>',
  'javascript:alert(1)',
  '\u2066ltr',
];
const FORBIDDEN = ['<img', '<foreignObject', ']]>', '<image', '<use', '\u2066'];

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function load(rel) {
  return JSON.parse(fs.readFileSync(path.join(REAL, rel), 'utf8'));
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function buildHostileDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-inj-in-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const all = HOSTILE.join(' ');
  const one = HOSTILE[0];

  const probe = load('probe/probe-fail-bad-schema.json');
  probe.server.name = `srv${one}`;
  probe.findings[0].tool = `tool${HOSTILE[1]}`;
  probe.findings[0].message = all;
  fs.writeFileSync(path.join(dir, 'probe.json'), JSON.stringify(probe, null, 2));

  const diff = load('diff/diff-compare-breaking.json');
  diff.before.label = `before${HOSTILE[3]}`;
  diff.after.label = `after${one}`;
  diff.tools[0].name = `create${HOSTILE[4]}`;
  diff.tools[0].changes[0].message = all;
  diff.tools[0].changes[0].kind = 'evil_kind<script>'; // unknown change kind
  fs.writeFileSync(path.join(dir, 'diff.json'), JSON.stringify(diff, null, 2));

  const policy = load('policy-gate/check-warn.json');
  policy.snapshot.label = `snap${one}`;
  policy.snapshot.server.name = `srv${HOSTILE[5]}`;
  policy.findings[0].tool = `watch${HOSTILE[1]}`;
  policy.findings[0].message = all;
  policy.findings[0].rule = 'evil_rule" onload="x'; // unknown rule id
  fs.writeFileSync(path.join(dir, 'policy.json'), JSON.stringify(policy, null, 2));

  const contract = load('contract-runner/run-failing.json');
  contract.suite.name = `suite${one}`;
  contract.target.server.title = `MOCK${HOSTILE[4]}`;
  contract.results[0].id = `wrong${HOSTILE[1]}`;
  contract.results[0].failures[0].assertion = `text.equals${one}`;
  contract.results[0].failures[0].message = all;
  fs.writeFileSync(path.join(dir, 'contract.json'), JSON.stringify(contract, null, 2));

  const mock = load('mock-server/session-report-default.json');
  mock.scenario = `default${one}`;
  mock.server.mockOf = `shop${HOSTILE[3]}`;
  mock.totals.byOutcome['evil<script>'] = 1; // unknown outcome
  mock.tools['tool" onload="x'] = { calls: 1, lastArguments: {} };
  fs.writeFileSync(path.join(dir, 'mock.json'), JSON.stringify(mock, null, 2));

  return dir;
}

function assertNoForbidden(label, text) {
  assert.doesNotMatch(text, /<[^>]+\s+on(?:load|error)\s*=/i, `${label}: event handler attribute`);
  for (const bad of FORBIDDEN) {
    assert.equal(text.includes(bad), false, `${label}: forbidden substring ${JSON.stringify(bad)}`);
  }
}

test('injection: hostile strings never create elements or handlers (default mode)', (t) => {
  const inDir = buildHostileDir(t);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-inj-out-'));
  t.after(() => { fs.rmSync(outDir, { recursive: true, force: true }); });

  const build = run(['build', inDir, '--out', outDir]);
  assert.equal(build.status, 1);

  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  assert.equal(countOccurrences(html, '<script'), 1, 'dashboard must have exactly one <script>');
  assert.equal(countOccurrences(html, '<style'), 1, 'dashboard must have exactly one <style>');
  assertNoForbidden('index.html', html);

  for (const name of ['overall', 'probe', 'diff', 'policy-gate', 'mock-server', 'contract-runner']) {
    const svg = fs.readFileSync(path.join(outDir, 'badges', `${name}.svg`), 'utf8');
    assertNoForbidden(`${name}.svg`, svg);
    assert.ok(!svg.includes('href='), `${name}.svg must not carry references`);
  }

  const md = fs.readFileSync(path.join(outDir, 'summary.md'), 'utf8');
  assertNoForbidden('summary.md', md);
  const s = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf8'));
  // enum fields with hostile values became `unknown`, never raw text
  const codes = s.reports.flatMap((r) => r.findings.map((f) => f.code));
  assert.ok(codes.includes('unknown'), 'hostile enum values should collapse to unknown');
  const json = JSON.stringify(s);
  assertNoForbidden('summary.json', json);
});

test('injection: --details mode still escapes everything in HTML', (t) => {
  const inDir = buildHostileDir(t);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-inj-det-'));
  t.after(() => { fs.rmSync(outDir, { recursive: true, force: true }); });

  const build = run(['build', inDir, '--out', outDir, '--details']);
  assert.equal(build.status, 1);
  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  assert.equal(countOccurrences(html, '<script'), 1);
  assert.equal(countOccurrences(html, '<style'), 1);
  assertNoForbidden('details index.html', html);
});
