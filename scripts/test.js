// Test runner: runs every top-level tests/*.test.js with the Node test runner
// and forwards its exit status.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testsDir = fileURLToPath(new URL('../tests/', import.meta.url));
const files = readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => join(testsDir, name));

if (files.length === 0) {
  process.stderr.write('no test files found in tests/\n');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  process.exitCode = result.status === null ? 1 : result.status;
}
