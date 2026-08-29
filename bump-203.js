const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(/v=2\.0\.2/g, 'v=2.0.3');
html = html.replace(/>v2\.0\.2</g, '>v2.0.3<');
fs.writeFileSync('index.html', html);

let sw = fs.readFileSync('sw.js', 'utf8');
sw = sw.replace(/ikamet-ocr-v2\.0\.2/g, 'ikamet-ocr-v2.0.3');
fs.writeFileSync('sw.js', sw);
console.log("Bumped to 2.0.3");
