import { extractDatesFromMrz } from '../../utils/ykn-document-parser.js';
import { normalizeMrzDateDigits } from './normalization.js';
import { findTd3Mrz, isValidMrzCheckDigit } from './mrz.js';

function emptyCandidates() {
    return {
        first_name: null,
        last_name: null,
        passport_number: null,
        nationality: null,
        date_of_birth: null
    };
}

function readNameCandidates(firstLine) {
    const [surname, ...givenNameParts] = firstLine.slice(5).split('<<');
    const lastName = surname?.replace(/<+/g, ' ').trim() || '';
    const firstName = givenNameParts.join('<<').replace(/<+/g, ' ').trim();
    return {
        first_name: /^[A-Z]+(?: [A-Z]+)*$/.test(firstName) ? firstName : null,
        last_name: /^[A-Z]+(?: [A-Z]+)*$/.test(lastName) ? lastName : null
    };
}

function readPassportNumber(secondLine) {
    const number = secondLine.slice(0, 9).replace(/<+$/g, '');
    return /^[A-Z0-9]{1,9}$/.test(number) && isValidMrzCheckDigit(secondLine.slice(0, 9), secondLine[9])
        ? number : null;
}

function readDateOfBirth(secondLine) {
    const birthValue = normalizeMrzDateDigits(secondLine.slice(13, 19));
    if (!/^\d{6}$/.test(birthValue) || !isValidMrzCheckDigit(birthValue, secondLine[19])) return null;
    return extractDatesFromMrz(secondLine).birthDate || null;
}

/**
 * Extracts reviewable public application field candidates from a complete TD3 passport MRZ.
 * @param {unknown} text OCR text returned by a provider.
 * @returns {{first_name: string|null, last_name: string|null, passport_number: string|null, nationality: string|null, date_of_birth: string|null}} Candidate values only; unavailable or uncertain fields are null.
 */
export function extractPassportIdentityCandidates(text) {
    const mrz = findTd3Mrz(text);
    if (!mrz) return emptyCandidates();
    const names = readNameCandidates(mrz.firstLine);
    const nationality = /^[A-Z]{3}$/.test(mrz.secondLine.slice(10, 13))
        ? mrz.secondLine.slice(10, 13) : null;
    return {
        ...names,
        passport_number: readPassportNumber(mrz.secondLine),
        nationality,
        date_of_birth: readDateOfBirth(mrz.secondLine)
    };
}
