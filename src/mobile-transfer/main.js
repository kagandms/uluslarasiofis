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
const photoViews = new Map();
let transferId;
let batchId;
let expiresAt = 0;
let photos = [];
let isSending = false;
let isTransferEnded = false;
let isCheckingStatus = false;
let statusPollTimer = null;

const PHOTO_STATUS_LABELS = {
    ready: 'Gönderilmeyi bekliyor', queued: 'Sırada', uploading: 'Gönderiliyor…',
    waiting_pc: 'PC alıyor…', sent: 'Gönderildi', failed: 'Gönderilemedi', stale: 'Önceki öğrenci'
};

function showTransferStatus(message, state = 'ready') {
    status.textContent = message;
    status.parentElement.dataset.state = state;
}

function renderPhotos() {
    const activePhotoIds = new Set(photos.map(photo => photo.id));
    for (const [photoId, view] of photoViews) {
        if (activePhotoIds.has(photoId)) continue;
        URL.revokeObjectURL(view.image.src);
        view.figure.remove();
        photoViews.delete(photoId);
    }
    let nextFigure = preview.firstElementChild;
    photos.forEach((photo, index) => {
        const view = photoViews.get(photo.id) || createPhotoView(photo);
        view.figure.dataset.state = photo.status;
        view.image.alt = `${index + 1}. belge önizlemesi`;
        view.caption.textContent = `${index + 1}. fotoğraf · ${PHOTO_STATUS_LABELS[photo.status]}`;
        if (photo.status === 'stale' && !view.removeButton) {
            view.removeButton = createRemoveButton(photo);
            view.figure.append(view.removeButton);
        }
        if (photo.status !== 'stale' && view.removeButton) {
            view.removeButton.remove();
            view.removeButton = null;
        }
        if (view.figure !== nextFigure) preview.insertBefore(view.figure, nextFigure);
        nextFigure = view.figure.nextElementSibling;
    });
    document.getElementById('photo-count').textContent = `${photos.length} fotoğraf`;
    document.getElementById('preview-empty').hidden = photos.length > 0;
    send.hidden = !photos.some(photo => ['ready', 'failed'].includes(photo.status));
    send.disabled = isSending || isTransferEnded;
}

function createPhotoView(photo) {
    const figure = document.createElement('figure');
    const image = document.createElement('img');
    image.src = URL.createObjectURL(photo.file);
    image.loading = 'lazy';
    image.decoding = 'async';
    const caption = document.createElement('figcaption');
    figure.append(image, caption);
    const view = { figure, image, caption, removeButton: null };
    photoViews.set(photo.id, view);
    return view;
}

function createRemoveButton(photo) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'remove-photo';
    button.textContent = 'Kaldır';
    button.addEventListener('click', () => {
        photos = photos.filter(item => item !== photo);
        renderPhotos();
    });
    return button;
}

function markStalePhotos(activeBatchId) {
    for (const photo of photos) {
        if (photo.batchId !== activeBatchId && photo.status !== 'sent') photo.status = 'stale';
    }
}

async function refreshBatch() {
    if (!transferId) return;
    if (expiresAt * 1000 <= Date.now()) return stopPhoneTransfer();
    const result = await requestMobileTransfer(`/api/mobile-transfer/${transferId}/batch`);
    const hasBatchChanged = result.batchId !== batchId;
    if (hasBatchChanged) {
        batchId = result.batchId;
        markStalePhotos(batchId);
        capture.disabled = choose.disabled = !batchId;
        if (!batchId) showTransferStatus('PC’de öğrenci aktarım penceresi hazırlanıyor…', 'sending');
        else showTransferStatus('Bağlandı. Çektiğiniz fotoğraflar otomatik gönderilecek.');
    }
    let hasPhotoStatusChanged = false;
    for (const photo of photos) {
        if (photo.batchId !== batchId || !result.receivedPhotoIds.includes(photo.id) || photo.status === 'sent') continue;
        photo.status = 'sent';
        hasPhotoStatusChanged = true;
    }
    const sentCount = photos.filter(photo => photo.status === 'sent').length;
    if (sentCount === photos.length && sentCount > 0) showTransferStatus('PC’ye gönderildi. Fotoğraflar listede.', 'sent');
    else if (sentCount > 0) showTransferStatus(`${sentCount} fotoğraf PC’ye gönderildi; aktarım sürüyor.`, 'sending');
    if (hasBatchChanged || hasPhotoStatusChanged) renderPhotos();
}

function stopPhoneTransfer() {
    isTransferEnded = true;
    transferId = batchId = null;
    expiresAt = 0;
    clearInterval(statusPollTimer);
    statusPollTimer = null;
    sessionStorage.removeItem('mobileDocumentTransfer');
    capture.disabled = choose.disabled = camera.disabled = gallery.disabled = true;
    markStalePhotos(null);
    renderPhotos();
    showTransferStatus('QR bağlantısı sona erdi. PC’de yeni QR oluşturup okutun.', 'error');
}

async function checkTransferStatus() {
    if (isCheckingStatus || isTransferEnded || !transferId) return;
    isCheckingStatus = true;
    try {
        await refreshBatch();
    } catch (error) {
        if (error.code === 'TRANSFER_EXPIRED') return stopPhoneTransfer();
        console.warn('Transfer status check failed.', { errorName: error.name });
    } finally { isCheckingStatus = false; }
}

function startStatusPolling() {
    if (statusPollTimer || !transferId || isTransferEnded) return;
    statusPollTimer = setInterval(() => void checkTransferStatus(), 3000);
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
        showTransferStatus('Bağlantı ve öğrenci aktarımı doğrulanıyor…', 'sending');
        await refreshBatch();
        startStatusPolling();
    } catch (error) {
        console.error('Phone pairing failed.', { errorName: error.name });
        if (error.code === 'TRANSFER_EXPIRED') return stopPhoneTransfer();
        showTransferStatus(error.message, 'error');
    }
}

function queuePhotos(input, isCameraCapture = false) {
    if (photos.length + input.files.length > MAX_TRANSFER_FILES) {
        showTransferStatus('Tek aktarımda en fazla 30 fotoğraf gönderilebilir.', 'error');
        return;
    }
    const added = Array.from(input.files || []).map(file => ({
        file, id: crypto.randomUUID(), batchId,
        status: isCameraCapture ? 'queued' : 'ready'
    }));
    photos.push(...added);
    input.value = '';
    renderPhotos();
    if (isCameraCapture) void drainUploads();
}

async function uploadPhoto(photo) {
    if (isTransferEnded || !batchId || photo.batchId !== batchId) throw new Error('Öğrenci aktarımı değişti; bu fotoğraf gönderilmedi.');
    const jpeg = await optimizeDocumentImage(photo.file);
    await requestMobileTransfer(`/api/mobile-transfer/${transferId}/photos`, {
        method: 'POST', body: jpeg,
        headers: { 'Content-Type': 'image/jpeg', 'X-Photo-Id': photo.id, 'X-Transfer-Batch-ID': photo.batchId }
    });
    photo.status = 'waiting_pc';
}

async function drainUploads() {
    if (isSending) return;
    isSending = true;
    renderPhotos();
    try {
        let photo = photos.find(item => item.status === 'queued');
        while (photo) {
            photo.status = 'uploading';
            showTransferStatus('Fotoğraf PC’ye gönderiliyor…', 'sending');
            renderPhotos();
            try {
                await uploadPhoto(photo);
                showTransferStatus('Yükleme tamamlandı. PC’nin alması bekleniyor.', 'sending');
            } catch (error) {
                photo.status = error.code === 'TRANSFER_BATCH_STALE' ? 'stale' : 'failed';
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
    showTransferStatus('Fotoğraflar PC’ye aktarılıyor; alım teyidi bekleniyor.', 'sending');
}

capture.addEventListener('click', () => camera.click());
choose.addEventListener('click', () => gallery.click());
camera.addEventListener('change', () => queuePhotos(camera, true));
gallery.addEventListener('change', () => queuePhotos(gallery));
send.addEventListener('click', () => void sendGalleryPhotos());
void pairPhone();
