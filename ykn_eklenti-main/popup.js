document.addEventListener('DOMContentLoaded', () => {
    const btnCopy = document.getElementById('btn-copy');
    const btnSearch = document.getElementById('btn-search');
    const btnFill = document.getElementById('btn-fill');
    const statusMessage = document.getElementById('status-message');
    const kabulIdInput = document.getElementById('kabul-id-input');

    // Kabul ID'yi mevcut grup yapısını koruyarak biçimlendir.
    // Önceki sabit XXX-XXX-XX maskesi AB-123-CD gibi geçerli kodları bozuyordu.
    kabulIdInput.addEventListener('input', function (e) {
        const raw = e.target.value.toUpperCase().replace(/[–—−]/g, '-');
        const sanitized = raw.replace(/[^A-Z0-9\-\s]/g, '');
        if (sanitized.includes('-')) {
            const endsWithSeparator = /-\s*$/.test(sanitized);
            const groups = sanitized.split(/\s*-\s*/).slice(0, 3)
                .map((part) => part.replace(/\s+/g, '').replace(/[^A-Z0-9]/g, ''));
            e.target.value = groups.join('-') + (endsWithSeparator ? '-' : '');
            return;
        }

        // Tired without separators: the common YÖKSİS 3-3-2 form is
        // inferred only when its length is unambiguous; other valid group
        // lengths are left intact instead of being corrupted.
        const compact = sanitized.replace(/\s+/g, '');
        e.target.value = compact.length === 8
            ? `${compact.slice(0, 3)}-${compact.slice(3, 6)}-${compact.slice(6)}`
            : compact;
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
