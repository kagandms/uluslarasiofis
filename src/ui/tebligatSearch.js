export function initTebligatSearch() {
    const toggleBtn = document.getElementById('tebligat-search-toggle');
    const searchBody = document.getElementById('tebligat-search-body');
    const searchInput = document.getElementById('tebligat-search-input');
    const searchResults = document.getElementById('tebligat-search-results');
    const clearBtn = document.getElementById('tebligat-search-clear');

    if (!toggleBtn || !searchBody || !searchInput || !searchResults) return;

    toggleBtn.addEventListener('click', () => {
        const isHidden = searchBody.style.display === 'none';
        searchBody.style.display = isHidden ? 'block' : 'none';
        
        const hint = document.getElementById('tebligat-search-hint');
        if (hint) {
            hint.style.display = isHidden ? 'none' : 'inline';
        }
        
        // Ok yönünü değiştir
        const icon = toggleBtn.querySelector('.toggle-icon');
        if (icon) {
            icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
        }

        if (isHidden) {
            searchInput.focus();
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.style.display = 'none';
            searchResults.innerHTML = '';
            searchInput.focus();
        });
    }

    let debounceTimeout;

    // 1. Skeleton Animasyonu için CSS Ekle (Eğer yoksa)
    if (!document.getElementById('tebligat-skeleton-styles')) {
        const style = document.createElement('style');
        style.id = 'tebligat-skeleton-styles';
        style.innerHTML = `
            @keyframes shimmer {
                0% { background-position: -468px 0; }
                100% { background-position: 468px 0; }
            }
            .skeleton-box {
                background: #f6f7f8;
                background-image: linear-gradient(to right, #f6f7f8 0%, #edeef1 20%, #f6f7f8 40%, #f6f7f8 100%);
                background-repeat: no-repeat;
                background-size: 800px 104px; 
                animation-duration: 1.2s;
                animation-fill-mode: forwards; 
                animation-iteration-count: infinite;
                animation-name: shimmer;
                animation-timing-function: linear;
            }
            body.dark-mode .skeleton-box {
                background: rgba(255,255,255,0.05);
                background-image: linear-gradient(to right, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.1) 20%, rgba(255,255,255,0.05) 40%, rgba(255,255,255,0.05) 100%);
            }
        `;
        document.head.appendChild(style);
    }

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        if (clearBtn) {
            clearBtn.style.display = query.length > 0 ? 'flex' : 'none';
        }

        clearTimeout(debounceTimeout);

        if (query.length < 2) {
            searchResults.innerHTML = '';
            return;
        }

        debounceTimeout = setTimeout(async () => {
            // Skeleton (Yükleniyor) Gösterimi
            const skeletonHTML = `
                <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px;">
                    <div class="skeleton-box" style="height: 20px; width: 60%; border-radius: 4px;"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                        <div class="skeleton-box" style="height: 16px; width: 30%; border-radius: 4px;"></div>
                        <div class="skeleton-box" style="height: 24px; width: 25%; border-radius: 12px;"></div>
                    </div>
                </div>
            `;
            searchResults.innerHTML = skeletonHTML.repeat(3); // 3 adet sahte kart göster
            
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

                const reversedResults = [...data.results].reverse();
                
                const safeQuery = query.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
                const words = safeQuery.split(/\\s+/).filter(w => w.length > 0);

                searchResults.innerHTML = reversedResults.map(res => {
                    let highlightedIsim = res.isim;
                    
                    // Sadece I/İ/i/ı harflerini esnek yap
                    words.forEach(word => {
                        let pattern = word.replace(/[iıiİI]/gi, '[iıiİI]');
                        
                        try {
                            const highlightRegex = new RegExp(`(${pattern})`, 'gi');
                            highlightedIsim = highlightedIsim.replace(
                                highlightRegex, 
                                '<mark style="background-color: rgba(33, 150, 243, 0.2); color: var(--accent); padding: 0 2px; border-radius: 3px; background-image: none;">$1</mark>'
                            );
                        } catch(e) {}
                    });

                    // Çakışmaları temizle
                    highlightedIsim = highlightedIsim.replace(/<mark[^>]*><mark[^>]*>/g, '<mark style="background-color: rgba(33, 150, 243, 0.2); color: var(--accent); padding: 0 2px; border-radius: 3px;">');
                    highlightedIsim = highlightedIsim.replace(/<\/mark><\/mark>/g, '</mark>');

                    // İşaretlenme durumunu Local Storage'dan kontrol et
                    const uniqueId = `${res.sayfa}-${res.isim}-${res.no || ''}`;
                    const isMarkedLocally = localStorage.getItem('tebligat_marked_' + uniqueId) === 'true';
                    
                    // Eğer API'den 'isMarked' veya 'isaretli' gibi bir alan gelirse onu da destekleyelim
                    const isMarked = res.isMarked || res.isaretli || isMarkedLocally;

                    const buttonHtml = isMarked
                        ? `<button class="btn btn-outline btn-mark-tebligat marked" style="padding: 4px 8px; font-size: 0.85rem; border-radius: 6px; display: flex; align-items: center; gap: 4px; border-color: #27ae60; color: #27ae60; background-color: rgba(39, 174, 96, 0.1); cursor: default;" disabled title="İşaretlendi">
                                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                İşaretlendi
                           </button>`
                        : `<button class="btn btn-outline btn-mark-tebligat" style="padding: 4px 8px; font-size: 0.85rem; border-radius: 6px; display: flex; align-items: center; gap: 4px; border-color: var(--card-border); color: var(--text-secondary); cursor: pointer; transition: all 0.2s;" title="İşaretle ve Tarih Ekle">
                                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                                İşaretle
                           </button>`;

                    return `
                    <div class="tebligat-result-card" data-sayfa="${res.sayfa}" data-isim="${res.isim}" data-no="${res.no || ''}" style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <div style="font-weight: 600; font-size: 1.1rem; color: var(--text-primary); flex: 1;">${highlightedIsim}</div>
                            ${buttonHtml}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.95rem; color: var(--text-secondary);">
                            <span style="display: flex; align-items: center; gap: 4px;">
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                                Sayfa: ${res.sayfa}
                            </span>
                            <span style="font-weight: 600; color: var(--accent); background: rgba(33, 150, 243, 0.1); padding: 4px 8px; border-radius: 12px;">
                                No: ${res.no || '-'}
                            </span>
                        </div>
                    </div>
                    `;
                }).join('');

            } catch (err) {
                console.error(err);
                searchResults.innerHTML = '<div style="color: red; text-align: center;">Bağlantı hatası oluştu.</div>';
            }
        }, 200); // 200ms debounce
    });

    // Delegasyon ile işaretleme butonlarını dinle
    searchResults.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-mark-tebligat');
        if (!btn) return;
        if (btn.disabled || btn.classList.contains('marked')) return;

        const card = btn.closest('.tebligat-result-card');
        if (!card) return;

        const sayfa = card.dataset.sayfa;
        const isim = card.dataset.isim;
        const no = card.dataset.no;

        // Butonu yükleniyor durumuna al
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div> İşleniyor...';
        btn.disabled = true;

        try {
            const response = await fetch('/api/update-tebligat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ sayfa, isim, no })
            });

            const data = await response.json();
            
            if (response.ok && data.success) {
                // Başarılı durumu
                btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg> İşaretlendi';
                btn.style.backgroundColor = 'rgba(39, 174, 96, 0.1)';
                btn.style.color = '#27ae60';
                btn.style.borderColor = '#27ae60';
                btn.style.cursor = 'default';
                btn.classList.add('marked');
                
                // LocalStorage'a kaydet ki sayfayı yenileyince de yeşil kalsın
                const uniqueId = `${sayfa}-${isim}-${no || ''}`;
                localStorage.setItem('tebligat_marked_' + uniqueId, 'true');
                
                // İsteğe bağlı olarak toast mesajı gösterebiliriz
                if (window.showToast) {
                    window.showToast('E-Tablo güncellendi (İsim yeşil oldu, C kolonuna tarih yazıldı).', 'success');
                }
            } else {
                throw new Error(data.error || 'Güncelleme başarısız');
            }
        } catch (error) {
            console.error('Update error:', error);
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            if (window.showToast) {
                window.showToast('Hata: ' + error.message, 'error');
            } else {
                alert('Hata: ' + error.message);
            }
        }
    });
}
