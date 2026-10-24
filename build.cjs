'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
const read = file => fs.readFileSync(path.join(dir, 'src', file), 'utf8');
const script = text => text.replace(/<\/script/gi, '<\\/script');
const html = read('shell.html')
  .replace('/* POSTFORM_CSS */', () => read('style.css'))
  .replace('/* POSTFORM_ENGINE */', () => script(read('formatter.js')))
  .replace('/* POSTFORM_APP */', () => script(read('app.js')));
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
for (const filename of ['Postform.html', 'index.html']) fs.writeFileSync(path.join(dir, 'dist', filename), html);
console.log('Built dist/Postform.html and dist/index.html (' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB each).');
