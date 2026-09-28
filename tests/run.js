// Headless test runner. Loads every script index.html marks `data-headless` (in page order) into
// Node, then runs tests/*.test.js. Each test starts from the same random seed.
//   node tests/run.js            run everything
//   node tests/run.js genome     run tests whose name contains "genome"
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Evo = require('./load')();

const tests = [];
globalThis.test = (name, fn) => tests.push({ name, fn });
for (const file of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()) {
  require(path.join(__dirname, file));
}

const filter = process.argv[2] || '';
let passed = 0, failed = 0;
for (const t of tests.filter(t => t.name.includes(filter))) {
  Evo.seed(12345);
  const start = Date.now();
  try {
    t.fn(Evo, assert);
    passed++;
    console.log(`  ok    ${t.name}  (${Date.now() - start} ms)`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${t.name}\n        ${String(e.stack).split('\n').slice(0, 5).join('\n        ')}`);
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
