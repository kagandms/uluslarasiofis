const CLOUD_SYNC_TIMEOUT_MS = 90_000;
const CLOUD_SYNC_PROGRESS_INTERVAL_MS = 1_000;

// In-Memory Normalized Cache for 0 ms Instant Search
let inMemoryCache = [];
let isCacheLoaded = false;

function parseDateStr(sayfaStr) {
    if (!sayfaStr) return 0;
    const match = sayfaStr.match(/(\d{2})\.(\d{2})(?:\.(\d{4}))?/);
    if (!match) return 0;
    const d = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const y = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
    return y * 10000 + m * 100 + d;
}

function getSheetYear(sheetName) {
    if (!sheetName) return String(new Date().getFullYear());
    const match = sheetName.match(/(?:^|\.)(\d{4})(?:$|\.)/);
    return match ? match[1] : String(new Date().getFullYear());
}

export function foldText(str) {
    if (!str) return '';
    return String(str)
        .toLocaleUpperCase('tr-TR')
        .replace(/İ/g, 'I')
        .replace(/I/g, 'I')
        .replace(/Ç/g, 'C')
        .replace(/Ş/g, 'S')
        .replace(/Ğ/g, 'G')
        .replace(/Ü/g, 'U')
        .replace(/Ö/g, 'O')
        .replace(/[^A-Z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function fastLevenshtein(a, b, maxDist = 2) {
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > maxDist) return maxDist + 1;
    if (la === 0) return lb;
    if (lb === 0) return la;

    let prev = new Int32Array(lb + 1);
    let curr = new Int32Array(lb + 1);

    for (let j = 0; j <= lb; j++) prev[j] = j;

    for (let i = 1; i <= la; i++) {
        curr[0] = i;
        let minInRow = curr[0];
        const ca = a.charCodeAt(i - 1);

        for (let j = 1; j <= lb; j++) {
            const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
            const ins = prev[j] + 1;
            const del = curr[j - 1] + 1;
            const sub = prev[j - 1] + cost;
            let val = ins < del ? (ins < sub ? ins : sub) : (del < sub ? del : sub);
            curr[j] = val;
            if (val < minInRow) minInRow = val;
        }

        if (minInRow > maxDist) return maxDist + 1;
        const tmp = prev;
        prev = curr;
        curr = tmp;
    }

    return prev[lb];
}

function evaluateNameMatch(record, queryUpper, queryFolded, queryTokens) {
    if (record._upperName.includes(queryUpper)) {
        return { isMatch: true, isExact: true, score: 100 };
    }
    if (record._foldedName.includes(queryFolded)) {
        return { isMatch: true, isExact: true, score: 95 };
    }

    if (!queryFolded || queryFolded.length < 3 || queryTokens.length === 0) {
        return { isMatch: false, isExact: false, score: 0 };
    }

    const candTokens = record._foldedTokens;
    if (!candTokens || candTokens.length === 0) {
        return { isMatch: false, isExact: false, score: 0 };
    }

    let totalEditDist = 0;
    const usedCandIndices = new Set();

    for (let q = 0; q < queryTokens.length; q++) {
        const qTok = queryTokens[q];
        let bestDistForToken = 999;
        let bestCandIdx = -1;

        for (let c = 0; c < candTokens.length; c++) {
            if (usedCandIndices.has(c)) continue;
            const cTok = candTokens[c];

            if (cTok === qTok) {
                bestDistForToken = 0;
                bestCandIdx = c;
                break;
            }
            if (qTok.length >= 3 && cTok.startsWith(qTok)) {
                bestDistForToken = 0;
                bestCandIdx = c;
                break;
            }

            const maxAllowed = qTok.length >= 6 ? 2 : (qTok.length >= 3 ? 1 : 0);
            if (maxAllowed > 0) {
                const dist = fastLevenshtein(qTok, cTok, maxAllowed);
                if (dist <= maxAllowed && dist < bestDistForToken) {
                    bestDistForToken = dist;
                    bestCandIdx = c;
                }
            }
        }

        if (bestCandIdx !== -1) {
            usedCandIndices.add(bestCandIdx);
            totalEditDist += bestDistForToken;
        } else {
            return { isMatch: false, isExact: false, score: 0 };
        }
    }

    return {
        isMatch: true,
        isExact: false,
        score: Math.max(40, 85 - (totalEditDist * 15))
    };
}

function normalizeRecord(r) {
    const rawIsim = r.isim ? String(r.isim) : '';
    const rawSayfa = r.sayfa ? String(r.sayfa) : '';
    const rawNo = r.no !== undefined && r.no !== null ? String(r.no) : '';
    const uniqueId = `${rawSayfa}-${rawIsim}-${rawNo}`;
    const isMarkedLocally = localStorage.getItem('tebligat_marked_' + uniqueId) === 'true';
    const isMarked = Boolean(r.isMarked || r.isaretli || isMarkedLocally);
    const folded = foldText(rawIsim);

    return {
        ...r,
        sayfa: rawSayfa,
        isim: rawIsim,
        no: rawNo,
        isaretli: isMarked,
        isMarked: isMarked,
        _uniqueId: uniqueId,
        _upperName: rawIsim.toLocaleUpperCase('tr-TR'),
        _foldedName: folded,
        _foldedTokens: folded.split(' ').filter(Boolean),
        _dateVal: parseDateStr(rawSayfa),
        _year: getSheetYear(rawSayfa),
        _noNum: parseInt(rawNo, 10) || 0
    };
}

function loadCacheIntoMemory() {
    try {
        const cachedStr = localStorage.getItem('tebligat_excel_cache');
        if (cachedStr) {
            const rawArr = JSON.parse(cachedStr);
            if (Array.isArray(rawArr)) {
                inMemoryCache = rawArr.map(normalizeRecord);
                isCacheLoaded = true;
                return inMemoryCache.length;
            }
        }
    } catch (e) {
        console.error('Failed to load in-memory tebligat cache:', e);
    }
    inMemoryCache = [];
    isCacheLoaded = false;
    return 0;
}

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

    const selectedYear = () => yearSelect?.value || '2026';

    // --- CLOUD SYNC CACHE MANTIĞI ---
    const btnSyncCloud = document.getElementById('btn-sync-cloud');
    const cacheStatusText = document.getElementById('cache-status-text');

    // Sayfa açıldığında önbelleği belleğe al ve durum metnini güncelle
    const cachedCount = loadCacheIntoMemory();
    if (cacheStatusText) {
        if (cachedCount > 0) {
            cacheStatusText.innerHTML = `Bulut verisi: <span style="color: var(--success); font-weight: bold;">Güncel (${cachedCount} Kayıt)</span>`;
        } else {
            cacheStatusText.innerHTML = `Bulut verisi: <span style="color: var(--text-secondary);">Henüz güncellenmedi.</span>`;
        }
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
                    const newCount = loadCacheIntoMemory();
                    
                    if (cacheStatusText) {
                        cacheStatusText.innerHTML = `Bulut verisi: <span style="color: var(--success); font-weight: bold;">Güncellendi (${newCount} Kayıt)</span>`;
                    }
                    if (window.showToast) window.showToast('Veritabanı başarıyla cihazınıza senkronize edildi!', 'success');

                    // Eğer arama kutusunda yazı varsa anında yeni verilerle güncelle
                    if (searchInput.value.trim().length >= 2) {
                        runSearch();
                    }
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

    const skeletonHTML = `
        <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px;">
            <div class="skeleton-box" style="height: 20px; width: 60%; border-radius: 4px;"></div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                <div class="skeleton-box" style="height: 16px; width: 30%; border-radius: 4px;"></div>
                <div class="skeleton-box" style="height: 24px; width: 25%; border-radius: 12px;"></div>
            </div>
        </div>
    `;

    let networkDebounceTimeout;
    let networkAbortController;

    // Render fonksiyonu
    const renderResults = (resultsArray, isFinal = false, errorMessage = null, currentQuery = '') => {
        if (resultsArray.length === 0) {
            if (isFinal) {
                searchResults.innerHTML = errorMessage 
                    ? `<div style="color: red; text-align: center;">Hata: ${errorMessage}</div>` 
                    : '<div style="text-align: center; color: var(--text-secondary); padding: 10px;">Sonuç bulunamadı.</div>';
            } else if (!errorMessage) {
                searchResults.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 10px; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; gap: 6px;"><div class="spinner" style="width:12px; height:12px; border-width: 2px;"></div> Sunucuda aranıyor...</div>';
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

        // Sıralama: Tam eşleşmeler önce, sonra benzer eşleşmeler; kendi içlerinde en yeni tarih en üstte
        const reversedResults = uniqueResults.sort((a, b) => {
            const isFuzzyA = Boolean(a._isFuzzy);
            const isFuzzyB = Boolean(b._isFuzzy);
            if (isFuzzyA !== isFuzzyB) return isFuzzyA ? 1 : -1;
            if (isFuzzyA && isFuzzyB && a._score !== b._score) {
                return (b._score || 0) - (a._score || 0);
            }
            const dateA = a._dateVal !== undefined ? a._dateVal : parseDateStr(a.sayfa);
            const dateB = b._dateVal !== undefined ? b._dateVal : parseDateStr(b.sayfa);
            if (dateB !== dateA) {
                return dateB - dateA;
            }
            const noA = a._noNum !== undefined ? a._noNum : (parseInt(a.no, 10) || 0);
            const noB = b._noNum !== undefined ? b._noNum : (parseInt(b.no, 10) || 0);
            return noB - noA;
        });

        const activeQuery = currentQuery || searchInput.value.trim();
        const safeQuery = activeQuery.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
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

            const fuzzyBadge = res._isFuzzy
                ? `<span class="tebligat-fuzzy-badge" style="background: rgba(243, 156, 18, 0.15); color: #d35400; font-size: 0.72rem; font-weight: 600; padding: 2px 7px; border-radius: 6px; margin-left: 8px; display: inline-flex; align-items: center; gap: 3px; vertical-align: middle;">~ Benzer</span>`
                : '';

            const uniqueId = res._uniqueId || `${res.sayfa}-${res.isim}-${res.no || ''}`;
            const isMarkedLocally = localStorage.getItem('tebligat_marked_' + uniqueId) === 'true';
            const isMarked = Boolean(res.isMarked || res.isaretli || isMarkedLocally);

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
                    <div style="font-weight: 600; font-size: 1.1rem; color: var(--text-primary); flex: 1;">${highlightedIsim}${fuzzyBadge}</div>
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
            html += `<div style="text-align: center; color: #e67e22; padding: 10px; font-size: 0.85rem; font-weight: bold;">Uyarı: Canlı sunucuya ulaşılamadı. Yerel önbellekteki kayıtlar listelendi.</div>`;
        } else if (!isFinal) {
            html += `<div style="text-align: center; color: var(--text-secondary); padding: 10px; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; gap: 6px;"><div class="spinner" style="width:12px; height:12px; border-width: 2px;"></div> Sunucuda yeni kayıtlar taranıyor...</div>`;
        }

        searchResults.innerHTML = html;
    };

    // 0 ms Anlık Arama ve Arka Plan Canlı Sorgusu
    const runSearch = () => {
        const query = searchInput.value.trim();
        const queryUpper = query.toLocaleUpperCase('tr-TR');

        if (clearBtn) {
            clearBtn.style.display = query.length > 0 ? 'flex' : 'none';
        }

        clearTimeout(networkDebounceTimeout);
        if (networkAbortController) {
            networkAbortController.abort();
        }

        if (query.length < 2) {
            searchResults.innerHTML = '';
            return;
        }

        const currYear = selectedYear();
        const queryFolded = foldText(query);
        const queryTokens = queryFolded.split(' ').filter(Boolean);

        // 1. ADIM (0 ms - ANINDA): Bellek İçi RAM İndeksinden Tara (Tam ve Benzer Eşleşmeler)
        let exactMatches = [];
        let fuzzyMatches = [];

        if (inMemoryCache.length > 0) {
            for (let i = 0; i < inMemoryCache.length; i++) {
                const item = inMemoryCache[i];
                if (item._year !== currYear) continue;

                const matchResult = evaluateNameMatch(item, queryUpper, queryFolded, queryTokens);
                if (matchResult.isMatch) {
                    if (matchResult.isExact) {
                        exactMatches.push({ ...item, _isFuzzy: false, _score: matchResult.score });
                    } else {
                        fuzzyMatches.push({ ...item, _isFuzzy: true, _score: matchResult.score });
                    }
                }
            }
            exactMatches.sort((a, b) => (b._dateVal - a._dateVal) || (b._noNum - a._noNum));
            fuzzyMatches.sort((a, b) => (b._score - a._score) || (b._dateVal - a._dateVal));
        }

        let localMatches = [...exactMatches, ...fuzzyMatches];

        // Yerel sonuç varsa ANINDA ekrana bas (İskelet animasyonu gösterme!)
        if (localMatches.length > 0) {
            renderResults(localMatches, false, null, query);
        } else if (inMemoryCache.length === 0) {
            // Sadece yerel veri hiç indirilmemişse iskelet göster
            searchResults.innerHTML = skeletonHTML.repeat(3);
        } else {
            // Önbellek var ama bu isimde kayıt yok; sunucu aranıyor bilgisi ver
            renderResults([], false, null, query);
        }

        // 2. ADIM (500 ms Debounced): Arka Planda Canlı Sunucu Kontrolü
        networkAbortController = new AbortController();
        networkDebounceTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`/api/search-tebligat?q=${encodeURIComponent(query)}&year=${encodeURIComponent(currYear)}`, {
                    signal: networkAbortController.signal
                });
                const data = await response.json();

                if (data.error) {
                    renderResults(localMatches, true, data.error, query);
                    return;
                }

                if (data.results && data.results.length > 0) {
                    const combined = [...localMatches];
                    const seenKeys = new Set(localMatches.map(m => m.sayfa + '_' + m.no));

                    for (const apiRes of data.results) {
                        if (getSheetYear(apiRes.sayfa) === currYear) {
                            const key = apiRes.sayfa + '_' + apiRes.no;
                            if (!seenKeys.has(key)) {
                                seenKeys.add(key);
                                const norm = normalizeRecord(apiRes);
                                const matchRes = evaluateNameMatch(norm, queryUpper, queryFolded, queryTokens);
                                norm._isFuzzy = !matchRes.isExact;
                                norm._score = matchRes.score || 100;
                                combined.push(norm);
                                inMemoryCache.push(norm); // Gelecek aramalar için belleğe ekle
                            }
                        }
                    }

                    renderResults(combined, true, null, query);
                } else {
                    renderResults(localMatches, true, null, query);
                }
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error('Arka plan canlı arama hatası:', err);
                renderResults(localMatches, true, localMatches.length === 0 ? "Zaman aşımı" : null, query);
            }
        }, 500);
    };

    // Otomatik Büyük Harf Dönüşümü (Türkçe uyumlu: i -> İ, ı -> I) + İmleç Pozisyonunu Koruma
    searchInput.addEventListener('input', () => {
        const rawVal = searchInput.value;
        const upperVal = rawVal.toLocaleUpperCase('tr-TR');
        
        if (rawVal !== upperVal) {
            const start = searchInput.selectionStart;
            const end = searchInput.selectionEnd;
            searchInput.value = upperVal;
            if (start !== null && end !== null) {
                searchInput.setSelectionRange(start, end);
            }
        }
        
        runSearch();
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.style.display = 'none';
            searchResults.innerHTML = '';
            clearTimeout(networkDebounceTimeout);
            if (networkAbortController) {
                networkAbortController.abort();
            }
            searchInput.focus();
        });
    }

    if (yearSelect) {
        yearSelect.addEventListener('change', () => {
            if (searchInput.value.trim().length >= 2) {
                runSearch();
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
                
                // LocalStorage'a kaydet
                const uniqueId = `${sayfa}-${isim}-${no || ''}`;
                localStorage.setItem('tebligat_marked_' + uniqueId, 'true');
                
                // Bellek içi RAM kaydını da güncelle
                const memItem = inMemoryCache.find(x => x._uniqueId === uniqueId);
                if (memItem) {
                    memItem.isaretli = true;
                    memItem.isMarked = true;
                }

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
                
                // Bellek içi RAM kaydını da güncelle
                const memItem = inMemoryCache.find(x => x._uniqueId === uniqueId);
                if (memItem) {
                    memItem.isaretli = false;
                    memItem.isMarked = false;
                }
                
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
