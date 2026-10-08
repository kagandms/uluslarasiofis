import { ApiError } from './errors.js';

function rejectJpeg() {
    throw new ApiError(415, 'PHOTO_FORMAT', 'Tek, eksiksiz JPG fotoğraf gerekli.');
}

function findNextMarker(bytes, start) {
    let offset = start;
    while (offset < bytes.length - 1) {
        if (bytes[offset] !== 255) { offset += 1; continue; }
        const markerStart = offset;
        while (bytes[offset] === 255) offset += 1;
        const marker = bytes[offset];
        if (marker === 0 || marker >= 208 && marker <= 215) { offset += 1; continue; }
        return markerStart;
    }
    return rejectJpeg();
}

function readSegmentEnd(bytes, offset) {
    if (offset + 2 > bytes.length) return rejectJpeg();
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return rejectJpeg();
    return offset + length;
}

/** Rejects appended archives and concatenated images before private upload/scanning.
 * @param {Uint8Array} bytes One JPEG container. @returns {void} Valid exact container boundary.
 * @throws {ApiError} Truncated, malformed or multiple containers.
 */
export function requireSingleJpegContainer(bytes) {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return rejectJpeg();
    let offset = 2;
    let hasImageScan = false;
    while (offset < bytes.length) {
        if (bytes[offset] !== 255) return rejectJpeg();
        while (bytes[offset] === 255) offset += 1;
        const marker = bytes[offset++];
        if (marker === 217) {
            if (!hasImageScan || offset !== bytes.length) return rejectJpeg();
            return;
        }
        if (marker === 0 || marker === 216 || marker >= 208 && marker <= 215) return rejectJpeg();
        offset = readSegmentEnd(bytes, offset);
        if (marker === 218) { hasImageScan = true; offset = findNextMarker(bytes, offset); }
    }
    return rejectJpeg();
}
