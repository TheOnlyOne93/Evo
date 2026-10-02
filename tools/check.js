// The refactor gate in one command: the tests and the fingerprint check, run side by side.
//   node tools/check.js    (exit 1 if either fails)
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
// Each job: its name, its arguments to node, and the line it shows when it passes
const JOBS = [
  ['tests', ['--test', 'tests/*.test.js'], out => (out.match(/^ℹ (tests|pass|todo) \d+/gm) || []).map(l => l.slice(2)).join(', ')],
  ['fingerprint', ['tools/fingerprint.js', '--check'], out => out.slice(out.lastIndexOf('\n') + 1)]
];

const start = Date.now();
Promise.all(JOBS.map(([name, args, summary]) => new Promise(resolve => {
  const child = spawn(process.execPath, args, { cwd: root });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  child.on('close', code => resolve({ name, code, out, summary }));
}))).then(results => {
  // A passing job shows its summary line; a failing one shows everything
  for (const r of results) {
    const out = r.out.trimEnd();
    console.log(r.code ? `== ${r.name} FAILED\n${out}\n` : `${r.name}: ${r.summary(out)}`);
  }
  const failed = results.filter(r => r.code).map(r => r.name);
  console.log(failed.length ? `check failed: ${failed.join(', ')}` : `check passed (${((Date.now() - start) / 1000).toFixed(1)} s)`);
  process.exitCode = failed.length ? 1 : 0;
});
