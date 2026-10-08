import QRCode from 'qrcode';
import { requestMobileTransfer } from '../services/mobile-transfer-client.js';

function showStatus(state, message) {
    state.status.textContent = message;
}

async function closeTransfer(state) {
    if (!state.transfer) return;
    const id = state.transfer.id;
    state.transfer = null;
    try { await requestMobileTransfer(`/api/staff/mobile-transfers/${id}`, { method: 'DELETE' }); }
    catch (error) { console.warn('Temporary transfer close failed.', { errorName: error.name }); }
}

async function importPhoto(state, file) {
    const path = `/api/staff/mobile-transfers/${state.transfer.id}/files/${file.id}`;
    if (!state.received.has(file.id)) {
        const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: state.lifecycle.signal });
        if (!response.ok) throw new Error('Fotoğraf PC’ye alınamadı; bağlantıyı kontrol edin.');
        const blob = await response.blob();
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
            await closeTransfer(state);
            state.button.disabled = false;
            showStatus(state, 'QR süresi doldu. Yeni QR açabilirsiniz.');
            return;
        }
        const payload = await requestMobileTransfer(`/api/staff/mobile-transfers/${state.transfer.id}`);
        for (const file of payload.files) await importPhoto(state, file);
    } catch (error) {
        if (!state.lifecycle.signal.aborted) {
            console.warn('Phone photo polling failed.', { errorName: error.name });
            showStatus(state, `${error.message} Bağlantı düzelince tekrar denenecek.`);
        }
    } finally { state.isPolling = false; }
}

async function openPairing(state) {
    state.button.disabled = true;
    try {
        await closeTransfer(state);
        state.transfer = await requestMobileTransfer('/api/staff/mobile-transfers', { method: 'POST' });
        if (!state.container.isConnected) return closeTransfer(state);
        const url = `${location.origin}/mobile-transfer/#${state.transfer.claimToken}`;
        const canvas = document.createElement('canvas');
        await QRCode.toCanvas(canvas, url, { width: 240, margin: 2 });
        state.qr.replaceChildren(canvas);
        showStatus(state, 'Telefonla okutun. 15 dakika geçerli; fotoğraflar bu listeye gelir.');
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
    hint.textContent = 'Gönderim bitene kadar telefon sayfasını ve bilgisayardaki PDF penceresini açık tutun. QR bağlantısı 15 dakika geçerlidir.';
    instructions.append(title, steps, hint);
    return instructions;
}

function createPanelState(container, receiveFiles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-outline';
    button.textContent = '📱 Telefondan ekle (QR)';
    const qr = document.createElement('div');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.style.textAlign = qr.style.textAlign = 'center';
    container.append(createTransferInstructions(), button, qr, status);
    return { container, receiveFiles, button, qr, status, transfer: null,
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
    state.button.addEventListener('click', () => openPairing(state));
    const timer = setInterval(() => pollPhotos(state), 2000);
    const observer = new MutationObserver(() => {
        if (!container.isConnected) {
            observer.disconnect();
            state.lifecycle.abort();
            void closeTransfer(state);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    state.lifecycle.signal.addEventListener('abort', () => clearInterval(timer), { once: true });
}
