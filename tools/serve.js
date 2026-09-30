// A static server for browser checks: serves the repo on http://127.0.0.1:8123/ and tells the
// browser never to cache, so a reload always runs the scripts on disk (docs/BROWSER_CHECKS.md).
//   node tools/serve.js [port=8123]    stop it (Ctrl+C) when the check is done
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || 8123);
const TEXT = '; charset=utf-8';
const TYPES = {
  '.html': 'text/html' + TEXT, '.js': 'text/javascript' + TEXT, '.css': 'text/css' + TEXT, '.json': 'application/json' + TEXT,
  '.md': 'text/plain' + TEXT, '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  const send = (status, body, type = 'text/plain' + TEXT) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store, must-revalidate', Expires: '0' });
    res.end(body);
  };
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return send(400, 'Bad request'); }
  let file = path.join(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(403, 'Outside the repo');
  if (rel.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => (err ? send(404, 'Not found') : send(200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream')));
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}/ (never cached)`));
