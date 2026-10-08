import { mergeDocumentsToPdf, downloadPdfFile } from '../services/pdfMergerService.js';
import { showToast } from './toastManager.js';

const MAX_FILES = 30;

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
    } catch {
        // Audio/vibrate might be blocked by policy, safely ignore
    }
}

export function openPdfMergerModal() {
    let existingModal = document.getElementById('pdf-merger-modal-overlay');
    if (existingModal) existingModal.remove();

    const selectedFiles = []; // Array of File objects
    let isContinuousCameraMode = false;

    const overlay = document.createElement('div');
    overlay.id = 'pdf-merger-modal-overlay';
    overlay.className = 'staff-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Toplu PDF Birleştirici & Fotoğraf Tarayıcı');

    const modal = document.createElement('div');
    modal.className = 'staff-modal-card pdf-merger-modal-card';
    modal.style.maxWidth = '720px';
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
    title.textContent = '📄 Toplu Fotoğraf & PDF Birleştirici';
    title.style.margin = '0 0 4px 0';
    title.style.fontSize = '1.2rem';
    title.style.color = 'var(--text-primary, #1e293b)';

    const subtitle = document.createElement('p');
    subtitle.textContent = `Art arda ${MAX_FILES} adede kadar fotoğraf çekin veya dosya seçip tek bir A4 PDF dosyasında birleştirin.`;
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
    actionGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
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
    btnCameraMode.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> 📸 Seri Fotoğraf Çek (Kamera)`;

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
    btnFileSelect.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> 📁 Galeriden / Dosyadan Seç`;

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
    bannerInfo.innerHTML = `<strong>Seri Çekim Modu:</strong> Fotoğraf kaydedildi. Bir sonraki fotoğraf için kamera otomatik açılır veya aşağıdaki butona tıklayın.`;

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
        if (selectedFiles.length >= MAX_FILES) {
            showToast(`Maksimum ${MAX_FILES} belge sınırına ulaşıldı.`, 'warning');
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

    // Dropzone for desktop drag & drop
    const dropZone = document.createElement('div');
    dropZone.className = 'pdf-merger-dropzone';
    dropZone.style.border = '2px dashed var(--accent, #3498db)';
    dropZone.style.borderRadius = '8px';
    dropZone.style.padding = '18px 14px';
    dropZone.style.textAlign = 'center';
    dropZone.style.cursor = 'pointer';
    dropZone.style.background = 'rgba(52, 152, 219, 0.04)';
    dropZone.style.marginBottom = '14px';

    const dropText = document.createElement('p');
    dropText.style.margin = '0 0 4px 0';
    dropText.style.fontWeight = '500';
    dropText.style.fontSize = '0.9rem';
    dropText.textContent = 'Veya dosyaları buraya sürükleyip bırakabilirsiniz';

    const dropHint = document.createElement('span');
    dropHint.style.fontSize = '0.78rem';
    dropHint.style.opacity = '0.75';
    dropHint.textContent = 'PDF, JPEG, PNG, WEBP formatları desteklenir (Maksimum 30 dosya)';

    dropZone.append(dropText, dropHint, fileInput, cameraInput);
    dropZone.addEventListener('click', () => fileInput.click());

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

    body.append(actionGrid, cameraBanner, dropZone, listHeader, fileListEl);

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
    btnMerge.textContent = '📥 Tek PDF Olarak Birleştir ve İndir';
    btnMerge.disabled = true;

    footer.append(progressMsg, btnMerge);

    modal.append(header, body, footer);
    overlay.append(modal);
    document.body.append(overlay);

    function updateCount() {
        countBadge.textContent = `Eklenen Belgeler: ${selectedFiles.length} / ${MAX_FILES}`;
        clearBtn.style.display = selectedFiles.length > 0 ? 'inline-block' : 'none';
        btnMerge.disabled = selectedFiles.length === 0;
        btnCameraMode.disabled = selectedFiles.length >= MAX_FILES;
    }

    function addFiles(filesArray, isCameraSource = false) {
        let addedCount = 0;
        for (const file of filesArray) {
            if (selectedFiles.length >= MAX_FILES) {
                showToast(`En fazla ${MAX_FILES} belge eklenebilir. Limit doldu.`, 'warning');
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
                showToast(`📸 ${currentCount}. fotoğraf kaydedildi! (${currentCount} / ${MAX_FILES})`, 'success');

                if (currentCount < MAX_FILES && isContinuousCameraMode) {
                    cameraBanner.style.display = 'flex';
                    bannerInfo.innerHTML = `<strong>Seri Çekim (${currentCount}/${MAX_FILES}):</strong> Fotoğraf arkaya eklendi. Sıradaki çekim açılıyor...`;

                    // Automatic loop trigger for successive photos
                    setTimeout(() => {
                        if (isContinuousCameraMode && selectedFiles.length < MAX_FILES) {
                            cameraInput.value = '';
                            cameraInput.click();
                        }
                    }, 400);
                } else if (currentCount >= MAX_FILES) {
                    isContinuousCameraMode = false;
                    cameraBanner.style.display = 'none';
                    showToast(`30 fotoğraf sınırına ulaşıldı. PDF birleştirmeye hazırsınız.`, 'info');
                }
            }
        }
    }

    // Camera mode trigger
    btnCameraMode.addEventListener('click', () => {
        if (selectedFiles.length >= MAX_FILES) {
            showToast(`Maksimum ${MAX_FILES} belge sınırına ulaşıldı.`, 'warning');
            return;
        }
        isContinuousCameraMode = true;
        cameraBanner.style.display = 'flex';
        bannerInfo.innerHTML = `<strong>Seri Çekim Aktif:</strong> Fotoğrafı çekin; arkada kaydedilip sıradaki çekim açılacaktır.`;
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

    // Drag-and-drop events
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.style.background = 'rgba(52, 152, 219, 0.15)';
        });
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.style.background = 'rgba(52, 152, 219, 0.04)';
        });
    });
    dropZone.addEventListener('drop', (e) => {
        if (e.dataTransfer?.files?.length) {
            addFiles(Array.from(e.dataTransfer.files), false);
        }
    });

    function moveItem(fromIndex, toIndex) {
        if (toIndex < 0 || toIndex >= selectedFiles.length) return;
        const [moved] = selectedFiles.splice(fromIndex, 1);
        selectedFiles.splice(toIndex, 0, moved);
        renderList();
    }

    function renderList() {
        updateCount();
        fileListEl.replaceChildren();

        if (selectedFiles.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.style.textAlign = 'center';
            emptyEl.style.padding = '22px';
            emptyEl.style.opacity = '0.65';
            emptyEl.style.fontSize = '0.85rem';
            emptyEl.textContent = 'Henüz hiçbir belge eklenmedi. Fotoğraf çekebilir veya dosya seçebilirsiniz.';
            fileListEl.append(emptyEl);
            return;
        }

        selectedFiles.forEach((file, index) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.padding = '8px 12px';
            row.style.background = 'rgba(126, 24, 48, 0.04)';
            row.style.borderRadius = '6px';
            row.style.border = '1px solid var(--border-color, rgba(0, 0, 0, 0.08))';

            // Left: Order index + Name + Size
            const info = document.createElement('div');
            info.style.display = 'flex';
            info.style.alignItems = 'center';
            info.style.gap = '8px';
            info.style.overflow = 'hidden';

            const num = document.createElement('span');
            num.textContent = `${index + 1}.`;
            num.style.fontWeight = 'bold';
            num.style.minWidth = '24px';
            num.style.opacity = '0.8';

            const iconSpan = document.createElement('span');
            iconSpan.textContent = file.type?.includes('pdf') || file.name.endsWith('.pdf') ? '📄' : '🖼️';

            const name = document.createElement('span');
            name.textContent = file.name;
            name.style.whiteSpace = 'nowrap';
            name.style.overflow = 'hidden';
            name.style.textOverflow = 'ellipsis';
            name.style.maxWidth = '300px';
            name.style.fontSize = '0.9rem';

            const size = document.createElement('span');
            size.textContent = `(${formatBytes(file.size)})`;
            size.style.fontSize = '0.78rem';
            size.style.opacity = '0.6';

            info.append(num, iconSpan, name, size);

            // Right: Up, Down, Delete buttons
            const actions = document.createElement('div');
            actions.style.display = 'flex';
            actions.style.gap = '4px';

            const upBtn = document.createElement('button');
            upBtn.type = 'button';
            upBtn.className = 'btn btn-outline';
            upBtn.textContent = '↑';
            upBtn.style.padding = '2px 6px';
            upBtn.disabled = index === 0;
            upBtn.addEventListener('click', () => moveItem(index, index - 1));

            const downBtn = document.createElement('button');
            downBtn.type = 'button';
            downBtn.className = 'btn btn-outline';
            downBtn.textContent = '↓';
            downBtn.style.padding = '2px 6px';
            downBtn.disabled = index === selectedFiles.length - 1;
            downBtn.addEventListener('click', () => moveItem(index, index + 1));

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn btn-outline';
            delBtn.textContent = '✕';
            delBtn.style.padding = '2px 6px';
            delBtn.style.color = '#e74c3c';
            delBtn.addEventListener('click', () => {
                selectedFiles.splice(index, 1);
                renderList();
            });

            actions.append(upBtn, downBtn, delBtn);
            row.append(info, actions);
            fileListEl.append(row);
        });

        // Auto-scroll to latest item
        fileListEl.scrollTop = fileListEl.scrollHeight;
    }

    // Merge trigger
    btnMerge.addEventListener('click', async () => {
        if (selectedFiles.length === 0) return;
        isContinuousCameraMode = false;
        cameraBanner.style.display = 'none';
        btnMerge.disabled = true;
        closeBtn.disabled = true;

        try {
            progressMsg.textContent = 'Dosyalar okunuyor ve A4 sayfalarına ölçekleniyor...';
            const filePayloads = [];

            for (const file of selectedFiles) {
                const arrayBuffer = await file.arrayBuffer();
                filePayloads.push({
                    name: file.name,
                    bytes: new Uint8Array(arrayBuffer),
                    mediaType: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
                });
            }

            const mergedBytes = await mergeDocumentsToPdf(filePayloads, (prog) => {
                progressMsg.textContent = prog.message;
            });

            progressMsg.textContent = 'Tamamlandı! İndiriliyor...';
            const timestamp = new Date().toISOString().slice(0, 10);
            downloadPdfFile(mergedBytes, `Birlestirilmis_Belgeler_${timestamp}.pdf`);
            showToast('Tüm belgeler başarıyla tek bir PDF olarak birleştirildi.', 'success');

            setTimeout(() => overlay.remove(), 1200);
        } catch (err) {
            console.error('[PDF Merger Modal] Hata:', err);
            showToast(`PDF birleştirme başarısız: ${err.message}`, 'error');
            progressMsg.textContent = 'Hata oluştu.';
            btnMerge.disabled = false;
            closeBtn.disabled = false;
        }
    });

    renderList();

    // Close on escape
    const handleKeydown = (e) => {
        if (e.key === 'Escape') {
            document.removeEventListener('keydown', handleKeydown);
            isContinuousCameraMode = false;
            overlay.remove();
        }
    };
    document.addEventListener('keydown', handleKeydown);
}
