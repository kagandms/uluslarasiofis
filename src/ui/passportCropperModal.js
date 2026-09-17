import { showToast } from './toastManager.js';

let passportCropperInstance = null;
let baseRotation = 0; // 0, 90, 180, 270...
let currentStudentInfo = { name: '', passport: '' };
let currentAspectRatio = 3 / 4; // Standard biometric portrait ratio
let cropperPages = []; // [{ dataUrl, pageNumber, label }]
let currentCropperPageIndex = 0;

function getElements() {
    return {
        modal: document.getElementById('passport-cropper-modal'),
        image: document.getElementById('passport-cropper-image'),
        slider: document.getElementById('passport-rotation-slider'),
        angleLabel: document.getElementById('passport-rotation-angle-label'),
        btnRotateLeft: document.getElementById('btn-passport-rotate-left'),
        btnRotateRight: document.getElementById('btn-passport-rotate-right'),
        btnFineMinus: document.getElementById('btn-passport-fine-minus'),
        btnFinePlus: document.getElementById('btn-passport-fine-plus'),
        btnAspectRatio: document.getElementById('btn-passport-aspect-ratio'),
        btnDownload: document.getElementById('btn-passport-crop-download'),
        btnTransfer: document.getElementById('btn-passport-crop-transfer'),
        btnCancel: document.getElementById('btn-passport-crop-cancel'),
        btnClose: document.getElementById('btn-passport-crop-close'),
        pageSelector: document.getElementById('passport-page-selector'),
        pageInfo: document.getElementById('passport-page-info'),
        btnPrevPage: document.getElementById('btn-passport-prev-page'),
        btnNextPage: document.getElementById('btn-passport-next-page')
    };
}

function updatePageSelectorUI() {
    const { pageSelector, pageInfo, btnPrevPage, btnNextPage } = getElements();
    if (!pageSelector) return;

    if (!cropperPages || cropperPages.length <= 1) {
        pageSelector.style.display = 'none';
        return;
    }

    pageSelector.style.display = 'flex';
    const total = cropperPages.length;
    const current = currentCropperPageIndex + 1;
    const pageItem = cropperPages[currentCropperPageIndex];
    const label = pageItem?.label ? ` (${pageItem.label})` : '';

    if (pageInfo) {
        pageInfo.textContent = `Sayfa ${current} / ${total}${label}`;
    }

    if (btnPrevPage) {
        const canGoPrev = currentCropperPageIndex > 0;
        btnPrevPage.disabled = !canGoPrev;
        btnPrevPage.style.opacity = canGoPrev ? '1' : '0.5';
        btnPrevPage.style.cursor = canGoPrev ? 'pointer' : 'not-allowed';
    }

    if (btnNextPage) {
        const canGoNext = currentCropperPageIndex < total - 1;
        btnNextPage.disabled = !canGoNext;
        btnNextPage.style.opacity = canGoNext ? '1' : '0.5';
        btnNextPage.style.cursor = canGoNext ? 'pointer' : 'not-allowed';
    }
}

function switchToPage(index) {
    if (!cropperPages || index < 0 || index >= cropperPages.length) return;
    currentCropperPageIndex = index;
    const pageItem = cropperPages[index];
    const src = typeof pageItem === 'string' ? pageItem : pageItem?.dataUrl;
    if (!src) return;

    const { image, slider, angleLabel } = getElements();
    baseRotation = 0;
    if (slider) slider.value = 0;
    if (angleLabel) angleLabel.textContent = '0°';

    updatePageSelectorUI();

    if (passportCropperInstance) {
        passportCropperInstance.replace(src);
    } else if (image) {
        image.src = src;
        initCropperInstance();
    }
}

function initCropperInstance() {
    const { image } = getElements();
    if (!image) return;

    if (passportCropperInstance) {
        passportCropperInstance.destroy();
        passportCropperInstance = null;
    }

    passportCropperInstance = new window.Cropper(image, {
        viewMode: 1,
        dragMode: 'move',
        aspectRatio: currentAspectRatio,
        autoCropArea: 0.5,
        restore: false,
        guides: true,
        center: true,
        highlight: true,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        ready() {
            const imgData = passportCropperInstance.getImageData();
            baseRotation = imgData.rotate || 0;
            applyRotation();
        }
    });
}

function applyRotation() {
    if (!passportCropperInstance) return;
    const { slider, angleLabel } = getElements();
    const fineTune = slider ? (parseFloat(slider.value) || 0) : 0;
    const totalRotation = baseRotation + fineTune;

    passportCropperInstance.rotateTo(totalRotation);

    if (angleLabel) {
        const displayAngle = Math.round(totalRotation * 10) / 10;
        angleLabel.textContent = `${displayAngle > 0 ? '+' : ''}${displayAngle}°`;
    }
}

export function closePassportCropper() {
    if (passportCropperInstance) {
        passportCropperInstance.destroy();
        passportCropperInstance = null;
    }
    const { modal, image, slider, angleLabel, pageSelector } = getElements();
    if (modal) modal.classList.remove('show');
    if (image) image.src = '';
    if (slider) slider.value = 0;
    if (angleLabel) angleLabel.textContent = '0°';
    if (pageSelector) pageSelector.style.display = 'none';
    baseRotation = 0;
    cropperPages = [];
    currentCropperPageIndex = 0;
    window.dispatchEvent(new CustomEvent('ykn:cropper-closed'));
}

export function isPassportCropperOpen() {
    const { modal } = getElements();
    return modal && modal.classList.contains('show');
}

export function appendPassportPages(newPages) {
    if (!newPages || newPages.length === 0) return;
    const formatted = newPages.map((p, idx) => {
        if (typeof p === 'string') return { dataUrl: p, pageNumber: cropperPages.length + idx + 1 };
        return p;
    });
    cropperPages = [...cropperPages, ...formatted];
    updatePageSelectorUI();
}

export function openPassportCropper({ imageSrc, pages = [], initialPageIndex = 0, studentName = '', passportNo = '' }) {
    if (pages && pages.length > 0) {
        cropperPages = pages.map((p, idx) => {
            if (typeof p === 'string') return { dataUrl: p, pageNumber: idx + 1 };
            return p;
        });
        currentCropperPageIndex = Math.max(0, Math.min(initialPageIndex, cropperPages.length - 1));
    } else if (imageSrc) {
        cropperPages = [{ dataUrl: imageSrc, pageNumber: 1 }];
        currentCropperPageIndex = 0;
    } else {
        showToast('Pasaport görseli henüz yüklenmedi.', 'warning');
        return;
    }

    const activeSrc = cropperPages[currentCropperPageIndex]?.dataUrl || imageSrc;
    const { modal, image, slider, angleLabel, btnAspectRatio } = getElements();
    if (!modal || !image) return;

    if (passportCropperInstance) {
        passportCropperInstance.destroy();
        passportCropperInstance = null;
    }

    currentStudentInfo = { name: studentName, passport: passportNo };
    baseRotation = 0;
    if (slider) slider.value = 0;
    if (angleLabel) angleLabel.textContent = '0°';
    currentAspectRatio = 3 / 4;
    if (btnAspectRatio) btnAspectRatio.textContent = 'Oran: 3:4 (Vesikalık)';

    updatePageSelectorUI();

    image.src = activeSrc;
    modal.classList.add('show');

    initCropperInstance();
}

function sanitizeFileName(name) {
    if (!name) return 'ogrenci';
    return name
        .toLocaleLowerCase('tr-TR')
        .replace(/[ç]/g, 'c')
        .replace(/[ğ]/g, 'g')
        .replace(/[ı]/g, 'i')
        .replace(/[ö]/g, 'o')
        .replace(/[ş]/g, 's')
        .replace(/[ü]/g, 'u')
        .replace(/[^a-z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .toUpperCase();
}

function downloadCroppedImage(autoTransfer = false) {
    if (!passportCropperInstance) return;

    const canvas = passportCropperInstance.getCroppedCanvas({
        maxWidth: 800,
        maxHeight: 1060,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high'
    });

    if (!canvas) {
        showToast('Görsel kırpılamadı.', 'error');
        return;
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const baseName = currentStudentInfo.name
        ? sanitizeFileName(currentStudentInfo.name)
        : (currentStudentInfo.passport || 'ogrenci');
    const fileName = `${baseName}_foto.jpg`;

    // Dosyayı kullanıcı bilgisayarına da indir (güvenli yerel yedek)
    canvas.toBlob((blob) => {
        if (blob) {
            const downloadUrl = URL.createObjectURL(blob);
            const downloadLink = document.createElement('a');
            downloadLink.href = downloadUrl;
            downloadLink.download = fileName;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000);
        }
    }, 'image/jpeg', 0.92);

    // Panoya da kopyalamayı dene (opsiyonel kolaylık)
    try {
        canvas.toBlob((pngBlob) => {
            if (pngBlob && window.ClipboardItem && navigator.clipboard?.write) {
                navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]).catch(() => {});
            }
        }, 'image/png');
    } catch (_) {}

    // Kırpılan fotoğrafı web uygulamasına ve YÖKSİS aktarım mekanizmasına ilet
    window.dispatchEvent(new CustomEvent('ykn:photo-cropped', {
        detail: {
            dataUrl,
            fileName,
            studentInfo: currentStudentInfo,
            autoTransfer
        }
    }));

    if (autoTransfer) {
        showToast('Fotoğraf hazırlandı; YÖKSİS’e aktarılıyor...', 'info');
    } else {
        showToast(`Fotoğraf hazırlandı ve indirildi: ${fileName}`, 'success');
    }
    closePassportCropper();
}

export function initPassportCropperModal() {
    const {
        modal,
        slider,
        btnRotateLeft,
        btnRotateRight,
        btnFineMinus,
        btnFinePlus,
        btnAspectRatio,
        btnDownload,
        btnTransfer,
        btnCancel,
        btnClose,
        btnPrevPage,
        btnNextPage
    } = getElements();

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closePassportCropper();
        });
    }

    // 90 Derece Sola Döndür
    if (btnRotateLeft) {
        btnRotateLeft.addEventListener('click', () => {
            baseRotation -= 90;
            applyRotation();
        });
    }

    // 90 Derece Sağa Döndür
    if (btnRotateRight) {
        btnRotateRight.addEventListener('click', () => {
            baseRotation += 90;
            applyRotation();
        });
    }

    // İnce Ayar Kaydırıcı
    if (slider) {
        slider.addEventListener('input', () => {
            applyRotation();
        });
    }

    // İnce Ayar [-]
    if (btnFineMinus) {
        btnFineMinus.addEventListener('click', () => {
            if (slider) {
                slider.value = Math.max(-15, (parseFloat(slider.value) || 0) - 0.5);
                applyRotation();
            }
        });
    }

    // İnce Ayar [+]
    if (btnFinePlus) {
        btnFinePlus.addEventListener('click', () => {
            if (slider) {
                slider.value = Math.min(15, (parseFloat(slider.value) || 0) + 0.5);
                applyRotation();
            }
        });
    }

    // En/Boy Oranı Değiştir
    if (btnAspectRatio) {
        btnAspectRatio.addEventListener('click', () => {
            if (!passportCropperInstance) return;
            if (currentAspectRatio === 3 / 4) {
                currentAspectRatio = NaN; // Free ratio
                btnAspectRatio.textContent = 'Oran: Serbest';
                passportCropperInstance.setAspectRatio(NaN);
            } else {
                currentAspectRatio = 3 / 4;
                btnAspectRatio.textContent = 'Oran: 3:4 (Vesikalık)';
                passportCropperInstance.setAspectRatio(3 / 4);
            }
        });
    }

    // İndir
    if (btnDownload) {
        btnDownload.addEventListener('click', () => downloadCroppedImage(false));
    }

    // Kırp ve YÖKSİS'e Aktar
    if (btnTransfer) {
        btnTransfer.addEventListener('click', () => downloadCroppedImage(true));
    }

    // Sayfa değiştirme butonları
    if (btnPrevPage) {
        btnPrevPage.addEventListener('click', () => {
            if (currentCropperPageIndex > 0) {
                switchToPage(currentCropperPageIndex - 1);
            }
        });
    }

    if (btnNextPage) {
        btnNextPage.addEventListener('click', () => {
            if (currentCropperPageIndex < cropperPages.length - 1) {
                switchToPage(currentCropperPageIndex + 1);
            }
        });
    }

    // Kapat butonları
    if (btnCancel) btnCancel.addEventListener('click', closePassportCropper);
    if (btnClose) btnClose.addEventListener('click', closePassportCropper);
}
