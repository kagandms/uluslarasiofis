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

    function explain(options) {
        const opts = options || {};
        const expectedPassport = normalizeText(opts.expectedPassport);
        const currentDocument = normalizeText(opts.currentDocument);
        const expectedName = normalizeText(opts.expectedName);
        const currentName = normalizeText(opts.currentName);
        const expectedSurname = normalizeText(opts.expectedSurname);
        const currentSurname = normalizeText(opts.currentSurname);
        const expectedBirthDate = normalizeDate(opts.expectedBirthDate);
        const currentBirthDate = normalizeDate(opts.currentBirthDate);
        const hasBothBirthDates = Boolean(expectedBirthDate && currentBirthDate);
        const [expYear, expMonth, expDay] = hasBothBirthDates ? expectedBirthDate.split('-') : [];
        const [curYear, curMonth, curDay] = hasBothBirthDates ? currentBirthDate.split('-') : [];
        const birthYearEqual = hasBothBirthDates && expYear === curYear;
        const birthMonthEqual = hasBothBirthDates && expMonth === curMonth;
        const birthDayEqual = hasBothBirthDates && expDay === curDay;
        const birthDayMonthSwappedEqual = hasBothBirthDates
            && birthYearEqual
            && expDay === curMonth
            && expMonth === curDay;

        return {
            expectedPassportPresent: Boolean(expectedPassport),
            currentDocumentPresent: Boolean(currentDocument),
            passportEqual: Boolean(expectedPassport && currentDocument && expectedPassport === currentDocument),
            passportMismatch: Boolean(expectedPassport && currentDocument && expectedPassport !== currentDocument),
            expectedNamePresent: Boolean(expectedName),
            nameEqual: Boolean(expectedName && currentName && expectedName === currentName),
            expectedSurnamePresent: Boolean(expectedSurname),
            surnameEqual: Boolean(expectedSurname && currentSurname && expectedSurname === currentSurname),
            expectedBirthDatePresent: Boolean(String(opts.expectedBirthDate || '').trim()),
            expectedBirthDateValid: Boolean(expectedBirthDate),
            currentBirthDatePresent: Boolean(String(opts.currentBirthDate || '').trim()),
            currentBirthDateValid: Boolean(currentBirthDate),
            birthDateEqual: Boolean(expectedBirthDate && currentBirthDate && expectedBirthDate === currentBirthDate),
            birthYearEqual,
            birthMonthEqual,
            birthDayEqual,
            birthDayMonthSwappedEqual,
            result: matches(opts)
        };
    }

    globalThis.YknStudentIdentity = Object.freeze({ matches, explain });
})();
