// src/input/collect.js - INPUT owner. Resolve CLI inputs to a bounded file list.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_MAX_FILES = 500;
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024; // 64 MiB

// args: array of input specs (files or directories, relative to cwd).
// A directory contributes its direct *.json children only (code-unit order,
// symlinks skipped via lstat). Never recursive. Returns {files, problems};
// problem details are fixed phrases - never paths.
export function collectInputs(
  args,
  { cwd = process.cwd(), maxFiles = DEFAULT_MAX_FILES } = {},
) {
  const files = [];
  const problems = [];
  let totalBytes = 0;
  let capped = false;

  const tryAdd = (filePath) => {
    if (capped) return;
    if (files.length >= maxFiles) {
      problems.push({
        kind: 'too_many_files',
        detail: `more than ${maxFiles} input files`,
      });
      capped = true;
      return;
    }
    let size = 0;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      problems.push({ kind: 'read_failed', detail: 'cannot inspect input file' });
      capped = true;
      return;
    }
    if (totalBytes + size > MAX_TOTAL_BYTES) {
      problems.push({
        kind: 'total_too_large',
        detail: 'input files exceed 64 MiB in total',
      });
      capped = true;
      return;
    }
    totalBytes += size;
    files.push({ path: filePath, index: files.length });
  };

  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length === 0) {
      problems.push({ kind: 'invalid_argument', detail: 'input path is empty' });
      continue;
    }
    const resolved = path.resolve(cwd, arg);
    let st;
    try {
      st = fs.lstatSync(resolved);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        problems.push({ kind: 'file_not_found', detail: 'input path does not exist' });
      } else {
        problems.push({ kind: 'read_failed', detail: 'cannot inspect input path' });
      }
      continue;
    }
    if (st.isSymbolicLink()) {
      problems.push({ kind: 'symlink_skipped', detail: 'symlink inputs are skipped' });
      continue;
    }
    if (st.isDirectory()) {
      let dirents;
      try {
        dirents = fs.readdirSync(resolved, { withFileTypes: true });
      } catch {
        problems.push({ kind: 'read_failed', detail: 'cannot read input directory' });
        continue;
      }
      const names = [];
      for (const de of dirents) {
        if (!de.isFile()) continue; // skips nested dirs, symlinks, sockets
        if (!de.name.endsWith('.json')) continue; // non-JSON ignored
        names.push(de.name);
      }
      names.sort(); // code-unit order
      for (const name of names) {
        const p = path.join(resolved, name);
        let fst;
        try {
          fst = fs.lstatSync(p);
        } catch {
          problems.push({ kind: 'read_failed', detail: 'cannot inspect input file' });
          continue;
        }
        if (fst.isSymbolicLink()) {
          problems.push({ kind: 'symlink_skipped', detail: 'symlink inputs are skipped' });
          continue;
        }
        tryAdd(p);
        if (capped) break;
      }
      continue;
    }
    if (st.isFile()) {
      tryAdd(resolved);
      continue;
    }
    problems.push({ kind: 'read_failed', detail: 'unsupported input path type' });
  }

  // deterministic final order: code-unit sort of resolved paths
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  files.forEach((f, i) => {
    f.index = i;
  });
  return { files, problems };
}
