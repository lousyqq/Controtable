const fs = require('fs');
let html = fs.readFileSync('wwwroot/index.html', 'utf8');

// Replace any existing app.css or app.css?v=... with a new timestamp
html = html.replace(/href="app\.css(\?v=\d+)?"/, 'href="app.css?v=' + Date.now() + '"');
html = html.replace(/src="app\.js(\?v=\d+)?"/, 'src="app.js?v=' + Date.now() + '"');

fs.writeFileSync('wwwroot/index.html', html);
console.log('Cache busting applied to index.html');
