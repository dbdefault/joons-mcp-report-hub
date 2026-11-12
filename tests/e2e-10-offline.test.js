// E2E 10: the dashboard is fully offline.
// After removing the CSP meta tag (whose base64 SHA-256 hashes may legitimately contain
// '/' pairs), index.html must contain no 'http:', 'https:', '//', 'url(' or '@import' --
// checked with plain indexOf, no regular expressions. Badges carry no references either.

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

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

test('index.html has no external references of any kind', (t) => {
  const inDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-off-in-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joons-hub-e2e-off-out-'));
  t.after(() => {
    fs.rmSync(inDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });
  fs.copyFileSync(path.join(REAL, 'probe/probe-pass-stdio.json'), path.join(inDir, 'ok.json'));

  const res = run(['build', inDir, '--out', outDir]);
  assert.equal(res.status, 0);
  let html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');

  // the CSP meta carries sha256-<base64> hashes; base64 can contain '/', so exclude the
  // meta tag itself from the raw substring checks
  assert.ok(html.includes('<meta http-equiv="Content-Security-Policy"'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes('base-uri'));
  assert.ok(html.includes('form-action'));
  const start = html.indexOf('<meta http-equiv="Content-Security-Policy"');
  const end = html.indexOf('>', start);
  html = html.slice(0, start) + html.slice(end + 1);

  for (const needle of ['http:', 'https:', '//', 'url(', '@import']) {
    assert.equal(html.indexOf(needle), -1, `index.html contains ${JSON.stringify(needle)}`);
  }
  // no tags/APIs that could fetch anything
  for (const needle of ['<link', '<img', 'fetch(', 'XMLHttpRequest', 'src=', 'href=']) {
    assert.equal(html.indexOf(needle), -1, `index.html contains ${JSON.stringify(needle)}`);
  }

  // badges: no references either (an SVG may legitimately declare its XML namespace,
  // but must not link, embed or script anything)
  for (const name of ['overall', 'probe']) {
    const svg = fs.readFileSync(path.join(outDir, 'badges', `${name}.svg`), 'utf8');
    assert.equal(svg.indexOf('<script'), -1, `${name}.svg contains a script`);
    assert.equal(svg.indexOf('xlink:href'), -1, `${name}.svg contains a link`);
    assert.equal(svg.indexOf('href='), -1, `${name}.svg contains a reference`);
  }
});
