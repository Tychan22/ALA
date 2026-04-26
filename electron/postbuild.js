const fs = require('fs');
const path = require('path');

const pkg = require('./package.json');
const htmlPath = path.join(__dirname, '..', 'live_dashboard.html');

let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(pkg.version, '__VERSION__');
fs.writeFileSync(htmlPath, html);

console.log(`[postbuild] Restored __VERSION__ placeholder in live_dashboard.html`);
