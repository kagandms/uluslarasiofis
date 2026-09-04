const fs = require('fs');

let code = fs.readFileSync('app.js', 'utf8');

// 1. Remove isDeleteMode button and selected delete button from rendering
code = code.replace(
    /} else if \(this\.isDeleteMode\) {[\s\S]*?} else {/,
    `} else {`
);

code = code.replace(
    /html \+= `<button class="history-btn-secondary" id="btn-history-delete-mode">Kayıt Seçerek Sil<\/button>`;/,
    ``
);

// 2. Remove click listener for deleting mode toggle
code = code.replace(
    /const deleteModeBtn = document\.getElementById\('btn-history-delete-mode'\);[\s\S]*?}\);[\s\S]*?}/,
    ``
);

// 3. Remove cancel and delete selected listeners
code = code.replace(
    /const cancelBtn = document\.getElementById\('btn-history-cancel'\);[\s\S]*?}\);[\s\S]*?}/,
    ``
);

code = code.replace(
    /const deleteSelectedBtn = document\.getElementById\('btn-history-delete-selected'\);[\s\S]*?}\);[\s\S]*?}/,
    ``
);

// 4. Remove toggle selection logic in click
code = code.replace(
    /if \(this\.isDeleteMode\) {[\s\S]*?return;[\s\S]*?}/,
    ``
);

// 5. Check history items rendering. Checkboxes were rendered based on isDeleteMode
code = code.replace(
    /if \(this\.isTrashMode\) {[\s\S]*?} else if \(this\.isDeleteMode\) {[\s\S]*?html \+= `<div class="history-checkbox \${this\.selectedIds\.has\(item\.id\) \? 'selected' : ''}"><\/div>`;[\s\S]*?}/,
    `if (this.isTrashMode) {
                        html += \`<button class="history-restore-btn" data-id="\${item.id}" title="Geri Yükle">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                        </button>\`;
                    }`
);

fs.writeFileSync('app.js', code);
console.log("Deleted isDeleteMode logic");
