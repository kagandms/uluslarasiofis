document.addEventListener('DOMContentLoaded', () => {
    const btnCopy = document.getElementById('btn-copy');
    const btnSearch = document.getElementById('btn-search');
    const btnFill = document.getElementById('btn-fill');
    const statusMessage = document.getElementById('status-message');
    const kabulIdInput = document.getElementById('kabul-id-input');

    // Kabul ID Otomatik Formatlama (XXX-XXX-XX)
    kabulIdInput.addEventListener('input', function (e) {
        // Sadece harf ve rakamları tut, büyük harfe çevir
        let val = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        
        let formatted = '';
        if (val.length > 0) formatted += val.substring(0, 3);
        if (val.length > 3) formatted += '-' + val.substring(3, 6);
        if (val.length > 6) formatted += '-' + val.substring(6, 8);
        
        e.target.value = formatted;
    });

    function showStatus(message, duration = 3000) {
        statusMessage.textContent = message;
        setTimeout(() => {
            statusMessage.textContent = 'Bekleniyor...';
        }, duration);
    }

    async function findTab(domain) {
        // Tüm sekmeleri al
        let allTabs = await chrome.tabs.query({});
        // URL'si domain'i içeren ilk sekmeyi bul
        return allTabs.find(t => t.url && t.url.includes(domain));
    }

    // 1. Verileri Kopyala
    btnCopy.addEventListener('click', async () => {
        try {
            let sourceTab = await findTab("apply.topkapi.edu.tr");
            if (!sourceTab) {
                showStatus("Hata: Açık bir Topkapı (Kaynak) sekmesi bulunamadı!");
                return;
            }
            
            chrome.tabs.sendMessage(sourceTab.id, { action: "copyData" }, (response) => {
                if (chrome.runtime.lastError) {
                    showStatus("Hata: Sayfayı yenileyin (F5).");
                    return;
                }
                if (response && response.success) {
                    showStatus("Tüm veriler kopyalandı (Pasaport dahil)!");
                } else {
                    showStatus("Veriler kopyalanamadı: " + (response ? response.message : ""));
                }
            });
        } catch (error) {
            showStatus("Beklenmeyen bir hata oluştu.");
        }
    });

    // 2. Kabul ID ile Sorgula
    btnSearch.addEventListener('click', async () => {
        const kabulId = kabulIdInput.value.trim();
        if (!kabulId) {
            showStatus("Lütfen Kabul ID girin!");
            return;
        }

        try {
            let yoksisTab = await findTab("yoksis.yok.gov.tr");
            if (!yoksisTab) {
                showStatus("Hata: Açık bir YÖKSİS sekmesi bulunamadı!");
                return;
            }
            
            chrome.tabs.sendMessage(yoksisTab.id, { action: "searchWithId", kabulId: kabulId }, (response) => {
                if (chrome.runtime.lastError) {
                    showStatus("Hata: YÖKSİS sayfasını yenileyin (F5).");
                    return;
                }
                if (response && response.success) {
                    showStatus("Sorgulama başlatıldı!");
                    chrome.tabs.update(yoksisTab.id, { active: true });
                } else {
                    showStatus("Hata: " + (response ? response.message : "Bilinmeyen hata"));
                }
            });
        } catch (error) {
            showStatus("Beklenmeyen bir hata oluştu.");
        }
    });

    // 3. Kalan Bilgileri Doldur
    btnFill.addEventListener('click', async () => {
        try {
            let yoksisTab = await findTab("yoksis.yok.gov.tr");
            if (!yoksisTab) {
                showStatus("Hata: Açık bir YÖKSİS sekmesi bulunamadı!");
                return;
            }
            
            chrome.tabs.sendMessage(yoksisTab.id, { action: "fillRemainingData" }, (response) => {
                if (chrome.runtime.lastError) {
                    showStatus("Hata: YÖKSİS sayfasını yenileyin (F5).");
                    return;
                }
                if (response && response.success) {
                    try {
                        chrome.runtime.sendMessage({ action: 'SYNC_YOKSIS_MAIN_WORLD' });
                    } catch (_) {}
                    showStatus("Bilgiler başarıyla dolduruldu!");
                    chrome.tabs.update(yoksisTab.id, { active: true });
                } else {
                    showStatus("Hata: " + (response ? response.message : "Bilinmeyen hata"));
                }
            });
        } catch (error) {
            showStatus("Beklenmeyen bir hata oluştu.");
        }
    });
});
