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
const photoCount = document.getElementById('photo-count');
const previewEmpty = document.getElementById('preview-empty');
let transferId;
let expiresAt = 0;
let photos = [];
let isSending = false;

const PHOTO_STATUS_LABELS = {
    ready: 'Gönderilmeyi bekliyor', queued: 'Sırada', uploading: 'Gönderiliyor…',
    waiting_pc: 'PC alıyor…', sent: 'Gönderildi', failed: 'Gönderilemedi'
};

function showTransferStatus(message, state = 'ready') {
    status.textContent = message;
    status.parentElement.dataset.state = state;
}

function renderPhotos() {
    for (const image of preview.querySelectorAll('img')) URL.revokeObjectURL(image.src);
    preview.replaceChildren();
    photos.forEach((photo, index) => {
        const figure = document.createElement('figure');
        figure.dataset.state = photo.status;
        const image = document.createElement('img');
        image.src = URL.createObjectURL(photo.file);
        image.alt = `${index + 1}. belge önizlemesi`;
        image.loading = 'lazy';
        image.decoding = 'async';
        const caption = document.createElement('figcaption');
        caption.textContent = `${index + 1}. fotoğraf · ${PHOTO_STATUS_LABELS[photo.status]}`;
        figure.append(image, caption);
        preview.append(figure);
    });
    photoCount.textContent = `${photos.length} fotoğraf`;
    previewEmpty.hidden = photos.length > 0;
    send.hidden = !photos.some(photo => ['ready', 'failed'].includes(photo.status));
    send.disabled = isSending;
}

async function refreshReceivedPhotos() {
    if (!transferId || expiresAt * 1000 <= Date.now()) return;
    const result = await requestMobileTransfer(`/api/mobile-transfer/${transferId}/status`);
    let hasChanges = false;
    for (const photo of photos) {
        if (photo.status === 'waiting_pc' && result.receivedPhotoIds.includes(photo.id)) {
            photo.status = 'sent';
            hasChanges = true;
        }
    }
    if (!hasChanges) return;
    renderPhotos();
    const sentCount = photos.filter(photo => photo.status === 'sent').length;
    if (sentCount === photos.length) showTransferStatus('PC’ye gönderildi. Fotoğraflar listede.', 'sent');
    else showTransferStatus(`${sentCount} fotoğraf PC’ye gönderildi; aktarım sürüyor.`, 'sending');
}

async function pairPhone() {
    try {
        const token = location.hash.slice(1);
        if (token) {
            const paired = await requestMobileTransfer('/api/mobile-transfer/claim', {
                method: 'POST', body: JSON.stringify({ token }), headers: { 'Content-Type': 'application/json' }
            });
            transferId = paired.id;
            expiresAt = paired.expires_at;
            sessionStorage.setItem('mobileDocumentTransfer', JSON.stringify({ transferId, expiresAt }));
            history.replaceState(null, '', location.pathname);
        } else {
            const paired = JSON.parse(sessionStorage.getItem('mobileDocumentTransfer') || 'null');
            transferId = paired?.transferId;
            expiresAt = paired?.expiresAt || 0;
        }
        if (!transferId || expiresAt * 1000 <= Date.now()) throw new Error('PC’den yeni QR açıp okutun.');
        capture.disabled = choose.disabled = false;
        showTransferStatus('Bilgisayara bağlandı. Fotoğraf çekince otomatik gönderilir.');
    } catch (error) {
        console.error('Phone pairing failed.', { errorName: error.name });
        showTransferStatus(error.message, 'error');
    }
}

function queuePhotos(input, shouldSendImmediately = false) {
    const files = Array.from(input.files || []);
    if (photos.length + files.length > MAX_TRANSFER_FILES) {
        showTransferStatus('Tek aktarımda en fazla 30 fotoğraf gönderilebilir.', 'error');
        input.value = '';
        return;
    }
    photos.push(...files.map(file => ({ file, id: crypto.randomUUID(), status: shouldSendImmediately ? 'queued' : 'ready' })));
    input.value = '';
    renderPhotos();
    if (shouldSendImmediately) void drainUploads();
}

async function uploadPhoto(photo) {
    const jpeg = await optimizeDocumentImage(photo.file);
    await requestMobileTransfer(`/api/mobile-transfer/${transferId}/photos`, {
        method: 'POST', body: jpeg, headers: { 'Content-Type': 'image/jpeg', 'X-Photo-Id': photo.id }
    });
}

async function drainUploads() {
    if (isSending) return;
    isSending = true;
    renderPhotos();
    try {
        let photo = photos.find(item => item.status === 'queued');
        while (photo) {
            photo.status = 'uploading';
            showTransferStatus('Fotoğraf bilgisayara gönderiliyor…', 'sending');
            renderPhotos();
            try {
                await uploadPhoto(photo);
                photo.status = 'waiting_pc';
                showTransferStatus('Yükleme tamamlandı. PC’nin listeye alması bekleniyor.', 'sending');
            } catch (error) {
                photo.status = 'failed';
                console.error('Photo transfer failed.', { errorName: error.name });
            }
            renderPhotos();
            photo = photos.find(item => item.status === 'queued');
        }
    } finally {
        isSending = false;
        renderPhotos();
    }
}

async function sendGalleryPhotos() {
    for (const photo of photos) {
        if (['ready', 'failed'].includes(photo.status)) photo.status = 'queued';
    }
    await drainUploads();
    if (photos.some(photo => photo.status === 'failed')) {
        showTransferStatus('Gönderilemeyen fotoğraf kaldı. Tekrar deneyebilirsiniz.', 'error');
        return;
    }
    showTransferStatus('Fotoğraflar PC’ye aktarılıyor; listeye alınması bekleniyor.', 'sending');
}

capture.addEventListener('click', () => camera.click());
choose.addEventListener('click', () => gallery.click());
camera.addEventListener('change', () => queuePhotos(camera, true));
gallery.addEventListener('change', () => queuePhotos(gallery));
send.addEventListener('click', () => void sendGalleryPhotos());
setInterval(() => {
    void refreshReceivedPhotos().catch(error => console.warn('Transfer status check failed.', { errorName: error.name }));
}, 1500);
void pairPhone();
