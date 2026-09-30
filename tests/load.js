// Load every script index.html marks `data-headless` (in page order) into Node; returns Evo.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// The src of every data-headless script in index.html, in page order (eslint.config.js reads it too)
function headlessScripts() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const srcs = [];
  for (const [, attrs] of html.matchAll(/<script\b([^>]*)>/gi)) {
    // data-headless as a bare attribute (or with a value), in any position among the others
    if (!/(^|\s)data-headless(\s|=|$)/.test(attrs)) continue;
    const m = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/.exec(attrs);
    if (!m) throw new Error('index.html: a data-headless script has no src: <script' + attrs + '>');
    srcs.push(m[1] ?? m[2] ?? m[3]);
  }
  if (!srcs.length) throw new Error('tests/load.js: no data-headless scripts found in index.html');
  return srcs;
}

module.exports = function loadEvo() {
  for (const src of headlessScripts()) require(path.join(root, src));
  return globalThis.Evo;
};
module.exports.headlessScripts = headlessScripts;
