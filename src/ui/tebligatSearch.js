const CLOUD_SYNC_TIMEOUT_MS = 90_000;
const CLOUD_SYNC_PROGRESS_INTERVAL_MS = 1_000;

export function initTebligatSearch() {
    const toggleBtn = document.getElementById('tebligat-search-toggle');
    const searchBody = document.getElementById('tebligat-search-body');
    const searchInput = document.getElementById('tebligat-search-input');
    const yearSelect = document.getElementById('tebligat-year-select');
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
    let abortController;

    const selectedYear = () => yearSelect?.value || '2026';
    const getSheetYear = (sheetName) => {
        const match = sheetName.match(/(?:^|\.)(\d{4})(?:$|\.)/);
        return match ? match[1] : String(new Date().getFullYear());
    };
    const belongsToSelectedYear = (row) => getSheetYear(row.sayfa) === selectedYear();

    // --- CLOUD SYNC CACHE MANTIĞI ---
    const btnSyncCloud = document.getElementById('btn-sync-cloud');
    const cacheStatusText = document.getElementById('cache-status-text');

    // Eğer cache varsa durum metnini güncelle
    if (cacheStatusText && localStorage.getItem('tebligat_excel_cache')) {
        const cachedData = JSON.parse(localStorage.getItem('tebligat_excel_cache'));
        cacheStatusText.innerHTML = `Bulut verisi: <span style="color: var(--success); font-weight: bold;">Güncel (${cachedData.length} Kayıt)</span>`;
    }

    if (btnSyncCloud) {
        btnSyncCloud.addEventListener('click', async () => {
            const syncController = new AbortController();
            const syncStartedAt = performance.now();
            const syncTimeoutId = window.setTimeout(
                () => syncController.abort(),
                CLOUD_SYNC_TIMEOUT_MS
            );
            const syncProgressId = window.setInterval(() => {
                const elapsedSeconds = Math.floor((performance.now() - syncStartedAt) / 1000);
                if (cacheStatusText) {
                    cacheStatusText.innerHTML = `<span style="color: var(--accent);"><div class="spinner" style="width:12px; height:12px; border-width: 2px; display: inline-block; vertical-align: middle; margin-right: 5px;"></div> Bulut verisi indiriliyor (${elapsedSeconds} sn)...</span>`;
                }
            }, CLOUD_SYNC_PROGRESS_INTERVAL_MS);

            if (cacheStatusText) {
                cacheStatusText.innerHTML = `<span style="color: var(--accent);"><div class="spinner" style="width:12px; height:12px; border-width: 2px; display: inline-block; vertical-align: middle; margin-right: 5px;"></div> Bulut verisi indiriliyor (0 sn)...</span>`;
            }
            
            const originalHtml = btnSyncCloud.innerHTML;
            btnSyncCloud.innerHTML = '<div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div> İndiriliyor...';
            btnSyncCloud.disabled = true;

            try {
                // Vercel'in 10-12 saniyelik timeout sınırına takılmamak için 
                // doğrudan Google Apps Script'e bağlanıyoruz.
                const scriptUrl = "https://script.google.com/macros/s/AKfycbwEHZ6-Iz-uohq4yeJRMvgNn5zXeHB6vqBRfBqvpBKai-elnKwJFSiX3EuprOPihnWHOQ/exec";
                const apiKey = "GIZLI_SIFRE_123";
                const fetchUrl = `${scriptUrl}?key=${apiKey}&action=getAll`;
                
                const response = await fetch(fetchUrl, { signal: syncController.signal });
                const data = await response.json();
                
                if (response.ok && data.results) {
                    const allCachedRows = data.results;
                    localStorage.setItem('tebligat_excel_cache', JSON.stringify(allCachedRows));
                    
                    if (cacheStatusText) {
                        cacheStatusText.innerHTML = `Bulut verisi: <span style="color: var(--success); font-weight: bold;">Güncellendi (${allCachedRows.length} Kayıt)</span>`;
                    }
                    if (window.showToast) window.showToast('Veritabanı başarıyla cihazınıza senkronize edildi!', 'success');
                } else {
                    throw new Error(data.error || 'Bilinmeyen bir hata oluştu');
                }
            } catch (err) {
                console.error(err);
                if (cacheStatusText) {
                    const isTimeout = err.name === 'AbortError';
                    cacheStatusText.innerHTML = `<span style="color: #e74c3c;">${isTimeout ? 'Senkronizasyon 90 saniye içinde tamamlanamadı' : 'Senkronizasyon Hatası'}</span>`;
                }
                if (window.showToast) {
                    const message = err.name === 'AbortError'
                        ? 'Bulut verisi 90 saniye içinde alınamadı. Mevcut bağlantıyı ve veri kaynağını kontrol edin.'
                        : 'Hata: ' + err.message;
                    window.showToast(message, 'error');
                }
            } finally {
                window.clearTimeout(syncTimeoutId);
                window.clearInterval(syncProgressId);
                btnSyncCloud.innerHTML = originalHtml;
                btnSyncCloud.disabled = false;
            }
        });
    }
    // --- CLOUD SYNC BİTTİ ---

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

    const runSearch = (event) => {
        const query = event.target.value.trim();

        if (clearBtn) {
            clearBtn.style.display = query.length > 0 ? 'flex' : 'none';
        }

        clearTimeout(debounceTimeout);
        if (abortController) {
            abortController.abort(); // Önceki isteği iptal et
        }

        if (query.length < 2) {
            searchResults.innerHTML = '';
            return;
        }

        abortController = new AbortController();

        debounceTimeout = setTimeout(async () => {
            const skeletonHTML = `
                <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px;">
                    <div class="skeleton-box" style="height: 20px; width: 60%; border-radius: 4px;"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                        <div class="skeleton-box" style="height: 16px; width: 30%; border-radius: 4px;"></div>
                        <div class="skeleton-box" style="height: 24px; width: 25%; border-radius: 12px;"></div>
                    </div>
                </div>
            `;
            searchResults.innerHTML = skeletonHTML.repeat(3);
            
            let allResults = [];
            const qLower = query.toLowerCase();

            // Render fonksiyonu
            const renderResults = (resultsArray, isFinal = false, errorMessage = null) => {
                if (resultsArray.length === 0) {
                    if (isFinal) {
                        searchResults.innerHTML = errorMessage 
                            ? `<div style="color: red; text-align: center;">Hata: ${errorMessage}</div>` 
                            : '<div style="text-align: center; color: var(--text-secondary); padding: 10px;">Sonuç bulunamadı.</div>';
                    }
                    return;
                }

                const uniqueResults = [];
                const seen = new Set();
                for (const r of resultsArray) {
                    const key = r.sayfa + '_' + r.no;
                    if (!seen.has(key)) {
                        seen.add(key);
                        uniqueResults.push(r);
                    }
                }

                const parseDateStr = (sayfaStr) => {
                    const match = sayfaStr.match(/(\d{2})\.(\d{2})(?:\.(\d{4}))?/);
                    if (!match) return 0;
                    const d = parseInt(match[1], 10);
                    const m = parseInt(match[2], 10);
                    const y = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
                    return y * 10000 + m * 100 + d;
                };

                const reversedResults = uniqueResults.sort((a, b) => {
                    const dateA = parseDateStr(a.sayfa);
                    const dateB = parseDateStr(b.sayfa);
                    if (dateB !== dateA) {
                        return dateB - dateA; // Tarihe göre azalan (yeni en üstte)
                    }
                    // Tarihler aynıysa (veya tarih yoksa), numarasına göre sırala
                    const noA = parseInt(a.no) || 0;
                    const noB = parseInt(b.no) || 0;
                    return noB - noA;
                });
                const safeQuery = query.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
                const words = safeQuery.split(/\s+/).filter(w => w.length > 0);

                let html = reversedResults.map(res => {
                    let highlightedIsim = res.isim;
                    words.forEach(word => {
                        let pattern = word.replace(/[iıiİI]/gi, '[iıiİI]');
                        try {
                            const highlightRegex = new RegExp(`(${pattern})`, 'gi');
                            highlightedIsim = highlightedIsim.replace(highlightRegex, '<mark style="background-color: rgba(33, 150, 243, 0.2); color: var(--accent); padding: 0 2px; border-radius: 3px; background-image: none;">$1</mark>');
                        } catch(e) {}
                    });
                    highlightedIsim = highlightedIsim.replace(/<mark[^>]*><mark[^>]*>/g, '<mark style="background-color: rgba(33, 150, 243, 0.2); color: var(--accent); padding: 0 2px; border-radius: 3px;">');
                    highlightedIsim = highlightedIsim.replace(/<\/mark><\/mark>/g, '</mark>');

                    const uniqueId = `${res.sayfa}-${res.isim}-${res.no || ''}`;
                    const isMarkedLocally = localStorage.getItem('tebligat_marked_' + uniqueId) === 'true';
                    const isMarked = res.isMarked || res.isaretli || isMarkedLocally;

                    const markBtnStyle = isMarked
                        ? `border-color: #27ae60; color: #27ae60; background-color: rgba(39, 174, 96, 0.1); cursor: default;`
                        : `border-color: var(--card-border); color: var(--text-secondary); cursor: pointer;`;
                    
                    const markBtnContent = isMarked
                        ? `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg> İşaretlendi`
                        : `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> İşaretle`;

                    const buttonHtml = `
                        <div class="tebligat-actions" style="display: flex; gap: 6px;">
                            <button class="btn btn-outline btn-mark-tebligat ${isMarked ? 'marked' : ''}" ${isMarked ? 'disabled' : ''} style="padding: 4px 8px; font-size: 0.85rem; border-radius: 6px; display: flex; align-items: center; gap: 4px; transition: all 0.2s; ${markBtnStyle}" title="İşaretle">
                                ${markBtnContent}
                            </button>
                            <button class="btn btn-outline btn-unmark-tebligat" style="display: ${isMarked ? 'flex' : 'none'}; padding: 4px 8px; font-size: 0.85rem; border-radius: 6px; align-items: center; gap: 4px; border-color: #e74c3c; color: #e74c3c; background-color: rgba(231, 76, 60, 0.1); cursor: pointer; transition: all 0.2s;" title="İşareti Kaldır">
                                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                Kaldır
                            </button>
                        </div>
                    `;

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

                if (errorMessage) {
                    html += `<div style="text-align: center; color: #e67e22; padding: 10px; font-size: 0.85rem; font-weight: bold;">Uyarı: API yanıt vermedi. Yalnızca önbellekteki (Excel) veriler listelendi. Yeni kayıtlar için tekrar deneyin.</div>`;
                } else if (!isFinal) {
                    html += `<div style="text-align: center; color: var(--text-secondary); padding: 10px; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; gap: 6px;"><div class="spinner" style="width:12px; height:12px; border-width: 2px;"></div> Sunucuda yeni kayıtlar aranıyor...</div>`;
                }

                searchResults.innerHTML = html;
            };

            // 1. Önce Cache'den Ara (Anında Sonuç)
            const cachedStr = localStorage.getItem('tebligat_excel_cache');
            if (cachedStr) {
                try {
                    const cacheArr = JSON.parse(cachedStr);
                    const cacheMatches = cacheArr.filter(r => belongsToSelectedYear(r) && r.isim.toLowerCase().includes(qLower));
                    cacheMatches.forEach(match => allResults.push(match));
                    
                    if (allResults.length > 0) {
                        renderResults(allResults, false);
                    }
                } catch (e) {}
            }
            
            // 2. Canlı Sunucudan Ara
            try {
                const response = await fetch(`/api/search-tebligat?q=${encodeURIComponent(query)}&year=${encodeURIComponent(selectedYear())}`, {
                    signal: abortController.signal
                });
                const data = await response.json();
                
                if (data.error) {
                    renderResults(allResults, true, data.error);
                    return;
                }

                if (data.results && data.results.length > 0) {
                    data.results.filter(belongsToSelectedYear).forEach(apiRes => allResults.push(apiRes));
                }
                
                renderResults(allResults, true);
                
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error(err);
                // Sunucu hata verse bile cache ekranda kalır
                renderResults(allResults, true, "Zaman aşımı");
            }
        }, 400); // 400ms debounce
    };

    searchInput.addEventListener('input', runSearch);
    if (yearSelect) {
        yearSelect.addEventListener('change', () => {
            if (searchInput.value.trim().length >= 2) {
                runSearch({ target: searchInput });
            }
        });
    }

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
                btn.disabled = true;
                
                // Kaldır butonunu görünür yap
                const unmarkBtn = card.querySelector('.btn-unmark-tebligat');
                if (unmarkBtn) {
                    unmarkBtn.style.display = 'flex';
                }
                
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

    // Delegasyon ile işareti kaldırma butonlarını dinle
    searchResults.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-unmark-tebligat');
        if (!btn) return;
        if (btn.disabled) return;

        const card = btn.closest('.tebligat-result-card');
        if (!card) return;

        const sayfa = card.dataset.sayfa;
        const isim = card.dataset.isim;
        const no = card.dataset.no;

        // Butonu yükleniyor durumuna al
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>...';
        btn.disabled = true;

        try {
            const response = await fetch('/api/unmark-tebligat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ sayfa, isim, no })
            });

            const data = await response.json();
            
            if (response.ok && data.success) {
                // Başarılı durumu: Kaldır butonunu gizle
                btn.style.display = 'none';
                btn.innerHTML = originalHtml;
                btn.disabled = false;

                // İşaretle butonunu eski haline getir
                const markBtn = card.querySelector('.btn-mark-tebligat');
                if (markBtn) {
                    markBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> İşaretle';
                    markBtn.style.backgroundColor = 'transparent';
                    markBtn.style.color = 'var(--text-secondary)';
                    markBtn.style.borderColor = 'var(--card-border)';
                    markBtn.style.cursor = 'pointer';
                    markBtn.classList.remove('marked');
                    markBtn.disabled = false;
                }
                
                // LocalStorage'dan sil
                const uniqueId = `${sayfa}-${isim}-${no || ''}`;
                localStorage.removeItem('tebligat_marked_' + uniqueId);
                
                if (window.showToast) {
                    window.showToast('İşaret başarıyla kaldırıldı.', 'success');
                }
            } else {
                throw new Error(data.error || 'İşlem başarısız');
            }
        } catch (error) {
            console.error('Unmark error:', error);
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
