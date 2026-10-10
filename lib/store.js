'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const idFor = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}
module.exports = { idFor, load, save };
