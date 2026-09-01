export function initTebligatSearch() {
    const toggleBtn = document.getElementById('tebligat-search-toggle');
    const searchBody = document.getElementById('tebligat-search-body');
    const searchInput = document.getElementById('tebligat-search-input');
    const searchResults = document.getElementById('tebligat-search-results');

    if (!toggleBtn || !searchBody || !searchInput || !searchResults) return;

    toggleBtn.addEventListener('click', () => {
        const isHidden = searchBody.style.display === 'none';
        searchBody.style.display = isHidden ? 'block' : 'none';
        
        // Ok yönünü değiştir
        const icon = toggleBtn.querySelector('.toggle-icon');
        if (icon) {
            icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
        }

        if (isHidden) {
            searchInput.focus();
        }
    });

    let debounceTimeout;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        clearTimeout(debounceTimeout);

        if (query.length < 2) {
            searchResults.innerHTML = '';
            return;
        }

        debounceTimeout = setTimeout(async () => {
            searchResults.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 10px;">Aranıyor...</div>';
            
            try {
                const response = await fetch(`/api/search-tebligat?q=${encodeURIComponent(query)}`);
                const data = await response.json();
                
                if (data.error) {
                    searchResults.innerHTML = `<div style="color: red; text-align: center;">Hata: ${data.error}</div>`;
                    return;
                }

                if (!data.results || data.results.length === 0) {
                    searchResults.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 10px;">Sonuç bulunamadı.</div>';
                    return;
                }

                searchResults.innerHTML = data.results.map(res => `
                    <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 4px;">
                        <div style="font-weight: 600; font-size: 1.1rem; color: var(--text-primary);">${res.isim}</div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; font-size: 0.95rem; color: var(--text-secondary);">
                            <span style="display: flex; align-items: center; gap: 4px;">
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                                Sayfa: ${res.sayfa}
                            </span>
                            <span style="font-weight: 600; color: var(--accent); background: rgba(33, 150, 243, 0.1); padding: 4px 8px; border-radius: 12px;">
                                No: ${res.no || '-'}
                            </span>
                        </div>
                    </div>
                `).join('');

            } catch (err) {
                console.error(err);
                searchResults.innerHTML = '<div style="color: red; text-align: center;">Bağlantı hatası oluştu.</div>';
            }
        }, 200); // 200ms debounce
    });
}
