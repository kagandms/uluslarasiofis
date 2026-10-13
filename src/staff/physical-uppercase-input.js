/** Keeps identity fields uppercase while preserving caret and IME composition.
 * @param {HTMLInputElement} input Identity field.
 * @param {Function} onChange Receives the normalized value.
 * @returns {void} Installs input listeners.
 */
export function bindPhysicalUppercaseInput(input, onChange) {
    const locale = input.name === 'passport_number' ? 'en-US' : 'tr-TR';
    input.autocapitalize = 'characters';
    const update = () => {
        const original = input.value;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = original.toLocaleUpperCase(locale);
        if (start !== null && end !== null) {
            input.setSelectionRange(original.slice(0, start).toLocaleUpperCase(locale).length,
                original.slice(0, end).toLocaleUpperCase(locale).length);
        }
        onChange(input.value);
    };
    input.addEventListener('input', event => { if (!event.isComposing) update(); });
    input.addEventListener('compositionend', update);
    update();
}
