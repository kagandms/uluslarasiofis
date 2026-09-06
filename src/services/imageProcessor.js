import { IMAGE_CONFIG } from '../config/constants.js';

export function prepareImageForOCR(img) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const MAX_WIDTH = IMAGE_CONFIG.OCR_MAX_WIDTH;
    let width = img.width;
    let height = img.height;

    if (width > MAX_WIDTH) {
        const ratio = MAX_WIDTH / width;
        width = MAX_WIDTH;
        height = height * ratio;
    }

    canvas.width = width;
    canvas.height = height;

    ctx.filter = 'grayscale(100%) contrast(160%) brightness(105%)';
    ctx.drawImage(img, 0, 0, width, height);
    
    return { canvas };
}
