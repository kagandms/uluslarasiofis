import QRCode from 'qrcode';
import { mobileTransferSession } from '../services/mobile-transfer-session.js';

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
    if (state.isOpening || state.lifecycle.signal.aborted) return;
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
        if (!state.container.isConnected || state.lifecycle.signal.aborted) return closeBatch(state, state.batchId);
        await renderPairing(state);
    } catch (error) {
        console.error('Transfer activation failed.', { errorName: error.name, code: error.code });
        state.button.disabled = false;
        showBatchError(state, error);
    } finally { state.isOpening = false; }
}

async function importPhoto(state, file) {
    const path = `/api/staff/mobile-transfers/${state.transfer.id}/files/${file.id}`;
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: state.lifecycle.signal });
    if (!response.ok) throw new Error('Fotoğraf PC’ye alınamadı; bağlantıyı kontrol edin.');
    const blob = await response.blob();
    if (state.lifecycle.signal.aborted) return;
    state.receiveFiles([new File([blob], `Telefondan_${file.id}.jpg`, { type: 'image/jpeg' })]);
    await state.session.consumePhoto(state.transfer.id, state.batchId, file.id);
    state.received.add(file.id);
    showStatus(state, `${state.received.size} fotoğraf PC’ye alındı. Listeyi kontrol edin.`);
}

async function pollPhotos(state) {
    if (state.isPolling || !state.transfer || !state.batchId || !state.container.isConnected) return;
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
        for (const file of payload.files) {
            if (state.lifecycle.signal.aborted || state.batchId !== payload.batchId) break;
            await importPhoto(state, file);
        }
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
    hint.textContent = 'Telefon bağlantısı QR oluşturulduktan sonra 1 saat sürer. Öğrenci değişince eski seçili fotoğrafları telefondan kaldırın.';
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
    container.append(button, discardButton, qrSection, status, createTransferInstructions());
    return { container, receiveFiles, session, button, discardButton, qr, countdown, status, transfer: null, batchId: null,
        countdownTimer: null, received: new Set(), lifecycle: new AbortController(), isPolling: false, isOpening: false };
}

/** Connects a phone to the active student batch and reuses its paired session between modal instances. */
export function mountMobileTransferPanel(container, receiveFiles, session = mobileTransferSession) {
    const state = createPanelState(container, receiveFiles, session);
    const openQr = () => openPairing(state);
    const discardPending = () => openPairing(state, { discardPending: true });
    const refreshCountdown = () => updateCountdown(state);
    state.button.addEventListener('click', openQr);
    state.discardButton.addEventListener('click', discardPending);
    document.addEventListener('visibilitychange', refreshCountdown);
    const timer = setInterval(() => pollPhotos(state), 2000);
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
        document.removeEventListener('visibilitychange', refreshCountdown);
    }, { once: true });
    if (state.session.getSnapshot().transfer?.expiresAt * 1000 > Date.now()) void openPairing(state);
}
