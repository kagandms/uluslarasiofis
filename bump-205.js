const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(/v=2\.0\.4/g, 'v=2.0.5');
html = html.replace(/>v2\.0\.4</g, '>v2.0.5<');
fs.writeFileSync('index.html', html);

let sw = fs.readFileSync('sw.js', 'utf8');
sw = sw.replace(/ikamet-ocr-v2\.0\.4/g, 'ikamet-ocr-v2.0.5');
fs.writeFileSync('sw.js', sw);
console.log("Bumped to 2.0.5");
