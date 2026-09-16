// Apply belgelerindeki kabul kodu ve pasaport alanlarını bağımlılıksız olarak
// okumak için eklentiye dahil edilen küçük parser.
(() => {
    const MONTHS = {
        jan: 1, january: 1, janv: 1, feb: 2, february: 2, fevr: 2, fev: 2, mar: 3, march: 3,
        apr: 4, april: 4, avr: 4, may: 5, mai: 5, jun: 6, june: 6, juin: 6, jul: 7, july: 7, juil: 7,
        aug: 8, august: 8, aout: 8, sep: 9, sept: 9, september: 9,
        oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
        ocak: 1, oca: 1, subat: 2, şubat: 2, sub: 2, şub: 2, mart: 3, mar: 3, nisan: 4, nis: 4,
        mayis: 5, mayıs: 5, may: 5, haziran: 6, haz: 6, temmuz: 7, tem: 7, agustos: 8, ağustos: 8, agu: 8, ağu: 8,
        eylul: 9, eylül: 9, eyl: 9, ekim: 10, eki: 10, kasim: 11, kasım: 11, kas: 11, aralik: 12, aralık: 12, ara: 12
    };

    function normalizeText(value) {
        return String(value || '')
            .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, ' ')
            .replace(/[–—−]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeForSearch(value) {
        return normalizeText(value)
            .toLocaleLowerCase('tr-TR')
            .replace(/ı/g, 'i')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function normalizeYoksisId(value) {
        return normalizeText(value)
            .replace(/\s*-\s*/g, '-')
            .replace(/\s+/g, '-')
            .toUpperCase();
    }

    function isValidYoksisId(value) {
        const id = normalizeYoksisId(value);
        return /^[A-Z0-9]{2,4}(?:-[A-Z0-9]{2,4}){2}$/.test(id)
            && /\d/.test(id)
            && !/(?:SVG|ICON|BTN|BADGE)/.test(id);
    }

    function extractYoksisIdFromText(text) {
        const source = normalizeText(text);
        const labeled = source.match(
            /(?:YÖKS[İI]S|YOKSIS|KABUL\s*MEKTUBU?|ACCEPTANCE\s*LETTER|VERIFICATION)\s*(?:ID|KODU|NO|CODE)?\s*[:#.\-]?\s*([A-Z0-9]{2,4}(?:\s*[-\s]\s*[A-Z0-9]{2,4}){2})/i
        );
        if (labeled && isValidYoksisId(labeled[1])) return normalizeYoksisId(labeled[1]);

        const candidates = source.match(/\b[A-Z0-9]{2,4}(?:(?:\s*[-\s]\s*)[A-Z0-9]{2,4}){2}\b/gi) || [];
        return candidates.map(normalizeYoksisId).find(isValidYoksisId) || '';
    }

    function normalizeYear(value) {
        const year = Number(value);
        if (!Number.isInteger(year)) return 0;
        if (String(value).length === 2) return year <= 49 ? 2000 + year : 1900 + year;
        return year >= 1920 && year <= 2045 ? year : 0;
    }

    function createDate(year, month, day) {
        if (!year || month < 1 || month > 12 || day < 1 || day > 31) return '';
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
        return date.toISOString().slice(0, 10);
    }

    function parseDateValue(value) {
        if (!value) return '';
        const source = normalizeForSearch(value).replace(/,/g, ' ').replace(/\//g, ' / ');
        const tokens = source.split(/[\s./\-]+/).filter(Boolean);
        if (tokens.length < 3) {
            const compact = source.replace(/\D/g, '');
            if (compact.length === 8) {
                const yearFirst = Number(compact.slice(0, 4)) >= 1920 && Number(compact.slice(0, 4)) <= 2050;
                return createDate(
                    normalizeYear(yearFirst ? compact.slice(0, 4) : compact.slice(4)),
                    Number(yearFirst ? compact.slice(4, 6) : compact.slice(2, 4)),
                    Number(yearFirst ? compact.slice(6) : compact.slice(0, 2))
                );
            }
            return '';
        }

        // Numeric parts (e.g. 10.09.2020, 10/09/2020, 10 09 2020, 2020-09-10)
        if (tokens.length === 3 && tokens.every((t) => /^\d+$/.test(t))) {
            const [first, second, third] = tokens;
            const yearFirst = first.length === 4 || Number(first) > 31;
            return createDate(
                normalizeYear(yearFirst ? first : third),
                Number(second),
                Number(yearFirst ? third : first)
            );
        }

        // Named month (e.g. 10 SEP 2020, 10 SEP / JUIN 2020, 10 September 2020)
        let monthIndex = -1;
        let month = 0;
        for (let i = 0; i < tokens.length; i++) {
            if (MONTHS[tokens[i]]) {
                monthIndex = i;
                month = MONTHS[tokens[i]];
                break;
            }
        }

        if (month > 0 && monthIndex !== -1) {
            const nums = [];
            for (let i = 0; i < tokens.length; i++) {
                if (i !== monthIndex && !MONTHS[tokens[i]] && /^\d+$/.test(tokens[i])) {
                    nums.push(Number(tokens[i]));
                }
            }
            if (nums.length === 2) {
                let day = 0;
                let year = 0;
                if (nums[0] > 31 || String(nums[0]).length === 4) {
                    year = normalizeYear(nums[0]);
                    day = nums[1];
                } else if (nums[1] > 31 || String(nums[1]).length === 4) {
                    year = normalizeYear(nums[1]);
                    day = nums[0];
                } else {
                    day = nums[0];
                    year = normalizeYear(nums[1]);
                }
                return createDate(year, month, day);
            }
        }

        return '';
    }

    function findDateAfterLabel(text, labels) {
        if (!text) return '';
        const source = String(text);
        const escaped = labels.map((l) => l.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
        const regex = new RegExp(`(?:${escaped})\\s*[:/#\\-]?\\s*([\\s\\S]{0,150})`, 'gi');
        let m;
        while ((m = regex.exec(source)) !== null) {
            const windowText = m[1];
            // Split window at next date label so we don't bleed into other fields
            const cutWindow = windowText.split(/(?:date\s+of|tarihi|düzenleme|geçerlilik|expiry|issue|délivrance|delivrance|expiration|birth|doğum|senesi|wagty|möhleti|mohleti)/i)[0] || windowText;

            const datePatterns = [
                /\b\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]{3,12}(?:\s*[\/\-]\s*[A-Za-zÇĞİÖŞÜçğıöşü]{3,12})?\s+\d{2,4}\b/g,
                /\b[A-Za-zÇĞİÖŞÜçğıöşü]{3,12}\s+\d{1,2}(?:st|nd|rd|th)?[,\s]+\d{2,4}\b/g,
                /\b\d{1,4}[./\-]\d{1,2}[./\-]\d{2,4}\b/g,
                /\b\d{1,2}\s+\d{1,2}\s+\d{2,4}\b/g
            ];

            for (const pattern of datePatterns) {
                const candidates = cutWindow.match(pattern) || [];
                for (const candidate of candidates) {
                    const parsed = parseDateValue(candidate);
                    if (parsed) return parsed;
                }
            }

            // Fallback: search across the full windowText if cut was too restrictive
            for (const pattern of datePatterns) {
                const candidates = windowText.match(pattern) || [];
                for (const candidate of candidates) {
                    const parsed = parseDateValue(candidate);
                    if (parsed) return parsed;
                }
            }
        }
        return '';
    }

    function extractDatesFromMrz(text) {
        const compact = String(text || '').replace(/[\s\r\n]+/g, '').toUpperCase();
        // Standard TD3 (passport) line 2
        let match = compact.match(/[A-Z0-9<]{9}[0-9A-Z<][A-Z<]{3}(\d{6})[0-9A-Z<]([MFX<])(\d{6})/);
        // Fallback: any 6 digits followed by check digit, sex (M/F), and 6 digits
        if (!match) {
            match = compact.match(/(\d{6})[0-9A-Z<]([MF])(\d{6})/);
        }
        if (!match) return { expiryDate: '', birthDate: '', cinsiyet: '' };

        const birthRaw = match[1];
        const sexRaw = match[2];
        const expiryRaw = match[3];

        const expiryYear = Number(expiryRaw.slice(0, 2));
        const expiryDate = createDate(
            expiryYear <= 49 ? 2000 + expiryYear : 1900 + expiryYear,
            Number(expiryRaw.slice(2, 4)),
            Number(expiryRaw.slice(4, 6))
        );

        const birthYear = Number(birthRaw.slice(0, 2));
        const currentYY = (new Date()).getFullYear() % 100;
        const birthDate = createDate(
            birthYear <= currentYY ? 2000 + birthYear : 1900 + birthYear,
            Number(birthRaw.slice(2, 4)),
            Number(birthRaw.slice(4, 6))
        );

        let cinsiyet = '';
        if (sexRaw === 'M') cinsiyet = 'Erkek';
        else if (sexRaw === 'F') cinsiyet = 'Kadın';

        return { expiryDate, birthDate, cinsiyet };
    }

    function extractPassportDates(text, options = {}) {
        let issueDate = findDateAfterLabel(text, [
            'date of issue', 'issue date', 'date issued', 'issuing date', 'issued on',
            'düzenleme tarihi', 'düzenlenme tarihi', 'veriliş tarihi', 'verilme tarihi',
            'tanzim tarihi', 'belge düzenleme tarihi', 'belge veriliş tarihi',
            'date de délivrance', 'date de delivrance', 'délivrance', 'delivrance',
            'date d\'émission', 'date d emission', 'émis le', 'emis le',
            'дата выдачи', 'дата выпуска', 'дата оформления', 'выдан',
            'تاريخ الإصدار', 'تاريخ الاصدار',
            'berlen senesi', 'berlen wagty', 'berlen güni', 'berlen guni',
            'berilgan vaqti', 'berilgan sana'
        ]);
        let expiryDate = findDateAfterLabel(text, [
            'date of expiry', 'date of expiration', 'expiry date', 'expiration date',
            'date of expire', 'valid until', 'valid to', 'expires on',
            'geçerlilik tarihi', 'geçerlilik süresi', 'son geçerlilik tarihi', 'geçerlik tarihi',
            'belge geçerlilik tarihi', 'pasaport geçerlilik tarihi',
            'pasaport bitiş tarihi', 'belge bitiş tarihi',
            'date d\'expiration', 'date d expiration', 'expiration', 'valable jusqu\'au', 'valable jusqu au',
            'действителен до', 'срок действия', 'дата окончания', 'дата истечения',
            'تاريخ الانتهاء', 'تاريخ النفاذ', 'صالح حتى',
            'hereket ediş möhleti', 'hereket edis mohleti', 'hereket möhleti', 'hereket mohleti', 'möhleti', 'mohleti',
            'amal qilish muddati'
        ]);
        if (!expiryDate) {
            expiryDate = extractDatesFromMrz(text).expiryDate;
        }

        // Kesin kural: Asla etiketsiz rastgele aday tarihler uydurulmaz.
        // Yalnızca açık etiket veya MRZ ile tespit edilen tarihler geçerlidir.
        if (issueDate && expiryDate && issueDate >= expiryDate) {
            issueDate = '';
        }
        if (options.birthDate && issueDate === options.birthDate) {
            issueDate = '';
        }
        return { issueDate, expiryDate };
    }

    function extractLabeledValue(text, labels, stopWords) {
        const source = String(text || '').replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, ' ');
        const match = source.match(new RegExp(`(?:${labels.join('|')})\\s*[:/#\\-]?\\s*([^\\n\\r:]{2,60})`, 'i'));
        if (!match) return '';
        const value = match[1].split(new RegExp(`\\s+(?:${stopWords.join('|')})\\s*[:/#\\-]?`, 'i'))[0]
            .replace(/^[-/:,._\s]+|[-/:,._\s]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return value.length >= 2 && !/^\d/.test(value) ? value.toUpperCase() : '';
    }

    function extractPassportPlaceOfBirth(text, options = {}) {
        const nationality = String(options.nationality || options.country || options.uyruk || '').toUpperCase();
        if (nationality.includes('TURKMEN') || nationality.includes('TÜRKMEN') || /P\s*<\s*TKM/i.test(text || '')) return 'TKM';
        return extractLabeledValue(text, [
            'place of birth', 'birth place', 'place of origin', 'pob',
            'doğum yeri', 'dogum yeri', 'место рождения', 'tug[\'`’]?ilgan joyi'
        ], ['date', 'tarih', 'authority', 'makam', 'valid', 'expiry', 'sex', 'cinsiyet']);
    }

    function extractPassportIssuingAuthority(text, options = {}) {
        const authority = extractLabeledValue(text, [
            'issuing authority', 'authority', 'issued by', 'issuing office',
            'belgeyi veren makam', 'veren makam', 'düzenleyen makam',
            'autorité', 'орган,\\s*выдавший документ', 'орган выдачи', 'кем выдан', 'bergan organ'
        ], ['date', 'tarih', 'place', 'doğum', 'valid', 'expiry', 'signature', 'imza']);
        if (authority) return authority;
        const mrz = String(text || '').toUpperCase().match(/P\s*<\s*([A-Z]{3})/);
        return mrz ? mrz[1] : '';
    }

    function extractMrzNames(text) {
        const lines = String(text || '').split(/[\r\n]+/);
        for (const line of lines) {
            const clean = line.replace(/\s+/g, '').toUpperCase();
            // Line 1: P<XXXSURNAME<<GIVEN<NAMES
            const m = clean.match(/^P[<A-Z0-9][A-Z]{3}([A-Z0-9<]{30,42})/);
            if (m) {
                const namePart = m[1];
                const parts = namePart.split('<<');
                if (parts.length >= 2) {
                    const surname = parts[0].replace(/</g, ' ').trim();
                    const givenNames = parts[1].split('<<')[0].replace(/</g, ' ').trim();
                    if (surname && givenNames) {
                        return { surname, givenNames };
                    }
                }
            }
        }
        return { surname: '', givenNames: '' };
    }

    function extractPassportMetadata(text, options = {}) {
        const dates = extractPassportDates(text, options);
        const mrz = extractDatesFromMrz(text);
        const mrzNames = extractMrzNames(text);
        return {
            issueDate: dates.issueDate || '',
            expiryDate: dates.expiryDate || mrz.expiryDate || '',
            birthDate: mrz.birthDate || '',
            cinsiyet: mrz.cinsiyet || '',
            mrzSurname: mrzNames.surname || '',
            mrzGivenNames: mrzNames.givenNames || '',
            placeOfBirth: extractPassportPlaceOfBirth(text, options),
            issuingAuthority: extractPassportIssuingAuthority(text, options)
        };
    }

    globalThis.YknDocumentParser = Object.freeze({
        extractYoksisIdFromText,
        extractPassportMetadata,
        extractPassportDates,
        extractPassportPlaceOfBirth,
        extractPassportIssuingAuthority,
        extractMrzNames,
        parseDateValue,
        isValidYoksisId
    });
})();
