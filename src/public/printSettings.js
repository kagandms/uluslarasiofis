const ALLOWED_PAPER_SIZES = new Set(['A4', 'A3']);
const ALLOWED_COLOR_MODES = new Set(['monochrome', 'color']);
const ALLOWED_DUPLEX_MODES = new Set(['simplex', 'duplexlong']);
const ALLOWED_ORIENTATIONS = new Set(['portrait', 'landscape']);

export const DEFAULT_PRINT_SETTINGS = Object.freeze({
    paper_size: 'A4', color_mode: 'monochrome', duplex: 'simplex', orientation: 'portrait', copies: '1'
});

export function normalizePrintCapabilities(input) {
    return Object.freeze({
        paper_sizes: normalizeOptionList(input?.paper_sizes, ALLOWED_PAPER_SIZES, 'A4'),
        color_modes: normalizeOptionList(input?.color_modes, ALLOWED_COLOR_MODES, 'monochrome'),
        duplex_modes: normalizeOptionList(input?.duplex_modes, ALLOWED_DUPLEX_MODES, 'simplex'),
        orientations: normalizeOptionList(input?.orientations, ALLOWED_ORIENTATIONS, 'portrait'),
        limits: Object.freeze({ max_copies: normalizeInteger(input?.limits?.max_copies, 3, 50),
            max_page_copies: normalizeInteger(input?.limits?.max_page_copies, 200, 1000) })
    });
}

export function createPrintUploadPayload({ file, settings, tokens }) {
    return {
        byte_size: file.size,
        media_type: file.type,
        paper_size: settings.paper_size,
        color_mode: settings.color_mode,
        duplex: settings.duplex,
        orientation: settings.orientation,
        copies: Number(settings.copies),
        ...tokens
    };
}

export function arePrintSettingsAvailable(settings, capabilities) {
    return capabilities.paper_sizes.includes(settings.paper_size)
        && capabilities.color_modes.includes(settings.color_mode)
        && capabilities.duplex_modes.includes(settings.duplex)
        && capabilities.orientations.includes(settings.orientation);
}

export function getMaximumCopies(capabilities, pageCount) {
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) return capabilities.limits.max_copies;
    return Math.min(capabilities.limits.max_copies, Math.floor(capabilities.limits.max_page_copies / pageCount));
}

export function isValidCopies(value, maximum) {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return false;
    const copies = Number(value);
    return Number.isSafeInteger(copies) && copies <= maximum;
}

export function summarizePrintSettings(settings) {
    const paper = settings.paper_size;
    const color = settings.color_mode === 'color' ? 'Renkli' : 'Siyah-beyaz';
    const sides = settings.duplex === 'duplexlong' ? 'Çift taraflı (uzun kenardan çevir)' : 'Tek taraflı';
    const orientation = settings.orientation === 'landscape' ? 'Yatay' : 'Dikey';
    return `${paper} · ${color} · ${sides} · ${orientation} · ${settings.copies} kopya`;
}

function normalizeInteger(value, fallback, maximum) {
    return Number.isSafeInteger(value) && value >= 1 && value <= maximum ? value : fallback;
}

function normalizeOptionList(values, whitelist, defaultValue) {
    if (!Array.isArray(values)) return Object.freeze([defaultValue]);
    const valid = values.filter((value) => whitelist.has(value));
    return Object.freeze(valid.includes(defaultValue) ? [...new Set(valid)] : [defaultValue]);
}
