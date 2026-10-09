import QRCode from 'qrcode';
import { requestMobileTransfer } from '../services/mobile-transfer-client.js';

function showStatus(state, message) {
    state.status.textContent = message;
}

/** @param {object} state Panel state. @returns {void} Releases the local countdown timer. */
function stopCountdown(state) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
}

/** @param {object} state Panel state. @returns {void} Renders the server deadline against the current clock. */
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

/** @param {object} state Panel state. @returns {void} Starts one local timer for the current QR. */
function startCountdown(state) {
    stopCountdown(state);
    updateCountdown(state);
    if (state.transfer.expiresAt * 1000 > Date.now()) {
        state.countdownTimer = setInterval(() => updateCountdown(state), 1000);
    }
}

async function closeTransfer(state) {
    stopCountdown(state);
    if (!state.transfer) return;
    const id = state.transfer.id;
    state.transfer = null;
    try { await requestMobileTransfer(`/api/staff/mobile-transfers/${id}`, { method: 'DELETE' }); }
    catch (error) { console.warn('Temporary transfer close failed.', { errorName: error.name }); }
}

async function importPhoto(state, { file, transferId }) {
    const path = `/api/staff/mobile-transfers/${transferId}/files/${file.id}`;
    if (!state.received.has(file.id)) {
        const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: state.lifecycle.signal });
        if (!response.ok) throw new Error('Fotoğraf PC’ye alınamadı; bağlantıyı kontrol edin.');
        const blob = await response.blob();
        if (state.lifecycle.signal.aborted) return;
        state.receiveFiles([new File([blob], `Telefondan_${file.id}.jpg`, { type: 'image/jpeg' })]);
        state.received.add(file.id);
    }
    await requestMobileTransfer(path, { method: 'DELETE' });
    showStatus(state, `${state.received.size} fotoğraf PC’ye alındı. Listeyi kontrol edin.`);
}

async function pollPhotos(state) {
    if (state.isPolling || !state.transfer || !state.container.isConnected) return;
    state.isPolling = true;
    try {
        if (state.transfer.expiresAt * 1000 <= Date.now()) {
            updateCountdown(state);
            return;
        }
        const transferId = state.transfer.id;
        const payload = await requestMobileTransfer(`/api/staff/mobile-transfers/${transferId}`, { signal: state.lifecycle.signal });
        for (const file of payload.files) {
            if (state.lifecycle.signal.aborted || state.transfer?.id !== transferId) break;
            await importPhoto(state, { file, transferId });
        }
    } catch (error) {
        if (!state.lifecycle.signal.aborted) {
            console.warn('Phone photo polling failed.', { errorName: error.name });
            showStatus(state, `${error.message} Bağlantı düzelince tekrar denenecek.`);
        }
    } finally { state.isPolling = false; }
}

async function openPairing(state) {
    state.button.disabled = true;
    state.qr.replaceChildren();
    state.countdown.hidden = true;
    try {
        await closeTransfer(state);
        if (state.lifecycle.signal.aborted) return;
        state.transfer = await requestMobileTransfer('/api/staff/mobile-transfers', { method: 'POST', signal: state.lifecycle.signal });
        if (!state.container.isConnected) return closeTransfer(state);
        const url = `${location.origin}/mobile-transfer/#${state.transfer.claimToken}`;
        const canvas = document.createElement('canvas');
        await QRCode.toCanvas(canvas, url, { width: 240, margin: 2 });
        if (!state.container.isConnected) return closeTransfer(state);
        state.qr.replaceChildren(canvas);
        showStatus(state, 'Telefonla okutun. 1 saat geçerli; fotoğraflar bu listeye gelir.');
        startCountdown(state);
    } catch (error) {
        console.error('Transfer creation failed.', { errorName: error.name });
        showStatus(state, error.message);
        state.button.disabled = false;
    }
}

/** @returns {HTMLDetailsElement} Short instructions for phone photo transfer. */
function createTransferInstructions() {
    const instructions = document.createElement('details');
    instructions.className = 'transfer-instructions';
    instructions.open = true;
    const title = document.createElement('summary');
    title.textContent = 'QR ile fotoğraf nasıl gönderilir?';
    const steps = document.createElement('ol');
    for (const text of [
        '“Telefondan ekle (QR)” tuşuna basın ve çıkan QR’ı telefonun kamerasıyla okutun.',
        'Telefonda açılan sayfada fotoğraf çekin veya galeriden seçin.',
        'Fotoğrafları kontrol edip “Bilgisayara gönder” tuşuna basın.',
        'Bilgisayardaki listeyi kontrol edin. PDF’yi oluşturup indirin.'
    ]) {
        const step = document.createElement('li');
        step.textContent = text;
        steps.append(step);
    }
    const hint = document.createElement('p');
    hint.textContent = 'Gönderim bitene kadar telefon sayfasını ve bilgisayardaki PDF penceresini açık tutun. QR bağlantısı 1 saat geçerlidir.';
    instructions.append(title, steps, hint);
    return instructions;
}

function createPanelState(container, receiveFiles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-outline';
    button.textContent = '📱 Telefondan ekle (QR)';
    const qr = document.createElement('div');
    const countdown = document.createElement('small');
    countdown.className = 'transfer-countdown';
    countdown.hidden = true;
    countdown.style.textAlign = 'center';
    countdown.style.fontSize = '0.8rem';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.style.textAlign = qr.style.textAlign = 'center';
    const qrSection = document.createElement('div');
    qrSection.style.textAlign = 'center';
    qrSection.append(qr, countdown);
    container.append(createTransferInstructions(), button, qrSection, status);
    return { container, receiveFiles, button, qr, countdown, status, transfer: null, countdownTimer: null,
        received: new Set(), lifecycle: new AbortController(), isPolling: false };
}

/**
 * Connects a phone to this staff PDF merger and imports completed photos.
 * @param {HTMLElement} container Panel host.
 * @param {(files: File[]) => void} receiveFiles Photo import callback.
 * @returns {void} Adds the pairing button and lifecycle cleanup.
 */
export function mountMobileTransferPanel(container, receiveFiles) {
    const state = createPanelState(container, receiveFiles);
    const openQr = () => openPairing(state);
    const refreshCountdown = () => updateCountdown(state);
    state.button.addEventListener('click', openQr);
    document.addEventListener('visibilitychange', refreshCountdown);
    const timer = setInterval(() => pollPhotos(state), 2000);
    const observer = new MutationObserver(() => {
        if (!container.isConnected) {
            observer.disconnect();
            state.lifecycle.abort();
            void closeTransfer(state);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    state.lifecycle.signal.addEventListener('abort', () => {
        clearInterval(timer);
        stopCountdown(state);
        state.button.removeEventListener('click', openQr);
        document.removeEventListener('visibilitychange', refreshCountdown);
    }, { once: true });
}
