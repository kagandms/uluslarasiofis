import { IMAGE_CONFIG } from '../config/constants.js';

let cropperInstance = null;
let baseRotation = 0;
let currentImageObj = null;
let customOptions = null; // store custom options like isPage2

const cropperModal = document.getElementById('cropper-modal');
const cropperImage = document.getElementById('cropper-image');
const rotationSlider = document.getElementById('rotation-slider');

export function updateCropperRotation() {
    if (cropperInstance) {
        const fineTune = parseFloat(rotationSlider.value) || 0;
        cropperInstance.rotateTo(baseRotation + fineTune);
    }
}

export function showCropperForFile(img, options) {
    if (!cropperModal || !cropperImage) return;

    currentImageObj = img;
    cropperImage.src = img.src;
    cropperModal.style.display = 'flex';
    customOptions = options || {};

    if (rotationSlider) rotationSlider.value = 0;
    baseRotation = 0;

    // Display correct buttons based on state
    const btnSkipCaptureNext = document.getElementById('btn-skip-capture-next');
    const btnCropCaptureNext = document.getElementById('btn-crop-capture-next');
    const btnCropNext = document.getElementById('btn-crop-next');
    const btnCropConfirm = document.getElementById('btn-crop-confirm');
    const btnCropSkip = document.getElementById('btn-crop-skip');
    const btnCropAddStudent = document.getElementById('btn-crop-add-student');
    const btnCropSkipAddStudent = document.getElementById('btn-crop-skip-add-student');

    
    
    if (customOptions.hasMoreFiles) {
        if (btnCropConfirm) btnCropConfirm.style.display = 'none';
        if (btnCropSkip) btnCropSkip.style.display = 'none';
        if (btnCropCaptureNext) btnCropCaptureNext.style.display = 'none';
        if (btnSkipCaptureNext) btnSkipCaptureNext.style.display = 'none';
        if (btnCropNext) btnCropNext.style.display = 'flex';
        if (btnCropAddStudent) btnCropAddStudent.style.display = 'none';
        if (btnCropSkipAddStudent) btnCropSkipAddStudent.style.display = 'none';
    } else if (customOptions.isFirstImage && !customOptions.isPage2) {
        if (btnCropConfirm) btnCropConfirm.style.display = 'flex';
        if (btnCropSkip) btnCropSkip.style.display = 'flex';
        if (btnCropCaptureNext) btnCropCaptureNext.style.display = 'flex';
        if (btnSkipCaptureNext) btnSkipCaptureNext.style.display = 'flex';
        if (btnCropNext) btnCropNext.style.display = 'none';
        if (btnCropAddStudent) btnCropAddStudent.style.display = 'none';
        if (btnCropSkipAddStudent) btnCropSkipAddStudent.style.display = 'none';
    } else {
        if (btnCropConfirm) btnCropConfirm.style.display = 'flex';
        if (btnCropSkip) btnCropSkip.style.display = 'flex';
        if (btnCropCaptureNext) btnCropCaptureNext.style.display = 'none';
        if (btnSkipCaptureNext) btnSkipCaptureNext.style.display = 'none';
        if (btnCropNext) btnCropNext.style.display = 'none';
        if (btnCropAddStudent) btnCropAddStudent.style.display = 'flex';
        if (btnCropSkipAddStudent) btnCropSkipAddStudent.style.display = 'flex';
    }

    cropperInstance = new window.Cropper(cropperImage, {
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 0.9,
        restore: false,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        ready() {
            // Telefonla çekilen fotoğrafların EXIF dönüş yönünü (örn: 90 derece)
            // sıfırlamamak için resmin mevcut rotasyonunu temel (base) olarak alıyoruz.
            const imageData = cropperInstance.getImageData();
            baseRotation = imageData.rotate || 0;
            
            window.dispatchEvent(new CustomEvent('cropperReady'));
        }
    });
}

export function getCroppedImage(callback) {
    if (!cropperInstance) {
        callback(currentImageObj);
        return;
    }

    const canvas = cropperInstance.getCroppedCanvas({
        maxWidth: IMAGE_CONFIG.CROPPER_MAX_DIMENSION,
        maxHeight: IMAGE_CONFIG.CROPPER_MAX_DIMENSION,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
    });

    if (canvas) {
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => callback(img);
            img.src = url;
        }, 'image/jpeg', IMAGE_CONFIG.CROPPER_QUALITY);
    } else {
        callback(currentImageObj);
    }
}

export function cleanupCropper() {
    if (cropperInstance) {
        cropperInstance.destroy();
        cropperInstance = null;
    }
    if (cropperModal) {
        cropperModal.style.display = 'none';
    }
    currentImageObj = null;
    if (rotationSlider) rotationSlider.value = 0;
    baseRotation = 0;
    customOptions = null;
}

export function initCropperControls(handlers) {
    if (rotationSlider) {
        rotationSlider.addEventListener('input', updateCropperRotation);
    }
    
    document.getElementById('btn-crop-cancel')?.addEventListener('click', handlers.onCancel);
    document.getElementById('btn-crop-skip')?.addEventListener('click', handlers.onSkip);
    document.getElementById('btn-crop-confirm')?.addEventListener('click', handlers.onConfirm);
    document.getElementById('btn-crop-next')?.addEventListener('click', handlers.onNext);
    document.getElementById('btn-skip-capture-next')?.addEventListener('click', handlers.onSkipCaptureNext);
    document.getElementById('btn-crop-capture-next')?.addEventListener('click', handlers.onCropCaptureNext);
    document.getElementById('btn-crop-add-student')?.addEventListener('click', handlers.onCropAddStudent);
    document.getElementById('btn-crop-skip-add-student')?.addEventListener('click', handlers.onCropSkipAddStudent);
}
