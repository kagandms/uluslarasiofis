import QRCode from 'qrcode';
import { mobileTransferSession } from '../services/mobile-transfer-session.js';

const PHOTO_POLL_INTERVAL_MS = 3000;
const PHOTO_DOWNLOAD_CONCURRENCY = 2;

function showStatus(state, message) {
    state.status.textContent = message;
}

function stopCountdown(state) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
}

function updateCountdown(state) {
    if (!state.transfer || state.lifecycle.signal.aborted) return;
    const remainingSeconds = Math.max(0, Math.ceil((state.transfer.expiresAt * 1000 - Date.now()) / 1000));
    state.countdown.hidden = false;
    state.countdown.style.color = remainingSeconds <= 300 ? '#a16207' : '#6b7280';
    if (remainingSeconds === 0) {
        stopCountdown(state);
        state.countdown.textContent = 'QR süresi doldu';
        state.qr.replaceChildren();
        state.button.disabled = false;
        state.button.textContent = '📱 Yeni QR oluştur';
        showStatus(state, 'QR süresi doldu. Yeni QR açabilirsiniz.');
        return;
    }
    const minutes = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
    const seconds = String(remainingSeconds % 60).padStart(2, '0');
    state.countdown.textContent = `QR kalan süre: ${minutes}:${seconds}`;
}

function startCountdown(state) {
    stopCountdown(state);
    updateCountdown(state);
    if (state.transfer.expiresAt * 1000 > Date.now()) {
        state.countdownTimer = setInterval(() => updateCountdown(state), 1000);
    }
}

async function closeBatch(state, batchId) {
    if (!batchId) return;
    try { await state.session.closeBatch(batchId); }
    catch (error) { console.warn('Temporary transfer batch close failed.', { errorName: error.name }); }
}

function hideClaimQr(state) {
    state.qr.replaceChildren();
    state.button.disabled = true;
    state.button.textContent = '📱 Telefon bağlı';
    showStatus(state, 'Telefon bağlı. Yeni öğrenci için QR’ı tekrar okutmanız gerekmez.');
}

async function renderPairing(state) {
    try { await state.session.readPhotos(); }
    catch (error) { console.warn('Phone pairing status could not be loaded.', { errorName: error.name }); }
    const snapshot = state.session.getSnapshot();
    state.transfer = snapshot.transfer;
    state.batchId = snapshot.batchId;
    if (!state.transfer || !state.batchId) return;
    if (snapshot.isPhonePaired) {
        hideClaimQr(state);
        startCountdown(state);
        return;
    }
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, `${location.origin}/mobile-transfer/#${state.transfer.claimToken}`, { width: 240, margin: 2 });
    if (!state.container.isConnected || state.lifecycle.signal.aborted) return closeBatch(state, state.batchId);
    state.qr.replaceChildren(canvas);
    state.button.disabled = false;
    state.button.textContent = '📱 QR hazır';
    showStatus(state, 'Telefonla bir kez okutun. Aynı telefon bu QR süresi boyunca bağlı kalır.');
    startCountdown(state);
}

function showBatchError(state, error) {
    showStatus(state, error.message);
    if (error.code !== 'BATCH_PENDING_PHOTOS') return;
    state.discardButton.hidden = false;
    state.button.disabled = true;
}

async function openPairing(state, options = {}) {
    if (state.isOpening || state.isClosing || state.lifecycle.signal.aborted) return;
    const current = state.session.getSnapshot();
    if (!options.discardPending && current.transfer?.expiresAt * 1000 > Date.now() && state.batchId) {
        await renderPairing(state);
        return;
    }
    state.isOpening = true;
    state.button.disabled = true;
    state.discardButton.hidden = true;
    state.qr.replaceChildren();
    try {
        const activated = await state.session.activateBatch(options);
        state.transfer = activated.transfer;
        state.batchId = activated.batchId;
        state.endButton.hidden = false;
        state.endHint.hidden = false;
        if (!state.container.isConnected || state.lifecycle.signal.aborted) return closeBatch(state, state.batchId);
        await renderPairing(state);
    } catch (error) {
        console.error('Transfer activation failed.', { errorName: error.name, code: error.code });
        state.button.disabled = false;
        showBatchError(state, error);
    } finally { state.isOpening = false; }
}

function resetClosedTransfer(state) {
    stopCountdown(state);
    state.transfer = null;
    state.batchId = null;
    state.received.clear();
    state.qr.replaceChildren();
    state.countdown.hidden = state.endButton.hidden = state.discardButton.hidden = true;
    state.endHint.hidden = true;
    state.button.textContent = '📱 Yeni QR oluştur';
    showStatus(state, 'QR bağlantısı bitirildi. Yeniden bağlanmak için yeni QR oluşturun.');
}

async function endTransfer(state) {
    if (state.isClosing || state.isOpening || !state.transfer || state.lifecycle.signal.aborted) return;
    if (state.isPolling) {
        showStatus(state, 'Fotoğraf kontrolü veya alımı sürüyor. Tamamlandıktan sonra bağlantıyı bitirin.');
        return;
    }
    state.isClosing = state.button.disabled = state.endButton.disabled = true;
    try {
        await state.session.closeTransfer();
        if (!state.lifecycle.signal.aborted) resetClosedTransfer(state);
    } catch (error) {
        console.warn('Phone transfer close failed.', { errorName: error.name, code: error.code });
        if (!state.lifecycle.signal.aborted) showStatus(state, `${error.message} Bağlantı kapatılmadı.`);
    } finally {
        state.isClosing = state.endButton.disabled = false;
        state.button.disabled = Boolean(state.transfer && state.session.getSnapshot().isPhonePaired);
    }
}

async function downloadPhoto(state, file) {
    const path = `/api/staff/mobile-transfers/${state.transfer.id}/files/${file.id}`;
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: state.lifecycle.signal });
    if (!response.ok) throw new Error('Fotoğraf PC’ye alınamadı; bağlantıyı kontrol edin.');
    const blob = await response.blob();
    if (state.lifecycle.signal.aborted) return null;
    return new File([blob], `Telefondan_${file.id}.jpg`, { type: 'image/jpeg' });
}

async function importPhoto(state, file, importedFile) {
    if (!importedFile || state.lifecycle.signal.aborted) return;
    Object.defineProperty(importedFile, 'isValidatedTransferPhoto', { value: true });
    state.receiveFiles([importedFile]);
    await state.session.consumePhoto(state.transfer.id, state.batchId, file.id);
    state.received.add(file.id);
    showStatus(state, `${state.received.size} fotoğraf PC’ye alındı. Listeyi kontrol edin.`);
}

async function importPhotos(state, files) {
    for (let offset = 0; offset < files.length; offset += PHOTO_DOWNLOAD_CONCURRENCY) {
        const batch = files.slice(offset, offset + PHOTO_DOWNLOAD_CONCURRENCY);
        const downloads = await Promise.allSettled(batch.map(async file => ({ file, importedFile: await downloadPhoto(state, file) })));
        for (const download of downloads) {
            if (download.status === 'rejected') throw download.reason;
            await importPhoto(state, download.value.file, download.value.importedFile);
        }
    }
}

async function pollPhotos(state) {
    if (state.isPolling || state.isClosing || !state.transfer || !state.batchId || !state.container.isConnected) return;
    state.isPolling = true;
    try {
        if (state.transfer.expiresAt * 1000 <= Date.now()) {
            updateCountdown(state);
            return;
        }
        const payload = await state.session.readPhotos({ signal: state.lifecycle.signal });
        if (payload.phonePaired) hideClaimQr(state);
        if (payload.batchId !== state.batchId) {
            showStatus(state, 'Öğrenci aktarım partisi değişti. Bu pencereyi yenileyin.');
            return;
        }
        if (!state.lifecycle.signal.aborted && state.batchId === payload.batchId) await importPhotos(state, payload.files);
    } catch (error) {
        if (!state.lifecycle.signal.aborted) {
            console.warn('Phone photo polling failed.', { errorName: error.name });
            showStatus(state, `${error.message} Bağlantı düzelince tekrar denenecek.`);
        }
    } finally { state.isPolling = false; }
}

function createTransferInstructions() {
    const instructions = document.createElement('details');
    instructions.className = 'transfer-instructions';
    instructions.open = false;
    const title = document.createElement('summary');
    title.textContent = 'QR ile fotoğraf nasıl gönderilir?';
    const steps = document.createElement('ol');
    for (const text of [
        'QR’ı telefonla bir kez okutun; telefon sayfasını açık bırakın.',
        'Her öğrenci penceresi açıkken o öğrencinin fotoğraflarını çekin veya galeriden seçin.',
        'Fotoğrafları kontrol edip “Bilgisayara gönder” tuşuna basın.',
        'Bilgisayardaki listeyi kontrol edin. PDF’yi oluşturup indirin.'
    ]) {
        const step = document.createElement('li');
        step.textContent = text;
        steps.append(step);
    }
    const hint = document.createElement('p');
    hint.textContent = 'Telefon bağlantısı QR oluşturulduktan sonra 1 saat sürer. İşiniz bitince “QR bağlantısını bitir” ile kapatın; tekrar bağlanmak için yeni QR gerekir. Öğrenci değişince eski seçili fotoğrafları telefondan kaldırın.';
    instructions.append(title, steps, hint);
    return instructions;
}

function createPanelState(container, receiveFiles, session) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-outline';
    button.textContent = '📱 Telefondan ekle (QR)';
    const discardButton = document.createElement('button');
    discardButton.type = 'button';
    discardButton.className = 'btn btn-outline';
    discardButton.textContent = 'Bekleyen fotoğrafları silip devam et';
    discardButton.hidden = true;
    const endButton = document.createElement('button');
    endButton.type = 'button';
    endButton.className = 'btn btn-outline';
    endButton.textContent = 'QR bağlantısını bitir';
    endButton.dataset.action = 'end-transfer';
    endButton.hidden = true;
    const endHint = document.createElement('small');
    endHint.className = 'transfer-end-hint';
    endHint.textContent = 'İşiniz bittiyse bağlantıyı kapatın.';
    endHint.style.color = '#6b7280';
    endHint.hidden = true;
    const qr = document.createElement('div');
    qr.className = 'transfer-qr';
    const countdown = document.createElement('small');
    countdown.className = 'transfer-countdown';
    countdown.hidden = true;
    countdown.style.textAlign = 'center';
    countdown.style.fontSize = '0.8rem';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.style.textAlign = qr.style.textAlign = 'center';
    const qrSection = document.createElement('div');
    qrSection.className = 'transfer-qr-section';
    qrSection.style.textAlign = 'center';
    qrSection.append(qr, countdown);
    container.append(button, discardButton, endButton, endHint, qrSection, status, createTransferInstructions());
    return { container, receiveFiles, session, button, discardButton, endButton, endHint, qr, countdown, status, transfer: null, batchId: null,
        countdownTimer: null, received: new Set(), lifecycle: new AbortController(), isPolling: false, isOpening: false, isClosing: false };
}

/** Connects a phone to the active student batch and reuses its paired session between modal instances. */
export function mountMobileTransferPanel(container, receiveFiles, session = mobileTransferSession) {
    const state = createPanelState(container, receiveFiles, session);
    const openQr = () => openPairing(state);
    const discardPending = () => openPairing(state, { discardPending: true });
    const endConnection = () => endTransfer(state);
    const refreshCountdown = () => updateCountdown(state);
    state.button.addEventListener('click', openQr);
    state.discardButton.addEventListener('click', discardPending);
    state.endButton.addEventListener('click', endConnection);
    document.addEventListener('visibilitychange', refreshCountdown);
    const timer = setInterval(() => pollPhotos(state), PHOTO_POLL_INTERVAL_MS);
    const observer = new MutationObserver(() => {
        if (container.isConnected) return;
        observer.disconnect();
        const batchId = state.batchId;
        state.lifecycle.abort();
        void closeBatch(state, batchId);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    state.lifecycle.signal.addEventListener('abort', () => {
        clearInterval(timer);
        stopCountdown(state);
        state.button.removeEventListener('click', openQr);
        state.discardButton.removeEventListener('click', discardPending);
        state.endButton.removeEventListener('click', endConnection);
        document.removeEventListener('visibilitychange', refreshCountdown);
    }, { once: true });
    if (state.session.getSnapshot().transfer?.expiresAt * 1000 > Date.now()) void openPairing(state);
}
