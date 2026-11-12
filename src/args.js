// Argument parsing for the joons-mcp-report-hub CLI.
// Pure function: performs no I/O. Usage problems are reported as data
// ({ ok: false, message }); the caller maps them to exit code 3.

const COMMAND_SPECS = {
  build: {
    requireOut: true,
    defaultFormat: null,
    options: {
      'out': { type: 'value' },
      'details': { type: 'bool' },
      'show-file-names': { type: 'bool' },
      'duplicates': { type: 'enum', values: ['keep-first', 'error'] },
      'strict': { type: 'bool' },
      'fail-on': { type: 'enum', values: ['failure', 'warning', 'none'] },
      'stable': { type: 'bool' },
      'force': { type: 'bool' },
      'quiet': { type: 'bool' },
    },
  },
  summary: {
    requireOut: false,
    defaultFormat: 'terminal',
    options: {
      'format': { type: 'enum', values: ['terminal', 'json', 'markdown'] },
      'details': { type: 'bool' },
      'show-file-names': { type: 'bool' },
      'duplicates': { type: 'enum', values: ['keep-first', 'error'] },
      'strict': { type: 'bool' },
      'fail-on': { type: 'enum', values: ['failure', 'warning', 'none'] },
      'stable': { type: 'bool' },
      'out': { type: 'value' },
    },
  },
  badge: {
    requireOut: true,
    defaultFormat: null,
    options: {
      'out': { type: 'value' },
      'duplicates': { type: 'enum', values: ['keep-first', 'error'] },
      'strict': { type: 'bool' },
      'fail-on': { type: 'enum', values: ['failure', 'warning', 'none'] },
      'stable': { type: 'bool' },
      'force': { type: 'bool' },
    },
  },
  validate: {
    requireOut: false,
    defaultFormat: 'terminal',
    options: {
      'format': { type: 'enum', values: ['terminal', 'json'] },
      'duplicates': { type: 'enum', values: ['keep-first', 'error'] },
    },
  },
};

const COMMAND_NAMES = Object.keys(COMMAND_SPECS).join(', ');

const CAMEL = {
  'show-file-names': 'showFileNames',
  'fail-on': 'failOn',
};

export function sanitizeOptionName(name) {
  const cleaned = String(name).replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'option';
}

function fail(message) {
  return { ok: false, message };
}

export function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return fail(`missing command; fix: use one of: ${COMMAND_NAMES} (see --help)`);
  }
  const command = argv[0];
  const spec = COMMAND_SPECS[command];
  if (spec === undefined) {
    const shown = sanitizeOptionName(command).slice(0, 64);
    return fail(`unknown command '${shown}'; fix: use one of: ${COMMAND_NAMES} (see --help)`);
  }

  const options = {
    details: false,
    showFileNames: false,
    duplicates: 'keep-first',
    strict: false,
    failOn: 'failure',
    stable: false,
    force: false,
    quiet: false,
    out: undefined,
    format: spec.defaultFormat,
  };
  const seenValueOptions = new Set();
  const inputs = [];

  const setFailure = (text) => fail(text);

  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') {
      for (let j = i + 1; j < argv.length; j++) inputs.push(argv[j]);
      break;
    }
    if (token.length > 2 && token.startsWith('--')) {
      const eq = token.indexOf('=');
      const rawName = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const hasEq = eq !== -1;
      const eqValue = hasEq ? token.slice(eq + 1) : undefined;
      const name = sanitizeOptionName(rawName);
      const optSpec = spec.options[name];
      if (optSpec === undefined) {
        return setFailure(`unknown option '--${name}'; fix: see --help for the options of command '${command}'`);
      }
      const key = CAMEL[name] || name;
      if (optSpec.type === 'bool') {
        if (hasEq) {
          return setFailure(`option '--${name}' takes no value; fix: use '--${name}' without '=...'`);
        }
        options[key] = true;
        continue;
      }
      // value option
      if (seenValueOptions.has(name)) {
        return setFailure(`option '--${name}' was given more than once; fix: pass it only once`);
      }
      let value;
      if (hasEq) {
        value = eqValue;
        if (value.length === 0) {
          return setFailure(`option '--${name}' needs a value; fix: pass --${name} <value>`);
        }
      } else {
        const next = argv[i + 1];
        if (next === undefined || (next.length > 1 && next.startsWith('-'))) {
          return setFailure(`option '--${name}' needs a value; fix: pass --${name} <value>`);
        }
        value = next;
        i++;
      }
      if (optSpec.type === 'enum' && !optSpec.values.includes(value)) {
        return setFailure(`invalid value for option '--${name}'; fix: use one of: ${optSpec.values.join(', ')}`);
      }
      seenValueOptions.add(name);
      options[key] = value;
      continue;
    }
    if (token.length > 1 && token.startsWith('-')) {
      const name = sanitizeOptionName(token.slice(1));
      return setFailure(`unknown option '-${name}'; fix: see --help for the options of command '${command}'`);
    }
    inputs.push(token);
  }

  if (inputs.length === 0) {
    return fail('no input file given; fix: pass at least one input file (a file or a directory)');
  }
  if (spec.requireOut && options.out === undefined) {
    return fail("missing required option '--out'; fix: pass --out DIR");
  }
  return { ok: true, command, inputs, options };
}
