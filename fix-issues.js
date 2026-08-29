const fs = require('fs');
let appJs = fs.readFileSync('app.js', 'utf8');

// Fix draft restoring overwritten by clearForm
appJs = appJs.replace(
    "restoreDraft();\n            clearFormExceptTeslimTarihi();",
    "clearFormExceptTeslimTarihi();\n            restoreDraft();"
);

// Fix disabled button eating clicks
appJs = appJs.replace(
    "btnUpload.title = \"İnternet bağlantısı koptu. Tarama yapılamaz.\";",
    "btnUpload.title = \"İnternet bağlantısı koptu. Tarama yapılamaz.\";\n            btnUpload.style.pointerEvents = 'none';"
);

appJs = appJs.replace(
    "btnUpload.title = \"\";",
    "btnUpload.title = \"\";\n            btnUpload.style.pointerEvents = 'auto';"
);

fs.writeFileSync('app.js', appJs);
console.log("Issues fixed");
