(() => {
    function normalizeText(value) {
        return String(value || '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    }

    function normalizeDate(value) {
        const text = String(value || '').trim();
        const yearFirst = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
        const dayFirst = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
        const parts = yearFirst
            ? [Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3])]
            : dayFirst ? [Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1])] : null;
        if (!parts) return '';

        const [year, month, day] = parts;
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    function matches(options) {
        const expectedPassport = normalizeText(options.expectedPassport);
        const currentDocument = normalizeText(options.currentDocument);
        const hasPassportMismatch = Boolean(expectedPassport && currentDocument && expectedPassport !== currentDocument);
        const nameMatches = normalizeText(options.expectedName) === normalizeText(options.currentName)
            && Boolean(normalizeText(options.expectedName));
        const surnameMatches = normalizeText(options.expectedSurname) === normalizeText(options.currentSurname)
            && Boolean(normalizeText(options.expectedSurname));
        const expectedBirthDate = normalizeDate(options.expectedBirthDate);
        const currentBirthDate = normalizeDate(options.currentBirthDate);

        if (expectedPassport && currentDocument && !hasPassportMismatch) return true;
        if (!nameMatches || !surnameMatches) return hasPassportMismatch ? false : null;
        if (hasPassportMismatch) return Boolean(expectedBirthDate && currentBirthDate && expectedBirthDate === currentBirthDate);
        if (expectedBirthDate && currentBirthDate) return expectedBirthDate === currentBirthDate;
        return true;
    }

    globalThis.YknStudentIdentity = Object.freeze({ matches });
})();
