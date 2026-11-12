// CLI core for joons-mcp-report-hub.
// main(argv, io) runs a command and returns the exit code (0/1/2/3/4).
// io = { stdout, stderr, cwd, env }. Input files are never named in output:
// they are referred to only as 'report-<n>' labels; usage errors name the
// problem and the fix. Streams that fail with EPIPE never crash the CLI:
// a stdout write failure forces exit code 4, stderr write failures are ignored.

import { parseArgs } from './args.js';
import { VERSION } from './version.js';
import { collectInputs } from './input/collect.js';
import { readReportFile, parseJsonText } from './input/read.js';
import { identifyReport } from './input/identify.js';
import { adaptReport } from './adapters/index.js';
import { buildSummary } from './model/aggregate.js';
import { prepareOutputDir, writeFileAtomic, writeSummaryFileAtomic } from './output/safe-dir.js';
import { renderSummaryJson } from './render/json.js';
import { renderSummaryMarkdown } from './render/markdown.js';
import { renderSummaryTerminal } from './render/terminal.js';
import { renderDashboardHtml } from './render/html.js';
import { buildBadges } from './render/svg.js';
import { sha256Hex } from './util/object.js';
import { redactText } from './security/redact.js';
import { mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

export const MARKER = '.joons-report-hub-output';
export const BUILD_FILES = ['index.html', 'summary.json', 'summary.md'];

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 500;
const PREFIX = 'joons-mcp-report-hub: ';
// Problem kinds that make --strict exit 2.

const HELP_TEXT = `joons-mcp-report-hub ${VERSION} - turn MCP diagnostics and test results into unified reports, dashboards, and CI badges.

Usage:
  joons-mcp-report-hub build <input>... --out DIR [options]
  joons-mcp-report-hub summary <input>... [options]
  joons-mcp-report-hub badge <input>... --out DIR [options]
  joons-mcp-report-hub validate <input>... [options]
  joons-mcp-report-hub --help
  joons-mcp-report-hub --version

<input> is a file or a directory (its direct *.json children, symlinks skipped,
sorted by name). At least one input is required; at most 500 files are read.

Commands:
  build     write index.html, summary.json, summary.md, badges/*.svg and a marker into DIR
  summary   print the summary, or write it to FILE with --out FILE (a file that is
            an input file is refused)
  badge     write only badges/*.svg and the marker into DIR
  validate  check that every input is a usable report file; duplicates and ignored
            snapshots (joons-mcp-diff/snapshot) are allowed

Options for build:
  --out DIR                       output directory (required)
  --details                       include redacted finding details (may contain internal names)
  --show-file-names               show sanitized input file base names
  --duplicates keep-first|error   byte-identical inputs: keep the first (default) or reject them
  --strict                        exit 2 when any input file is rejected or unsupported
  --fail-on failure|warning|none  overall status that fails the run (default: failure)
  --stable                        deterministic output: no timestamps, byte-identical reruns
  --force                         reuse a non-empty output directory (never deletes anything)
  --quiet                         suppress the completion line

Options for summary:
  --format terminal|json|markdown output format (default: terminal)
  --details                       include redacted finding details (may contain internal names)
  --show-file-names               show sanitized input file base names
  --duplicates keep-first|error   byte-identical inputs: keep the first (default) or reject them
  --strict                        exit 2 when any input file is rejected or unsupported
  --fail-on failure|warning|none  overall status that fails the run (default: failure)
  --stable                        deterministic output: no timestamps, byte-identical reruns
  --out FILE                      write the summary to FILE instead of stdout
                                  (refused when FILE is an input file)

Options for badge:
  --out DIR                       output directory (required)
  --duplicates keep-first|error   byte-identical inputs: keep the first (default) or reject them
  --strict                        exit 2 when any input file is rejected or unsupported
  --fail-on failure|warning|none  overall status that fails the run (default: failure)
  --stable                        deterministic output: no timestamps, byte-identical reruns
  --force                         reuse a non-empty output directory (never deletes anything)

Options for validate:
  --format terminal|json          output format (default: terminal)
  --duplicates keep-first|error   byte-identical inputs: keep the first (default) or reject them

General:
  --help     show this help
  --version  print the version (${VERSION})

Exit codes:
  0  overall PASS, or NO_DATA with at least one accepted report, or any result with --fail-on none
  1  overall FAIL (default), or WARN with --fail-on warning
  2  no accepted report at all, any input problem with --strict, or an input argument that is not usable
  3  usage error: unknown command or option, missing input, missing --out, duplicate or invalid option value
  4  output error: output directory refused, write failure, or stdout write failure

Safety: only fixed vocabulary, enumerated tokens, validated numbers and source
labels (report-<n> plus a 12-character content hash) ever reach an output.
Inputs are named 'input file' only; their paths and contents are never printed.
`;

function makeWriter(stream) {
  let broken = false;
  const write = (text) => {
    if (broken) return false;
    try {
      stream.write(text);
      return true;
    } catch {
      broken = true;
      return false;
    }
  };
  return {
    write,
    isBroken: () => broken,
  };
}

function sanitizeFileName(name) {
  return redactText(String(name), { maxLength: 200 });
}

function problemEntry(kind, label, sha256, detail) {
  return { kind, source: { label, sha256 }, detail };
}

// Reads, parses, identifies and adapts every input file. Also records a
// per-file outcome for `validate`. Never throws for per-file problems.
function runPipeline(parsed, io) {
  const collected = collectInputs(parsed.inputs, { cwd: io.cwd, maxFiles: MAX_FILES });
  const problems = [];
  const files = collected.files;
  // Input arguments that resolve to nothing are unusable input arguments (exit 2).
  const argumentProblems = collected.problems;

  const perFile = [];
  const loaded = [];
  let totalBytes = 0;
  for (const file of files) {
    const label = `report-${file.index + 1}`;
    try {
      const { bytes, text } = readReportFile(file.path, { maxBytes: MAX_FILE_BYTES });
      if (totalBytes + bytes.length > MAX_TOTAL_BYTES) {
        problems.push(problemEntry('limit_exceeded', label, null, 'total input size limit exceeded'));
        perFile.push({ label, sha256: null, outcome: 'problem', kind: 'limit_exceeded' });
        continue;
      }
      totalBytes += bytes.length;
      const full = sha256Hex(bytes);
      loaded.push({ file, label, text, sha256: full.slice(0, 12), full });
    } catch (err) {
      const kind = typeof err === 'object' && err !== null && typeof err.kind === 'string'
        ? err.kind : 'unreadable';
      const detail = typeof err === 'object' && err !== null && typeof err.detail === 'string'
        ? err.detail : 'cannot use input file';
      problems.push(problemEntry(kind, label, null, detail));
      perFile.push({ label, sha256: null, outcome: 'problem', kind });
    }
  }

  // Byte-identical duplicates: the first in sorted path order is kept.
  const seen = new Set();
  const kept = [];
  for (const item of loaded) {
    if (seen.has(item.full)) {
      problems.push(problemEntry('duplicate', item.label, item.sha256, 'same content as an earlier input file'));
      perFile.push({ label: item.label, sha256: item.sha256, outcome: 'duplicate', kind: 'duplicate' });
      continue;
    }
    seen.add(item.full);
    kept.push(item);
  }

  const entries = [];
  for (const item of kept) {
    let value;
    try {
      value = parseJsonText(item.text, { maxDepth: 64, maxNodes: 500000, maxStringLength: 100000 });
    } catch (err) {
      const kind = typeof err === 'object' && err !== null && typeof err.kind === 'string'
        ? err.kind : 'invalid_json';
      const detail = kind === 'invalid_json' && /^line \d+ column \d+$/.test(err.message)
        ? err.message : 'cannot parse input file';
      problems.push(problemEntry(kind, item.label, item.sha256, detail));
      perFile.push({ label: item.label, sha256: item.sha256, outcome: 'problem', kind });
      continue;
    }
    const identity = identifyReport(value);
    if (!identity.ok) {
      problems.push(problemEntry(identity.kind, item.label, item.sha256, identity.detail || 'cannot use input file'));
      perFile.push({
        label: item.label,
        sha256: item.sha256,
        outcome: identity.kind === 'ignored_input' ? 'ignored' : 'problem',
        kind: identity.kind,
      });
      continue;
    }
    try {
      const fileName = parsed.options.showFileNames
        ? sanitizeFileName(basename(item.file.path))
        : null;
      const report = adaptReport(value, {
        label: item.label,
        sha256: item.sha256,
        fileName,
        product: identity.product,
        reportType: identity.reportType,
        sourceFormat: identity.sourceFormat,
      }, { details: parsed.options.details });
      if (!report.ok) {
        problems.push(problemEntry(report.kind, item.label, item.sha256, report.detail));
        perFile.push({ label: item.label, sha256: item.sha256, outcome: 'problem', kind: report.kind });
        continue;
      }
      entries.push(report.report);
      perFile.push({
        label: item.label,
        sha256: item.sha256,
        outcome: 'accepted',
        kind: null,
        product: identity.product,
        reportType: identity.reportType,
      });
    } catch (err) {
      const kind = typeof err === 'object' && err !== null && typeof err.kind === 'string'
        ? err.kind : 'malformed_report';
      const detail = typeof err === 'object' && err !== null && typeof err.detail === 'string'
        ? err.detail : 'input file is malformed';
      problems.push(problemEntry(kind, item.label, item.sha256, detail));
      perFile.push({ label: item.label, sha256: item.sha256, outcome: 'problem', kind });
    }
  }

  return {
    argumentProblems,
    problems,
    perFile,
    entries,
    inputPaths: files.map((f) => f.path),
  };
}

function summarizeProblems(problems, options) {
  return buildSummary(problems.entries, problems.problems, {
    details: options.details,
    showFileNames: options.showFileNames,
    stable: options.stable,
    duplicates: options.duplicates,
  });
}

function strictFails(summary, options) {
  if (!options.strict) return false;
  for (const p of summary.problems) {
    if (p.kind === 'ignored_input') continue;
    if (p.kind === 'duplicate' && options.duplicates !== 'error') continue;
    return true;
  }
  return false;
}

function exitCodeFor(summary, options) {
  if (summary.totals.reports === 0) return 2;
  if (strictFails(summary, options)) return 2;
  if (options.failOn === 'none') return 0;
  if (summary.overall.status === 'FAIL') return 1;
  if (summary.overall.status === 'WARN' && options.failOn === 'warning') return 1;
  return 0;
}

function problemLines(summary) {
  return summary.problems
    .map((p) => `  ${p.source.label}: ${p.kind}${p.detail ? ` (${p.detail})` : ''}`)
    .join('\n');
}

function samePath(a, b) {
  const na = resolve(a);
  const nb = resolve(b);
  if (process.platform === 'win32') return na.toLowerCase() === nb.toLowerCase();
  return na === nb;
}

async function cmdSummary(parsed, io, pipeline, stdout) {
  const summary = summarizeProblems(pipeline, parsed.options);
  const format = parsed.options.format;
  const text = format === 'json'
    ? renderSummaryJson(summary)
    : format === 'markdown'
      ? renderSummaryMarkdown(summary)
      : renderSummaryTerminal(summary);
  if (parsed.options.out !== undefined) {
    const target = resolve(io.cwd, parsed.options.out);
    const isInput = pipeline.inputPaths.some((p) => samePath(p, target));
    if (isInput) {
      io.stderr.write(`${PREFIX}refusing to write the summary over an input file; fix: choose a different --out FILE\n`);
      return 4;
    }
    try {
      writeSummaryFileAtomic(dirname(target), basename(target), text);
    } catch (err) {
      const message = typeof err === 'object' && err !== null && typeof err.message === 'string'
        ? err.message : 'cannot write output file';
      io.stderr.write(`${PREFIX}${message}\n`);
      return 4;
    }
  } else {
    stdout.write(text);
  }
  if (pipeline.problems.length > 0) {
    io.stderr.write(`${PREFIX}problems:\n${problemLines(summary)}\n`);
  }
  return stdout.isBroken() ? 4 : exitCodeFor(summary, parsed.options);
}

function writeBuildOutputs(outDir, summary, withDashboard, stdout, quiet, command) {
  let badgeList;
  try {
    if (withDashboard) {
      const { html } = renderDashboardHtml(summary);
      writeFileAtomic(outDir, 'index.html', html);
      writeFileAtomic(outDir, 'summary.json', renderSummaryJson(summary));
      writeFileAtomic(outDir, 'summary.md', renderSummaryMarkdown(summary));
    }
    badgeList = buildBadges(summary);
    mkdirSync(resolve(outDir, 'badges'), { recursive: true });
    for (const badge of badgeList) {
      writeFileAtomic(outDir, `badges/${badge.name}.svg`, badge.svg);
    }
    writeFileAtomic(outDir, MARKER, '');
  } catch (err) {
    const message = typeof err === 'object' && err !== null && typeof err.message === 'string'
      ? err.message : 'cannot write output file';
    return { ok: false, message };
  }
  if (!quiet) {
    stdout.write(`${PREFIX}${command} complete (overall: ${summary.overall.status})\n`);
  }
  return { ok: true };
}

async function cmdBuild(parsed, io, pipeline, stdout, withDashboard, quiet) {
  const summary = summarizeProblems(pipeline, parsed.options);
  const outDir = resolve(io.cwd, parsed.options.out);
  try {
    prepareOutputDir(outDir, { inputPaths: pipeline.inputPaths, force: parsed.options.force });
  } catch (err) {
    const message = typeof err === 'object' && err !== null && typeof err.message === 'string'
      ? err.message : 'cannot use the output directory';
    io.stderr.write(`${PREFIX}${message}\n`);
    return 4;
  }
  const result = writeBuildOutputs(outDir, summary, withDashboard, stdout, quiet, withDashboard ? 'build' : 'badge');
  if (!result.ok) {
    io.stderr.write(`${PREFIX}${result.message}\n`);
    return 4;
  }
  if (pipeline.problems.length > 0) {
    io.stderr.write(`${PREFIX}problems:\n${problemLines(summary)}\n`);
  }
  return stdout.isBroken() ? 4 : exitCodeFor(summary, parsed.options);
}

async function cmdValidate(parsed, io, pipeline, stdout) {
  const duplicatesError = parsed.options.duplicates === 'error';
  const results = pipeline.perFile.map((f) => {
    const usable = f.outcome === 'accepted' || f.outcome === 'ignored'
      || (f.outcome === 'duplicate' && !duplicatesError);
    return {
      label: f.label,
      usable,
      kind: usable && f.outcome !== 'problem' ? null : f.kind,
      product: f.outcome === 'accepted' ? f.product : null,
      reportType: f.outcome === 'accepted' ? f.reportType : null,
    };
  });
  const usableCount = results.filter((r) => r.usable).length;
  const unusableCount = results.length - usableCount;
  const argumentCount = pipeline.argumentProblems.length;
  if (parsed.options.format === 'json') {
    const doc = {
      format: 'joons-mcp-report-hub/validation',
      schemaVersion: 1,
      tool: { name: 'joons-mcp-report-hub', version: VERSION },
      results,
      usable: usableCount,
      unusable: unusableCount + argumentCount,
    };
    stdout.write(JSON.stringify(doc, null, 2) + '\n');
  } else {
    const lines = results.map((r) => r.usable
      ? `  ${r.label}: usable${r.product ? ` (${r.product}: ${r.reportType})` : ' (ignored input)'}`
      : `  ${r.label}: unusable (${r.kind})`);
    lines.push(`summary: ${usableCount} usable, ${unusableCount + argumentCount} unusable`);
    stdout.write(lines.join('\n') + '\n');
  }
  if (argumentCount > 0) {
    io.stderr.write(`${PREFIX}an input argument could not be used; fix: pass a file or directory that exists\n`);
  }
  const allUsable = unusableCount === 0 && argumentCount === 0;
  return stdout.isBroken() ? 4 : (allUsable ? 0 : 2);
}

export async function main(argv, io) {
  const stdout = makeWriter(io.stdout);
  const stderrWrite = (text) => {
    try {
      io.stderr.write(text);
    } catch {
      // stderr errors are ignored by design.
    }
  };

  if (Array.isArray(argv) && argv[0] === '--help') {
    stdout.write(HELP_TEXT);
    return stdout.isBroken() ? 4 : 0;
  }
  if (Array.isArray(argv) && argv[0] === '--version') {
    stdout.write(`${VERSION}\n`);
    return stdout.isBroken() ? 4 : 0;
  }

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderrWrite(`${PREFIX}${parsed.message}\n`);
    return 3;
  }

  const pipeline = runPipeline(parsed, io);

  // Input arguments that do not resolve to any usable file make the run exit 2.
  if (pipeline.argumentProblems.length > 0) {
    stderrWrite(`${PREFIX}an input argument could not be used; fix: pass a file or directory that exists\n`);
    return 2;
  }
  if (pipeline.inputPaths.length === 0) {
    stderrWrite(`${PREFIX}no input file found; fix: pass a file or a directory containing JSON reports\n`);
    return 2;
  }

  switch (parsed.command) {
    case 'summary':
      return cmdSummary(parsed, io, pipeline, stdout);
    case 'build':
      return cmdBuild(parsed, io, pipeline, stdout, true, parsed.options.quiet);
    case 'badge':
      return cmdBuild(parsed, io, pipeline, stdout, false, false);
    case 'validate':
      return cmdValidate(parsed, io, pipeline, stdout);
    default:
      stderrWrite(`${PREFIX}unknown command; fix: use one of: build, summary, badge, validate (see --help)\n`);
      return 3;
  }
}
