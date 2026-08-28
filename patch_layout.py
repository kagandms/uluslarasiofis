import sys

with open('index.html', 'r') as f:
    content = f.read()

# 1. Update Header
old_header = """                    <div style="display: flex; align-items: center; gap: 10px;">
                        <button id="btn-dark-mode" style="background:none; border:none; cursor:pointer; color:var(--text-primary);" title="Gece/Gündüz Modu">
                            <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                        </button>
                        <span class="version-badge">v1.61.17</span>
                    </div>"""

new_header = """                    <div class="header-actions" style="display: flex; align-items: center; gap: 8px;">
                        <button id="btn-install-pwa" class="btn-header" style="display: none;" title="Ana Ekrana Ekle">
                            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            <span class="hide-mobile">Yükle</span>
                        </button>
                        <button onclick="window.location.href = window.location.pathname + '?v=' + new Date().getTime();" class="btn-header" title="Sistemi Güncelle">
                            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                            <span class="hide-mobile">Güncelle</span>
                        </button>
                        <button id="btn-dark-mode" class="btn-header icon-only" title="Gece/Gündüz Modu">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                        </button>
                        <span class="version-badge">v1.61.18</span>
                    </div>"""
content = content.replace(old_header, new_header)

# 2. Update action-buttons
old_buttons = """                    <div class="action-buttons">
                        <button class="btn btn-primary" onclick="document.getElementById('file-input').removeAttribute('capture'); document.getElementById('file-input').click()">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                            Fotoğraf Yükle
                        </button>
                        <button onclick="window.location.href = window.location.pathname + '?v=' + new Date().getTime();" class="btn btn-accent" style="width: 100%; margin-top: 0.5rem; padding: 0.75rem;">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                            Sistemi Güncelle
                        </button>
                    </div>"""

new_buttons = """                    <div class="action-buttons">
                        <button class="btn btn-primary" onclick="document.getElementById('file-input').removeAttribute('capture'); document.getElementById('file-input').click()">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                            Fotoğraf Yükle
                        </button>
                    </div>"""
content = content.replace(old_buttons, new_buttons)

with open('index.html', 'w') as f:
    f.write(content)
