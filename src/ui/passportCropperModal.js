import { showToast } from './toastManager.js';

let passportCropperInstance = null;
let baseRotation = 0; // 0, 90, 180, 270...
let currentStudentInfo = { name: '', passport: '' };
let currentAspectRatio = 3 / 4; // Standard biometric portrait ratio

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
        btnCancel: document.getElementById('btn-passport-crop-cancel'),
        btnClose: document.getElementById('btn-passport-crop-close')
    };
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
    const { modal, image, slider, angleLabel } = getElements();
    if (modal) modal.classList.remove('show');
    if (image) image.src = '';
    if (slider) slider.value = 0;
    if (angleLabel) angleLabel.textContent = '0°';
    baseRotation = 0;
}

export function isPassportCropperOpen() {
    const { modal } = getElements();
    return modal && modal.classList.contains('show');
}

export function openPassportCropper({ imageSrc, studentName = '', passportNo = '' }) {
    if (!imageSrc) {
        showToast('Pasaport görseli henüz yüklenmedi.', 'warning');
        return;
    }

    const { modal, image, slider, angleLabel, btnAspectRatio } = getElements();
    if (!modal || !image) return;

    // Önceki açık varsa temizle
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

    image.src = imageSrc;
    modal.classList.add('show');

    // Cropper instance oluştur
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

function downloadCroppedImage() {
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

    canvas.toBlob((blob) => {
        if (!blob) {
            showToast('Dosya oluşturulamadı.', 'error');
            return;
        }

        const baseName = currentStudentInfo.name
            ? sanitizeFileName(currentStudentInfo.name)
            : (currentStudentInfo.passport || 'ogrenci');
        const fileName = `${baseName}_foto.jpg`;

        const downloadUrl = URL.createObjectURL(blob);
        const downloadLink = document.createElement('a');
        downloadLink.href = downloadUrl;
        downloadLink.download = fileName;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000);

        // Panoya da kopyalamayı dene (opsiyonel kolaylık)
        try {
            canvas.toBlob((pngBlob) => {
                if (pngBlob && window.ClipboardItem && navigator.clipboard?.write) {
                    navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]).catch(() => {});
                }
            }, 'image/png');
        } catch (_) {}

        showToast(`Fotoğraf indirildi: ${fileName}`, 'success');
        closePassportCropper();
    }, 'image/jpeg', 0.92);
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
        btnCancel,
        btnClose
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
        btnDownload.addEventListener('click', downloadCroppedImage);
    }

    // Kapat butonları
    if (btnCancel) btnCancel.addEventListener('click', closePassportCropper);
    if (btnClose) btnClose.addEventListener('click', closePassportCropper);
}
