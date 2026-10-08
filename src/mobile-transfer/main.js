import { optimizeDocumentImage } from '../services/optimize-document-image.js';
import { requestMobileTransfer } from '../services/mobile-transfer-client.js';
import { MAX_TRANSFER_FILES } from '../config/mobile-transfer-policy.js';

const status = document.getElementById('status');
const capture = document.getElementById('capture');
const choose = document.getElementById('choose');
const camera = document.getElementById('camera');
const gallery = document.getElementById('gallery');
const send = document.getElementById('send');
const preview = document.getElementById('preview');
let transferId;
let expiresAt = 0;
let pendingPhotos = [];
let isSending = false;
let pairingCode = '';
const checkApproval = document.createElement('button');
checkApproval.type = 'button';
checkApproval.textContent = 'Bilgisayar onayını kontrol et';
checkApproval.hidden = true;
status.after(checkApproval);

/**
 * @param {string} message Human-readable transfer result.
 * @param {string} state Visual status category.
 * @returns {void}
 */
function showTransferStatus(message, state = 'ready') {
    status.textContent = message;
    status.parentElement.dataset.state = state;
}

function renderPending() {
    for (const image of preview.querySelectorAll('img')) URL.revokeObjectURL(image.src);
    preview.replaceChildren();
    pendingPhotos.forEach((photo, index) => {
        const figure = document.createElement('figure');
        const image = document.createElement('img');
        image.src = URL.createObjectURL(photo.file);
        image.alt = `${index + 1}. belge önizlemesi`;
        image.loading = 'lazy';
        image.decoding = 'async';
        const caption = document.createElement('figcaption');
        caption.textContent = `${index + 1}. fotoğraf`;
        figure.append(image, caption);
        preview.append(figure);
    });
    document.getElementById('photo-count').textContent = `${pendingPhotos.length} fotoğraf`;
    document.getElementById('preview-empty').hidden = pendingPhotos.length > 0;
    send.hidden = !pendingPhotos.length;
    send.disabled = isSending;
}

async function pairPhone() {
    try {
        const token = location.hash.slice(1);
        if (token) {
            const paired = await requestMobileTransfer('/api/mobile-transfer/claim', { method: 'POST', body: JSON.stringify({ token }), headers: { 'Content-Type': 'application/json' } });
            transferId = paired.id;
            expiresAt = paired.expires_at;
            pairingCode = paired.pairingCode;
            sessionStorage.setItem('mobileDocumentTransfer', JSON.stringify({ transferId, expiresAt, pairingCode }));
            history.replaceState(null, '', location.pathname);
        } else {
            const paired = JSON.parse(sessionStorage.getItem('mobileDocumentTransfer') || 'null');
            transferId = paired?.transferId;
            expiresAt = paired?.expiresAt || 0;
            pairingCode = paired?.pairingCode || '';
        }
        if (!transferId || expiresAt * 1000 <= Date.now()) throw new Error('PC’den yeni QR açıp okutun.');
        await refreshPhoneApproval();
    } catch (error) {
        console.error('Phone pairing failed.', { errorName: error.name });
        showTransferStatus(error.message, 'error');
    }
}

async function refreshPhoneApproval() {
    try {
        const access = await requestMobileTransfer(`/api/mobile-transfer/${transferId}/status`);
        capture.disabled = choose.disabled = !access.approved;
        checkApproval.hidden = access.approved;
        if (access.approved) {
            pairingCode = '';
            sessionStorage.setItem('mobileDocumentTransfer', JSON.stringify({ transferId, expiresAt }));
        }
        showTransferStatus(access.approved ? 'Bilgisayara bağlandı. Fotoğrafları ekleyebilirsiniz.' : `Eşleştirme kodu: ${pairingCode}. Bu kodu QR’ı açan bilgisayarda onaylayın.`);
    } catch (error) {
        console.warn('Phone approval check failed.', { errorName: error.name });
        showTransferStatus(error.message, 'error');
    }
}

checkApproval.addEventListener('click', refreshPhoneApproval);

function queuePhotos(input) {
    if (isSending) return;
    const files = Array.from(input.files || []);
    if (pendingPhotos.length + files.length > MAX_TRANSFER_FILES) {
        showTransferStatus('Tek aktarımda en fazla 30 fotoğraf gönderilebilir.', 'error');
        return;
    }
    pendingPhotos.push(...files.map(file => ({ file, id: crypto.randomUUID() })));
    input.value = '';
    renderPending();
}

/**
 * @param {{file: File, id: string}} photo Selected photo and retry identity.
 * @returns {Promise<void>}
 * @throws {Error} When optimization or the upload fails.
 */
async function uploadPendingPhoto(photo) {
    const jpeg = await optimizeDocumentImage(photo.file);
    await requestMobileTransfer(`/api/mobile-transfer/${transferId}/photos`, {
        method: 'POST', body: jpeg, headers: { 'Content-Type': 'image/jpeg', 'X-Photo-Id': photo.id }
    });
}

async function sendPhotos() {
    isSending = true;
    capture.disabled = choose.disabled = send.disabled = true;
    try {
        while (pendingPhotos.length) {
            const photo = pendingPhotos[0];
            showTransferStatus(`Gönderiliyor… Kalan fotoğraf: ${pendingPhotos.length}`, 'sending');
            await uploadPendingPhoto(photo);
            pendingPhotos.shift();
        }
        showTransferStatus('Fotoğraflar gönderildi. Bilgisayardaki listeyi kontrol edin.', 'sent');
    } catch (error) {
        console.error('Photo transfer failed.', { errorName: error.name });
        showTransferStatus(`${error.message} Gönderilemeyen fotoğraflar burada kaldı; tekrar gönderebilirsiniz.`, 'error');
    } finally {
        isSending = false;
        capture.disabled = choose.disabled = false;
        renderPending();
    }
}

capture.addEventListener('click', () => camera.click());
choose.addEventListener('click', () => gallery.click());
camera.addEventListener('change', () => queuePhotos(camera));
gallery.addEventListener('change', () => queuePhotos(gallery));
send.addEventListener('click', sendPhotos);
void pairPhone();
