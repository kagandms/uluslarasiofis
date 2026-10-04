document.addEventListener('DOMContentLoaded', () => {
    const btnAcceptance = document.getElementById('btn-read-acceptance');
    const btnCopy = document.getElementById('btn-copy');
    const statusMessage = document.getElementById('status-message');

    if (!btnAcceptance || !btnCopy || !statusMessage) return;

    let statusTimer = null;

    function showStatus(message, type = 'info') {
        statusMessage.textContent = message;
        statusMessage.dataset.status = type;
        if (statusTimer) clearTimeout(statusTimer);
        statusTimer = setTimeout(() => {
            statusMessage.textContent = 'Bekleniyor...';
            statusMessage.dataset.status = 'info';
        }, 6_000);
    }

    function createRequestId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function sendMessage(message) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    const runtimeError = chrome.runtime.lastError;
                    if (runtimeError) {
                        resolve({ success: false, error: runtimeError.message });
                        return;
                    }
                    resolve(response || { success: false, error: 'Eklentiden yanıt alınamadı.' });
                });
            } catch (error) {
                resolve({ success: false, error: error.message });
            }
        });
    }

    function setBusy(button, busy) {
        button.disabled = busy;
        button.classList.toggle('is-loading', busy);
    }

    async function copyToClipboard(value) {
        if (!value) return;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
                return;
            }
            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        } catch (_) {
            // Clipboard izinleri kapalıysa YÖKSİS aktarımı yine tamamlanabilir.
        }
    }

    btnAcceptance.addEventListener('click', async () => {
        setBusy(btnAcceptance, true);
        showStatus('Kabul mektubu okunuyor ve YÖKSİS aranıyor...', 'info');
        const response = await sendMessage({
            action: 'READ_ACCEPTANCE_AND_FILL_YOKSIS',
            requestId: createRequestId('acceptance')
        });
        setBusy(btnAcceptance, false);

        if (!response?.success) {
            showStatus(`Hata: ${response?.error || response?.message || 'Kabul mektubu okunamadı.'}`, 'error');
            return;
        }

        await copyToClipboard(response.kabulId);
        const filled = response.autoFilled ? ' Bilgiler de YÖKSİS’e dolduruldu.' : '';
        showStatus(`Kabul kodu kopyalandı ve YÖKSİS’te aratıldı.${filled}`, 'success');
    });

    btnCopy.addEventListener('click', async () => {
        setBusy(btnCopy, true);
        showStatus('Apply bilgileri ve pasaport belgesi hazırlanıyor...', 'info');
        const response = await sendMessage({
            action: 'COPY_APPLY_DATA_AND_FILL_YOKSIS',
            requestId: createRequestId('student')
        });
        setBusy(btnCopy, false);

        if (!response?.success) {
            showStatus(`Hata: ${response?.error || response?.message || 'Bilgiler kopyalanamadı.'}`, 'error');
            return;
        }

        if (!response.cropperOpened && response.manualPhotoRequired) {
            const message = response.autoFilled
                ? 'Pasaport bulunamadı; diğer bilgiler YÖKSİS’e aktarıldı. Fotoğrafı YÖKSİS’te elle yükleyin.'
                : (response.message || 'Pasaport bulunamadı. Bilgiler hazırlandı; fotoğrafı YÖKSİS’te elle yükleyin.');
            showStatus(message, response.autoFilled ? 'warning' : 'info');
            return;
        }

        const missing = response.passportMetadata?.missingFields || [];
        const warning = missing.length > 0 ? ` Bazı pasaport alanları okunamadı: ${missing.join(', ')}.` : '';
        showStatus(`Pasaport fotoğrafı kırpma ekranı açıldı.${warning}`, missing.length > 0 ? 'warning' : 'success');
        if (response.cropperOpened) window.close();
    });
});
