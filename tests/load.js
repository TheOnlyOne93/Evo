// Load every script index.html marks `data-headless` (in page order) into Node; returns Evo.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function loadEvo() {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)" data-headless><\/script>/g)) require(path.join(root, src));
  return globalThis.Evo;
};
