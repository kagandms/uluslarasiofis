const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(/v=2\.0\.1/g, 'v=2.0.2');
html = html.replace(/>v2\.0\.1</g, '>v2.0.2<');
fs.writeFileSync('index.html', html);

let sw = fs.readFileSync('sw.js', 'utf8');
sw = sw.replace(/ikamet-ocr-v2\.0\.1/g, 'ikamet-ocr-v2.0.2');
fs.writeFileSync('sw.js', sw);
