const fs = require('fs');
const path = require('path');

const pkg = require('./package.json');
const htmlPath = path.join(__dirname, '..', 'live_dashboard.html');

let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace('__VERSION__', pkg.version);
fs.writeFileSync(htmlPath, html);

console.log(`[prebuild] Stamped version ${pkg.version} into live_dashboard.html`);
