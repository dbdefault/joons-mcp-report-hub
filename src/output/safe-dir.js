// STUB - replaced at integration
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
export const MARKER_NAME = '.joons-report-hub-output';
const FIXED = new Set(['index.html', 'summary.json', 'summary.md', MARKER_NAME,
  ...['overall', 'probe', 'diff', 'policy-gate', 'mock-server', 'contract-runner'].map((n) => `badges/${n}.svg`)]);
export function isFixedFileName(name) { return FIXED.has(name); }

export class OutputError extends Error {
  constructor(message, reason = 'write_failed') {
    super(message);
    this.name = 'OutputError';
    this.reason = reason;
    this.exitCode = 4;
  }
}

// Refusal messages are fixed phrases and never contain a path.
function checkLinkComponents(abs) {
  const isWindows = /^[A-Za-z]:[\\/]/.test(abs);
  const parts = abs.split(sep).filter((p) => p.length > 0);
  let current;
  let startIndex;
  if (isWindows && parts.length > 0 && /^[A-Za-z]:$/.test(parts[0])) {
    current = parts[0] + sep;
    startIndex = 1;
  } else {
    current = sep;
    startIndex = 0;
  }
  for (let i = startIndex; i < parts.length; i++) {
    current = join(current, parts[i]);
    let st;
    try {
      st = lstatSync(current);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) {
      // macOS ships /var, /tmp and /etc as system links to /private/*; the default temporary directory lives under /var.
      if (process.platform === 'darwin' && ['/var', '/tmp', '/etc'].includes(current.toLowerCase())) continue;
      throw new OutputError('output directory path contains a symbolic link', 'symlink_component');
    }
  }
}

export function prepareOutputDir(outDir, { inputPaths = [], force = false } = {}) {
  if (typeof outDir !== 'string' || outDir.length === 0) {
    throw new OutputError('output directory is not usable');
  }
  const abs = resolve(outDir);
  checkLinkComponents(abs);

  let st = null;
  try {
    st = lstatSync(abs);
  } catch {
    st = null;
  }
  if (st !== null && !st.isDirectory()) {
    throw new OutputError('output directory is not a directory', 'file_target');
  }

  const comparable = (p) => {
    let value = resolve(p);
    try { value = realpathSync.native(value); } catch { /* non-existing path */ }
    return process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value;
  };
  const outputPath = comparable(abs);
  for (const inputPath of inputPaths) {
    const ip = comparable(inputPath);
    if (ip === outputPath || ip.startsWith(outputPath.endsWith(sep) ? outputPath : outputPath + sep)) {
      throw new OutputError('output directory overlaps an input file', 'output_overlaps_input');
    }
  }

  if (st === null) {
    try {
      mkdirSync(abs, { recursive: true });
    } catch {
      throw new OutputError('output directory cannot be created');
    }
    writeFileAtomic(abs, MARKER_NAME, '');
    return abs;
  }

  let entries;
  try {
    entries = readdirSync(abs);
  } catch {
    throw new OutputError('output directory cannot be read');
  }
  let hasMarker = false;
  if (entries.includes(MARKER_NAME)) {
    try { hasMarker = lstatSync(join(abs, MARKER_NAME)).isFile(); } catch { /* refuse */ }
    if (!hasMarker) throw new OutputError('output directory marker is not a regular file', 'foreign_directory');
  }
  if (entries.length > 0 && !hasMarker && !force) {
    throw new OutputError('output directory is not empty (use --force to reuse it)', 'foreign_directory');
  }
  if (!hasMarker) writeFileAtomic(abs, MARKER_NAME, '');
  return abs;
}

let tmpCounter = 0;

export function writeFileAtomic(dir, name, content) {
  if (!isFixedFileName(name)) throw new OutputError('invalid output file name', 'invalid_name');
  return writeSummaryFileAtomic(dir, name, content);
}

export function writeSummaryFileAtomic(dir, name, content) {
  const target = join(dir, name);
  const tmp = join(dirname(target), `.${basename(target)}.tmp-${process.pid}-${++tmpCounter}`);
  try {
    if (name.startsWith('badges/')) {
      checkLinkComponents(dirname(target));
      mkdirSync(dirname(target), { recursive: true });
    }
    writeFileSync(tmp, typeof content === 'string' ? content : String(content), 'utf8');
    renameSync(tmp, target);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // best effort cleanup
    }
    throw new OutputError('cannot write output file');
  }
  return target;
}
