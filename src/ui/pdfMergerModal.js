import './staff-modal.css';
import './pdf-merger-modal.css';
import { createDocumentPreviewStore } from './document-preview-store.js';
import { createDocumentPreviewDialog } from './document-preview-dialog.js';
import { createPdfMergerGallery } from './pdf-merger-gallery.js';
import { mergeDocumentsToPdf, downloadPdfFile } from '../services/pdfMergerService.js';
import { showToast } from './toastManager.js';

const DEFAULT_MAX_FILES = 30;
const YOKSIS_SAFE_LIMIT_BYTES = 9 * 1024 * 1024;

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function playCaptureFeedback() {
    try {
        if (navigator.vibrate) {
            navigator.vibrate([40, 30, 40]);
        }
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
            osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1); // A5
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
        }
    } catch (error) {
        console.warn('Capture feedback unavailable.', { errorName: error.name });
    }
}

/** Opens the PDF builder, optionally saving to a captured student receipt.
 * @param {{contextLabel?: string, initialFiles?: File[], onSave?: Function, onPrepare?: Function, mergeLabel?: string, confirmLabel?: string, successMessage?: string, maxFiles?: number}} options Destination and preparation callbacks.
 * @returns {void} Mounts the dialog.
 */
export function openPdfMergerModal(options = {}) {
    let existingModal = document.getElementById('pdf-merger-modal-overlay');
    if (existingModal?.dataset.isProcessing === 'true') { showToast('PDF işlemi devam ediyor. Tamamlanmasını bekleyin.', 'warning'); return; }
    if (existingModal) existingModal.remove();

    const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 300) throw new Error('Belge sınırı geçersiz.');
    let readyPdf = null;
    let readyPdfCanBeUsed = false;
    let preparedFields = null;
    let isSaving = false;
    let isBuilding = false;
    let previewUrl = null;
    const selectedFiles = [...(options.initialFiles || [])]; // Keep the current PDF before newly added documents.
    let isContinuousCameraMode = false;

    const overlay = document.createElement('div');
    overlay.id = 'pdf-merger-modal-overlay';
    overlay.className = 'staff-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Belge sayfaları ekle');

    const modal = document.createElement('div');
    modal.className = 'staff-modal-card pdf-merger-modal-card';
    if (options.onSave) modal.classList.add('physical-intake-panel');
    modal.style.maxWidth = '760px';
    modal.style.width = '94%';
    modal.style.maxHeight = '92vh';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.overflow = 'hidden';

    // Header
    const header = document.createElement('div');
    header.className = 'staff-modal-header';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.paddingBottom = '12px';
    header.style.borderBottom = '1px solid var(--border-color, rgba(0,0,0,0.08))';

    const titleGroup = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = 'Belge sayfaları ekle';
    title.style.margin = '0 0 4px 0';
    title.style.fontSize = '1.2rem';
    title.style.color = 'var(--text-primary, #1e293b)';

    const subtitle = document.createElement('p');
    subtitle.textContent = options.contextLabel || `Fotoğraf çekin ya da galeriden dosya seçin. Sayfalar tek PDF dosyasında birleştirilir (en fazla ${maxFiles}).`;
    subtitle.style.margin = '0';
    subtitle.style.fontSize = '0.85rem';
    subtitle.style.color = 'var(--text-secondary, #64748b)';
    titleGroup.append(title, subtitle);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-outline';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Kapat');
    closeBtn.style.padding = '4px 10px';
    closeBtn.addEventListener('click', () => {
        isContinuousCameraMode = false;
        overlay.remove();
    });

    header.append(titleGroup, closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'pdf-merger-body';
    body.style.flex = '1';
    body.style.overflowY = 'auto';
    body.style.padding = '16px 0';

    // Hidden inputs
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'application/pdf,image/jpeg,image/png,image/webp,image/*';
    fileInput.style.display = 'none';

    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.accept = 'image/*';
    cameraInput.setAttribute('capture', 'environment');
    cameraInput.style.display = 'none';

    // Action buttons bar: Camera vs File picker
    const actionGrid = document.createElement('div');
    actionGrid.style.display = 'grid';
    actionGrid.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
    actionGrid.style.gap = '10px';
    actionGrid.style.marginBottom = '14px';

    const btnCameraMode = document.createElement('button');
    btnCameraMode.type = 'button';
    btnCameraMode.className = 'btn btn-primary';
    btnCameraMode.style.display = 'flex';
    btnCameraMode.style.alignItems = 'center';
    btnCameraMode.style.justifyContent = 'center';
    btnCameraMode.style.gap = '8px';
    btnCameraMode.style.padding = '12px 14px';
    btnCameraMode.style.fontSize = '0.95rem';
    btnCameraMode.style.fontWeight = '600';
    btnCameraMode.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> Fotoğraf çek`;

    const btnFileSelect = document.createElement('button');
    btnFileSelect.type = 'button';
    btnFileSelect.className = 'btn btn-outline';
    btnFileSelect.style.display = 'flex';
    btnFileSelect.style.alignItems = 'center';
    btnFileSelect.style.justifyContent = 'center';
    btnFileSelect.style.gap = '8px';
    btnFileSelect.style.padding = '12px 14px';
    btnFileSelect.style.fontSize = '0.95rem';
    btnFileSelect.style.fontWeight = '600';
    btnFileSelect.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> Galeri veya dosya seç`;

    actionGrid.append(btnCameraMode, btnFileSelect);

    // Continuous capture banner (Active during camera mode)
    const cameraBanner = document.createElement('div');
    cameraBanner.style.display = 'none';
    cameraBanner.style.background = 'rgba(46, 204, 113, 0.12)';
    cameraBanner.style.border = '1px solid rgba(46, 204, 113, 0.4)';
    cameraBanner.style.borderRadius = '8px';
    cameraBanner.style.padding = '10px 14px';
    cameraBanner.style.marginBottom = '14px';
    cameraBanner.style.alignItems = 'center';
    cameraBanner.style.justifyContent = 'space-between';

    const bannerInfo = document.createElement('div');
    bannerInfo.style.fontSize = '0.88rem';
    bannerInfo.style.color = '#2ecc71';
    bannerInfo.style.fontWeight = '500';
    bannerInfo.innerHTML = `<strong>Seri Çekim Modu:</strong> Fotoğraf kaydedildi. Bir sonraki fotoğraf için aşağıdaki Kamera butonuna tıklayın.`;

    const bannerActions = document.createElement('div');
    bannerActions.style.display = 'flex';
    bannerActions.style.gap = '8px';
    bannerActions.style.flexWrap = 'wrap';

    const btnNextShot = document.createElement('button');
    btnNextShot.type = 'button';
    btnNextShot.className = 'btn btn-primary';
    btnNextShot.style.padding = '5px 10px';
    btnNextShot.style.fontSize = '0.82rem';
    btnNextShot.textContent = '📸 Sonraki Fotoğrafı Çek';
    btnNextShot.addEventListener('click', () => {
        if (selectedFiles.length >= maxFiles) {
            showToast(`Maksimum ${maxFiles} belge sınırına ulaşıldı.`, 'warning');
            return;
        }
        isContinuousCameraMode = true;
        cameraInput.value = '';
        cameraInput.click();
    });

    const btnStopCapture = document.createElement('button');
    btnStopCapture.type = 'button';
    btnStopCapture.className = 'btn btn-outline';
    btnStopCapture.style.padding = '5px 10px';
    btnStopCapture.style.fontSize = '0.82rem';
    btnStopCapture.textContent = '✅ Çekimi Tamamla';
    btnStopCapture.addEventListener('click', () => {
        isContinuousCameraMode = false;
        cameraBanner.style.display = 'none';
        showToast('Seri çekim tamamlandı. Belgelerinizi inceleyip PDF oluşturabilirsiniz.', 'info');
    });

    bannerActions.append(btnNextShot, btnStopCapture);
    cameraBanner.append(bannerInfo, bannerActions);

    actionGrid.append(fileInput, cameraInput);

    // File list section
    const listHeader = document.createElement('div');
    listHeader.style.display = 'flex';
    listHeader.style.justifyContent = 'space-between';
    listHeader.style.alignItems = 'center';
    listHeader.style.marginBottom = '8px';

    const countBadge = document.createElement('span');
    countBadge.style.fontWeight = '600';
    countBadge.style.fontSize = '0.9rem';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-outline';
    clearBtn.textContent = 'Tümünü Temizle';
    clearBtn.style.padding = '3px 8px';
    clearBtn.style.fontSize = '0.8rem';
    clearBtn.addEventListener('click', () => {
        isContinuousCameraMode = false;
        cameraBanner.style.display = 'none';
        selectedFiles.length = 0;
        renderList();
    });
    listHeader.append(countBadge, clearBtn);

    const fileListEl = document.createElement('div');
    fileListEl.className = 'pdf-merger-file-list';
    fileListEl.style.display = 'flex';
    fileListEl.style.flexDirection = 'column';
    fileListEl.style.gap = '6px';
    fileListEl.style.maxHeight = '300px';
    fileListEl.style.overflowY = 'auto';

    const documentsPanel=document.createElement('div');
    documentsPanel.className='pdf-merger-documents';
    const listHint = document.createElement('p');
    listHint.className = 'pdf-merger-list-hint';
    listHint.textContent = 'Eklenen sayfaları önizleyip sıralayabilirsiniz.';
    documentsPanel.append(actionGrid, cameraBanner, listHeader, listHint, fileListEl);
    body.append(documentsPanel);

    // Footer with merge action
    const footer = document.createElement('div');
    footer.className = 'staff-modal-footer';
    footer.style.paddingTop = '12px';
    footer.style.borderTop = '1px solid var(--border-color, rgba(0,0,0,0.08))';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'space-between';
    footer.style.alignItems = 'center';
    footer.style.flexWrap = 'wrap';
    footer.style.gap = '8px';

    const progressMsg = document.createElement('span');
    progressMsg.style.fontSize = '0.85rem';
    progressMsg.style.color = 'var(--accent, #7e1830)';
    progressMsg.style.fontWeight = '500';

    const btnMerge = document.createElement('button');
    btnMerge.type = 'button';
    btnMerge.className = 'btn btn-primary';
    btnMerge.textContent = options.mergeLabel || 'PDF oluştur ve boyutu göster';
    btnMerge.disabled = true;

    const previewLink = document.createElement('a');
    previewLink.textContent = 'PDF’i aç ve yakınlaştırarak kontrol et';
    previewLink.target = '_blank';
    previewLink.rel = 'noopener';
    previewLink.hidden = true;
    footer.append(progressMsg, previewLink, btnMerge);
    const previews = createDocumentPreviewStore();
    const previewDialog = createDocumentPreviewDialog({ modal, previews, canInteract: () => !isSaving && !isBuilding });
    const gallery = createPdfMergerGallery({
        container: fileListEl, previews, previewDialog, canInteract: () => !isSaving && !isBuilding,
        onMove: moveItem, onRemove: index => {
            if (isSaving || isBuilding) return;
            selectedFiles.splice(index, 1);
            renderList();
        }
    });
    const cleanupObserver = new MutationObserver(() => {
        if (!overlay.isConnected) {
            gallery.dispose();
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            isContinuousCameraMode = false;
            document.removeEventListener('keydown', handleKeydown);
            cleanupObserver.disconnect();
        }
    });
    cleanupObserver.observe(document.body, { childList: true, subtree: true });

    modal.append(header, body, footer);
    overlay.append(modal);
    document.body.append(overlay);

    function updateCount() {
        countBadge.textContent = `Eklenen Belgeler: ${selectedFiles.length} / ${maxFiles}`;
        clearBtn.style.display = selectedFiles.length > 0 ? 'inline-block' : 'none';
        btnMerge.disabled = selectedFiles.length === 0 || Boolean(readyPdf && !readyPdfCanBeUsed);
        btnCameraMode.disabled = selectedFiles.length >= maxFiles;
    }

    function addFiles(filesArray, isCameraSource = false) {
        if (isSaving || isBuilding) throw new Error('PDF işleniyor; işlem tamamlanınca belge ekleyin.');
        let addedCount = 0;
        for (const file of filesArray) {
            if (selectedFiles.length >= maxFiles) {
                showToast(`En fazla ${maxFiles} belge eklenebilir. Limit doldu.`, 'warning');
                isContinuousCameraMode = false;
                cameraBanner.style.display = 'none';
                break;
            }
            selectedFiles.push(file);
            addedCount++;
        }

        if (addedCount > 0) {
            playCaptureFeedback();
            renderList();

            if (isCameraSource) {
                const currentCount = selectedFiles.length;
                showToast(`📸 ${currentCount}. fotoğraf kaydedildi! (${currentCount} / ${maxFiles})`, 'success');

                if (currentCount < maxFiles && isContinuousCameraMode) {
                    cameraBanner.style.display = 'flex';
                    bannerInfo.textContent = `${currentCount}/${maxFiles} fotoğraf kaydedildi. Sıradaki çekim için Kamera tuşuna basın.`;
                } else if (currentCount >= maxFiles) {
                    isContinuousCameraMode = false;
                    cameraBanner.style.display = 'none';
                    showToast(`${maxFiles} fotoğraf sınırına ulaşıldı. PDF birleştirmeye hazırsınız.`, 'info');
                }
            }
        }
    }

    // Camera mode trigger
    btnCameraMode.addEventListener('click', () => {
        if (selectedFiles.length >= maxFiles) {
            showToast(`Maksimum ${maxFiles} belge sınırına ulaşıldı.`, 'warning');
            return;
        }
        isContinuousCameraMode = true;
        cameraBanner.style.display = 'flex';
        bannerInfo.innerHTML = `<strong>Seri Çekim Aktif:</strong> Fotoğrafı çekin; sıradaki çekim için Kamera butonuna tekrar basın.`;
        cameraInput.value = '';
        cameraInput.click();
    });

    // File select trigger
    btnFileSelect.addEventListener('click', () => {
        isContinuousCameraMode = false;
        cameraBanner.style.display = 'none';
        fileInput.click();
    });

    // Camera input change event
    cameraInput.addEventListener('change', () => {
        if (cameraInput.files?.length) {
            const captured = cameraInput.files[0];
            const ext = captured.name.split('.').pop() || 'jpg';
            const renamedFile = new File(
                [captured],
                `Foto_${selectedFiles.length + 1}.${ext}`,
                { type: captured.type || 'image/jpeg', lastModified: Date.now() }
            );
            addFiles([renamedFile], true);
            cameraInput.value = '';
        }
    });

    cameraInput.addEventListener('cancel', () => {
        // User exited camera view without snapping
        if (isContinuousCameraMode) {
            bannerInfo.innerHTML = `<strong>Seri Çekim Duraklatıldı:</strong> ${selectedFiles.length} fotoğraf eklendi. Devam etmek için butona basın.`;
        }
    });

    // File input change event
    fileInput.addEventListener('change', () => {
        if (fileInput.files?.length) {
            addFiles(Array.from(fileInput.files), false);
            fileInput.value = '';
        }
    });

    function moveItem(fromIndex, toIndex) {
        if (isSaving || isBuilding || fromIndex === toIndex || toIndex < 0 || toIndex >= selectedFiles.length) return;
        const [moved] = selectedFiles.splice(fromIndex, 1);
        selectedFiles.splice(toIndex, 0, moved);
        renderList();
    }

    function renderList() {
        progressMsg.textContent = '';
        btnMerge.removeAttribute('title');
        readyPdf = null;
        readyPdfCanBeUsed = false;
        preparedFields = null;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        previewLink.hidden = true;
        btnMerge.textContent = options.mergeLabel || 'PDF oluştur ve boyutu göster';
        updateCount();
        gallery.sync(selectedFiles);
    }

    async function saveReadyPdf() {
        if (!readyPdfCanBeUsed || !readyPdf || readyPdf.byteLength > YOKSIS_SAFE_LIMIT_BYTES) {
            progressMsg.textContent = 'PDF 9 MiB güvenli sınırının altında değil. Sayfa sayısını azaltıp yeniden oluşturun.';
            return;
        }
        const controls = [...overlay.querySelectorAll('button,input,select')].map(node => ({ node, wasDisabled: node.disabled }));
        isSaving = true;
        overlay.dataset.isProcessing = 'true';
        controls.forEach(({ node }) => { node.disabled = true; });
        try {
            progressMsg.textContent = 'PDF öğrenci kaydına kaydediliyor…';
            await options.onSave(readyPdf, preparedFields);
            showToast(options.successMessage || 'PDF öğrenci kaydına kaydedildi.', 'success');
            overlay.remove();
        } catch (error) {
            console.error('Physical PDF confirmation failed.', { errorName: error.name, code: error.code });
            progressMsg.textContent = error.message;
            showToast(error.message, 'error');
        } finally {
            isSaving = false;
            overlay.dataset.isProcessing = 'false';
            controls.forEach(({ node, wasDisabled }) => { node.disabled = wasDisabled; });
        }
    }

    // Merge trigger
    btnMerge.addEventListener('click', async () => {
        if (selectedFiles.length === 0) return;
        if (isSaving) return;
        if (readyPdf) {
            if (!readyPdfCanBeUsed) return;
            if (typeof options.onSave === 'function') { await saveReadyPdf(); return; }
            downloadPdfFile(readyPdf, `Birlestirilmis_Belgeler_${new Date().toISOString().slice(0, 10)}.pdf`);
            return;
        }
        isContinuousCameraMode = false;
        cameraBanner.style.display = 'none';
        btnMerge.disabled = true;
        closeBtn.disabled = true;
        isBuilding = true;
        overlay.dataset.isProcessing = 'true';
        const buildControls = [...overlay.querySelectorAll('button,input,select')].map(node => ({ node, wasDisabled: node.disabled }));
        buildControls.forEach(({ node }) => { node.disabled = true; });

        try {
            progressMsg.textContent = 'Belgeler sırayla birleştiriliyor ve 9 MiB sınırı kontrol ediliyor…';
            if (options.onPrepare) {
                progressMsg.textContent = 'Başvuru formundan öğrenci bilgileri okunuyor…';
                preparedFields = await options.onPrepare([...selectedFiles]);
            }
            const result = await mergeDocumentsToPdf(selectedFiles, (prog) => {
                progressMsg.textContent = prog.message;
            });

            const mergedBytes = result.bytes;
            readyPdf = mergedBytes;
            readyPdfCanBeUsed = result.metrics.targetReached;
            previewUrl = URL.createObjectURL(new Blob([mergedBytes], { type: 'application/pdf' }));
            previewLink.href = previewUrl;
            previewLink.hidden = false;
            const targetMessage = result.metrics.targetReached
                ? 'YÖKSİS’in 10 MB sınırının altında.'
                : result.metrics.warning;
            const compressionMessage = Number.isInteger(result.metrics.compressionPercent)
                ? ` Kullanılan sıkıştırma kademesi: %${result.metrics.compressionPercent}.`
                : ' PDF sayfaları yeniden sıkıştırılmadan korundu.';
            const rasterNotice = result.metrics.rasterizedPdfs
                ? ' PDF sayfaları görüntüye çevrildi; seçilebilir metin ve form alanları korunmaz.'
                : '';
            progressMsg.textContent = `PDF ${formatBytes(result.metrics.inputBytes)} → ${formatBytes(result.metrics.outputBytes)}. ${targetMessage}${compressionMessage}${rasterNotice} Açıp okunabilirliği kontrol edin.`;
            btnMerge.textContent = options.onSave ? (options.confirmLabel || 'Kontrol ettim, öğrenci kaydına ekle') : 'Kontrol ettim, PDF’i indir';
            btnMerge.disabled = !readyPdfCanBeUsed;
            if (!readyPdfCanBeUsed) btnMerge.title = 'PDF 9 MiB altında olmalı.';
            closeBtn.disabled = false;
        } catch (err) {
            console.error('[PDF Merger Modal] Hata:', err);
            showToast(`PDF birleştirme başarısız: ${err.message}`, 'error');
            progressMsg.textContent = 'Hata oluştu.';
            btnMerge.disabled = Boolean(readyPdf && !readyPdfCanBeUsed);
            closeBtn.disabled = false;
        } finally {
            isBuilding = false;
            overlay.dataset.isProcessing = 'false';
            buildControls.forEach(({ node, wasDisabled }) => { node.disabled = wasDisabled; });
            btnMerge.disabled = selectedFiles.length === 0 || Boolean(readyPdf && !readyPdfCanBeUsed);
            closeBtn.disabled = false;
        }
    });

    renderList();

    // Close on escape
    const handleKeydown = (e) => {
        if (e.key === 'Escape' && !isSaving && !closeBtn.disabled) {
            document.removeEventListener('keydown', handleKeydown);
            isContinuousCameraMode = false;
            overlay.remove();
        }
    };
    document.addEventListener('keydown', handleKeydown);
}
