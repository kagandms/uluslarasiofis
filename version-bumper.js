const fs = require('fs');

function bump(file, replaces) {
    let content = fs.readFileSync(file, 'utf8');
    for (let r of replaces) {
        content = content.replace(r.search, r.replace);
    }
    fs.writeFileSync(file, content, 'utf8');
}

// 1. index.html
bump('index.html', [
    { search: /manifest\.json\?v=1\.62\.\d+/g, replace: 'manifest.json?v=2.0' },
    { search: /index\.css\?v=1\.62\.\d+/g, replace: 'index.css?v=2.0' },
    { search: /app\.js\?v=1\.62\.\d+/g, replace: 'app.js?v=2.0' },
    { search: /<span class="version-badge">v1\.62\.\d+<\/span>/g, replace: '<span class="version-badge">v2.0</span>' }
]);

// 2. sw.js
bump('sw.js', [
    { search: /ikamet-ocr-v1\.62\.\d+/g, replace: 'ikamet-ocr-v2.0' }
]);

console.log('Version bumped to v2.0 successfully.');
