import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { getCountryName } from './countryData.js';
import { isValidPhoneNumber } from '../shared/phoneNumber.js';

/** @param {string} locale @returns {Array<{code: string, callingCode: string, label: string}>} */
export function listPhoneCountryOptions(locale) {
    return getCountries().map((code) => {
        const callingCode = `+${getCountryCallingCode(code)}`;
        return { code, callingCode, label: `${getCountryName(code, locale)} (${callingCode})` };
    }).sort((left, right) => left.label.localeCompare(right.label, locale));
}

/** @param {string} value @param {string} defaultCountry @returns {{e164: string, country: string|null, formattedNational: string, isPossible: boolean, isInternational: boolean, needsCountryReview: boolean}} */
export function parsePhoneInput(value, defaultCountry = 'TR') {
    const input = String(value || '').trim();
    const isInternational = input.startsWith('+');
    const parsed = isInternational
        ? parsePhoneNumberFromString(input, { extract: false })
        : parsePhoneNumberFromString(input, defaultCountry, { extract: false });
    const isPossible = Boolean(parsed?.isPossible());
    const country = isPossible ? parsed.country || null : null;
    return {
        e164: isPossible ? parsed.number : input,
        country,
        formattedNational: isPossible ? parsed.formatNational() : input,
        isPossible,
        isInternational,
        needsCountryReview: isInternational && isPossible && country === null
    };
}

/** @param {Document} document @param {{value: string, locale: string, messages: object}} options @returns {HTMLElement} */
export function createPhoneField(document, { value, locale, messages, country = '' }) {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    const countryLabel = document.createElement('label');
    const countrySelect = document.createElement('select');
    const phoneInput = document.createElement('input');
    const storedPhone = String(value || '');
    const initialPhone = storedPhone.startsWith('+') ? parsePhoneInput(storedPhone, 'TR') : null;
    const isExistingValue = storedPhone.length > 0;
    const initialCountry = country || initialPhone?.country || (initialPhone?.needsCountryReview ? '' : 'TR');
    wrapper.className = 'phone-field application-form-field';
    label.htmlFor = 'field-student_phone_local';
    label.textContent = messages.phone;
    countryLabel.className = 'phone-country-label';
    countryLabel.htmlFor = 'field-phone-country';
    countryLabel.textContent = messages.phoneCountryLabel;
    countrySelect.className = 'phone-country-select';
    countrySelect.id = 'field-phone-country';
    countrySelect.name = 'phone_country';
    countrySelect.setAttribute('aria-label', messages.phoneCountryLabel);
    const initialCountryMatchesCallingCode = initialPhone?.needsCountryReview && initialCountry
        && storedPhone.startsWith(`+${getCountryCallingCode(initialCountry)}`);
    if (initialPhone?.needsCountryReview && !initialCountryMatchesCallingCode) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = messages.phoneCountryChoose;
        countrySelect.append(placeholder);
    }
    listPhoneCountryOptions(locale).forEach((country) => {
        const option = document.createElement('option');
        option.value = country.code;
        option.textContent = country.label;
        countrySelect.append(option);
    });
    countrySelect.value = initialCountry;
    phoneInput.id = 'field-student_phone_local';
    phoneInput.type = 'tel';
    phoneInput.required = true;
    phoneInput.setAttribute('aria-required', 'true');
    phoneInput.maxLength = 40;
    phoneInput.autocomplete = 'tel-national';
    phoneInput.value = initialPhone?.isPossible && initialPhone.country ? initialPhone.formattedNational : storedPhone;
    phoneInput.setAttribute('aria-describedby', 'phone-input-help phone-input-error');
    phoneInput.dataset.phoneVisible = 'true';

    const canonicalInput = document.createElement('input');
    canonicalInput.type = 'hidden';
    canonicalInput.name = 'student_phone';
    canonicalInput.value = storedPhone;
    canonicalInput.dataset.phonePossible = String(isExistingValue ? Boolean(storedPhone.trim()) : false);

    const help = document.createElement('small');
    help.id = 'phone-input-help';
    help.className = 'phone-field-help';
    help.textContent = messages.phoneCountryHelp;
    const error = document.createElement('small');
    error.id = 'phone-input-error';
    error.className = 'phone-field-error';
    error.hidden = true;
    error.setAttribute('role', 'status');

    let isUnchangedLegacyValue = isExistingValue;
    function updatePhone() {
        const selectedCountry = countrySelect.value;
        const parsed = parsePhoneInput(phoneInput.value, selectedCountry || 'TR');
        const callingCodeMatches = selectedCountry
            && phoneInput.value.trim().startsWith(`+${getCountryCallingCode(selectedCountry)}`);
        const hasResolvedCountry = parsed.country ? selectedCountry === parsed.country
            : !parsed.needsCountryReview || Boolean(callingCodeMatches);
        const isValid = isUnchangedLegacyValue
            ? isValidPhoneNumber(canonicalInput.value)
            : parsed.isPossible && hasResolvedCountry && Boolean(selectedCountry);
        canonicalInput.value = isValid && parsed.isPossible ? parsed.e164 : phoneInput.value.trim();
        canonicalInput.dataset.phonePossible = String(isValid);
        phoneInput.dataset.phonePossible = String(isValid);
        phoneInput.setAttribute('aria-invalid', String(!isValid));
        error.hidden = isValid;
        error.textContent = parsed.needsCountryReview ? messages.phoneCountryReview
            : (!isValid && parsed.isInternational && parsed.country ? messages.phoneCountryMismatch : messages.contactPhoneInvalid);
        canonicalInput.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    }
    phoneInput.addEventListener('input', () => {
        isUnchangedLegacyValue = false;
        const previousCountry = countrySelect.value;
        const parsed = parsePhoneInput(phoneInput.value, countrySelect.value || 'TR');
        if (parsed.isInternational && parsed.isPossible && parsed.country) countrySelect.value = parsed.country;
        if (parsed.needsCountryReview) countrySelect.value = '';
        updatePhone();
        if (parsed.isInternational && parsed.country && previousCountry && previousCountry !== parsed.country) {
            error.hidden = false;
            error.textContent = messages.phoneCountryMismatch;
        }
    });
    countrySelect.addEventListener('change', () => {
        isUnchangedLegacyValue = false;
        const parsed = parsePhoneInput(phoneInput.value, countrySelect.value || 'TR');
        const hasCountryMismatch = parsed.isInternational && parsed.country && countrySelect.value !== parsed.country;
        if (hasCountryMismatch) {
            countrySelect.value = parsed.country;
        }
        updatePhone();
        if (hasCountryMismatch) {
            error.hidden = false;
            error.textContent = messages.phoneCountryMismatch;
        }
    });
    if (initialPhone?.isPossible) canonicalInput.value = initialPhone.e164;
    const isInitialValueValid = initialPhone?.isPossible && (!initialPhone.needsCountryReview || initialCountryMatchesCallingCode)
        || (isExistingValue && !storedPhone.startsWith('+') && isValidPhoneNumber(storedPhone));
    canonicalInput.dataset.phonePossible = String(Boolean(isInitialValueValid));
    phoneInput.dataset.phonePossible = String(Boolean(isInitialValueValid));
    phoneInput.setAttribute('aria-invalid', String(!isInitialValueValid));
    if (initialPhone?.needsCountryReview && !initialCountryMatchesCallingCode) {
        error.hidden = false;
        error.textContent = messages.phoneCountryReview;
    }
    wrapper.append(label, countryLabel, countrySelect, phoneInput, canonicalInput, help, error);
    return wrapper;
}
