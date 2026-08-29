const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(/v=2\.0/g, 'v=2.0.1');
html = html.replace(/>v2\.0</g, '>v2.0.1<');
fs.writeFileSync('index.html', html);
