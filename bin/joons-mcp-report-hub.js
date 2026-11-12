#!/usr/bin/env node
// Entry point for the joons-mcp-report-hub CLI.
// Stream error handlers are installed BEFORE main() runs: stderr errors are
// ignored, stdout errors (e.g. EPIPE) force exit code 4. The process exits
// via process.exitCode only, never via process.exit(), so pending output is
// always flushed by the runtime.

process.stdout.on('error', () => {
  process.exitCode = 4;
});
process.stderr.on('error', () => {
  // ignored by design
});

const { main } = await import('../src/cli.js');

try {
  const code = await main(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
  });
  if (typeof process.exitCode !== 'number' || process.exitCode === 0) {
    process.exitCode = code;
  }
} catch {
  try {
    process.stderr.write('joons-mcp-report-hub: internal error while running the command\n');
  } catch {
    // stderr errors are ignored by design
  }
  if (typeof process.exitCode !== 'number' || process.exitCode === 0) {
    process.exitCode = 2;
  }
}
