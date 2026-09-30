import { normalizeMrzLine } from './normalization.js';

function readTd3Lines(text) {
    const lines = text.split(/\r?\n/).map(normalizeMrzLine);
    for (let index = 0; index < lines.length; index += 1) {
        const firstLine = lines[index].match(/P<[A-Z]{3}[A-Z<]{39}/)?.[0];
        if (!firstLine) continue;
        const secondLine = lines.slice(index + 1)
            .map((line) => line.match(/[A-Z0-9<]{44}/)?.[0])
            .find(Boolean);
        if (secondLine) return { firstLine, secondLine };
    }
    return null;
}

function readCheckDigitValue(value) {
    return [...value].reduce((total, character, index) => {
        const characterValue = character === '<' ? 0
            : (/[0-9]/.test(character) ? Number(character) : character.charCodeAt(0) - 55);
        return total + characterValue * [7, 3, 1][index % 3];
    }, 0) % 10;
}

function hasValidCheckDigit(value, checkDigit) {
    return /^\d$/.test(checkDigit) && readCheckDigitValue(value) === Number(checkDigit);
}

/**
 * Finds one complete TD3 passport MRZ pair and reports independently verified fields.
 * @param {string} text OCR text.
 * @returns {{firstLine: string, secondLine: string}|null} Complete TD3 MRZ pair when found.
 */
export function findTd3Mrz(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    return readTd3Lines(text);
}

/**
 * Validates an MRZ field's ICAO check digit.
 * @param {string} value MRZ field value.
 * @param {string} checkDigit Single decimal check digit.
 * @returns {boolean} Whether the check digit matches.
 */
export function isValidMrzCheckDigit(value, checkDigit) {
    return hasValidCheckDigit(value, checkDigit);
}
