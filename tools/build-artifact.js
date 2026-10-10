'use strict';
// Builds a single self-contained page with an edition inlined, for publishing as a snapshot.
// Usage: node tools/build-artifact.js [edition.json] [out.html]
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = process.argv[2] || path.join(root, 'seed', 'edition.json');
const out = process.argv[3] || path.join(root, 'dist', 'economy-desk.html');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const data = JSON.stringify(JSON.parse(fs.readFileSync(src, 'utf8'))).replace(/</g, '\\u003c');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html.replace('/*SNAPSHOT*/null', () => data));
console.log('Wrote ' + out);
