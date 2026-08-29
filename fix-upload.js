const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

// We wrap the btn-upload in a div so we can catch clicks when disabled
const target = `<button id="btn-upload"`;
const replacement = `<div id="upload-wrapper" style="display:inline-block;" onclick="if(!navigator.onLine) showToast('İnternet yok. Tarama yapılamaz, manuel giriş yapabilirsiniz.', 'warning');">
                            <button id="btn-upload"`;
if(html.includes(target)) {
    html = html.replace(target, replacement);
    html = html.replace(`Fotoğraf Yükle\n                        </button>`, `Fotoğraf Yükle\n                        </button>\n                        </div>`);
    fs.writeFileSync('index.html', html);
    console.log("Wrapper added");
}
