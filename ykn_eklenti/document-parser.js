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
        eylul: 9, eylul: 9, eyl: 9, ekim: 10, eki: 10, kasim: 11, kasım: 11, kas: 11, aralik: 12, aralık: 12, ara: 12,
        // Roman numerals (12.VII.2021)
        i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12,
        // Russian / Cyrillic
        янв: 1, январь: 1, января: 1, фев: 2, февраль: 2, февраля: 2, мар: 3, март: 3, марта: 3,
        апр: 4, апрель: 4, апреля: 4, май: 5, мая: 5, июн: 6, июнь: 6, июня: 6,
        июл: 7, июль: 7, июля: 7, авг: 8, август: 8, августа: 8, сен: 9, сентябрь: 9, сентября: 9,
        окт: 10, октябрь: 10, октября: 10, ноя: 11, ноябрь: 11, ноября: 11, дек: 12, декабрь: 12, декабря: 12,
        // Arabic
        يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, أبريل: 4, مايو: 5, يونيو: 6, يوليو: 7, اغسطس: 8, أغسطس: 8,
        سبتمبر: 9, اكتوبر: 10, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12, شباط: 2, آذار: 3, اذار: 3, نيسان: 4,
        أيار: 5, ايار: 5, حزيران: 6, تموز: 7, آب: 8, اب: 8, أيلول: 9, ايلول: 9
    };

    function convertEasternToAsciiDigits(text) {
        return String(text || '')
            .replace(/[\u0660\u06F0]/g, '0')
            .replace(/[\u0661\u06F1]/g, '1')
            .replace(/[\u0662\u06F2]/g, '2')
            .replace(/[\u0663\u06F3]/g, '3')
            .replace(/[\u0664\u06F4]/g, '4')
            .replace(/[\u0665\u06F5]/g, '5')
            .replace(/[\u0666\u06F6]/g, '6')
            .replace(/[\u0667\u06F7]/g, '7')
            .replace(/[\u0668\u06F8]/g, '8')
            .replace(/[\u0669\u06F9]/g, '9');
    }

    function normalizeText(value) {
        return convertEasternToAsciiDigits(value)
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

    const COUNTRY_CODE_ALIASES = Object.freeze({
        AFG: ['AFGANISTAN', 'AFGHANISTAN'],
        ALB: ['ARNAVUTLUK', 'ALBANIA', 'ALBANIE'],
        DZA: ['CEZAYIR', 'ALGERIA', 'ALGERIE'],
        ARG: ['ARJANTIN', 'ARGENTINA'],
        ARM: ['ERMENISTAN', 'ARMENIA'],
        AUS: ['AVUSTRALYA', 'AUSTRALIA'],
        AUT: ['AVUSTURYA', 'AUSTRIA'],
        AZE: ['AZERBAYCAN', 'AZERBAIJAN'],
        BGD: ['BANGLADES', 'BANGLADESH'],
        BEL: ['BELCIKA', 'BELGIUM', 'BELGIQUE'],
        BGR: ['BULGARISTAN', 'BULGARIA'],
        BRA: ['BREZILYA', 'BRAZIL'],
        CAN: ['KANADA', 'CANADA'],
        CHE: ['ISVICRE', 'SWITZERLAND', 'SUISSE'],
        CHN: ['CIN', 'CHINA'],
        COL: ['KOLOMBIYA', 'COLOMBIA'],
        CZE: ['CEKYA', 'CZECHIA', 'CZECH REPUBLIC'],
        DEU: ['ALMANYA', 'GERMANY', 'DEUTSCHLAND'],
        DNK: ['DANIMARKA', 'DENMARK'],
        ECU: ['EKVADOR', 'ECUADOR'],
        EGY: ['MISIR', 'EGYPT'],
        ESP: ['ISPANYA', 'SPAIN', 'ESPANA'],
        ETH: ['ETIYOPYA', 'ETHIOPIA'],
        FRA: ['FRANSA', 'FRANCE'],
        GEO: ['GURCISTAN', 'GEORGIA'],
        GBR: ['BIRLESIK KRALLIK', 'UNITED KINGDOM', 'INGILTERE'],
        GHA: ['GANA', 'GHANA'],
        GRC: ['YUNANISTAN', 'GREECE'],
        IDN: ['ENDONEZYA', 'INDONESIA'],
        IND: ['HINDISTAN', 'INDIA'],
        IRN: ['IRAN'],
        IRQ: ['IRAK', 'IRAQ'],
        ITA: ['ITALYA', 'ITALY'],
        JOR: ['URDUN', 'JORDAN'],
        JPN: ['JAPONYA', 'JAPAN'],
        KAZ: ['KAZAKISTAN', 'KAZAKHSTAN'],
        KEN: ['KENYA'],
        KGZ: ['KIRGIZISTAN', 'KYRGYZSTAN'],
        KOR: ['GUNEY KORE', 'SOUTH KOREA', 'KOREA'],
        LBN: ['LUBNAN', 'LEBANON'],
        LBY: ['LIBYA'],
        MAR: ['FAS', 'MOROCCO'],
        MEX: ['MEKSIKA', 'MEXICO'],
        MNG: ['MOGOLISTAN', 'MONGOLIA'],
        MYS: ['MALEZYA', 'MALAYSIA'],
        NLD: ['HOLLANDA', 'NETHERLANDS'],
        NGA: ['NIJERYA', 'NIGERIA'],
        NPL: ['NEPAL'],
        PAK: ['PAKISTAN'],
        PER: ['PERU'],
        PHL: ['FILIPINLER', 'PHILIPPINES'],
        PLE: ['FILISTIN', 'PALESTINE'],
        POL: ['POLONYA', 'POLAND'],
        PRT: ['PORTEKIZ', 'PORTUGAL'],
        QAT: ['KATAR', 'QATAR'],
        ROU: ['ROMANYA', 'ROMANIA'],
        RUS: ['RUSYA', 'RUSSIA'],
        SAU: ['SUUDI ARABISTAN', 'SAUDI ARABIA'],
        SDN: ['SUDAN'],
        SEN: ['SENEGAL'],
        SOM: ['SOMALI', 'SOMALIA'],
        SRB: ['SIRBISTAN', 'SERBIA'],
        SYR: ['SURIYE', 'SYRIA'],
        SWE: ['ISVEC', 'SWEDEN'],
        TJK: ['TACIKISTAN', 'TAJIKISTAN'],
        TKM: ['TURKMENISTAN', 'TURKMEN'],
        TUN: ['TUNUS', 'TUNISIA'],
        TUR: ['TURKIYE', 'TURKEY'],
        UKR: ['UKRAYNA', 'UKRAINE'],
        UZB: ['OZBEKISTAN', 'UZBEKISTAN'],
        USA: ['AMERIKA BIRLESIK DEVLETLERI', 'UNITED STATES', 'USA'],
        UGA: ['UGANDA'],
        ARE: ['BIRLESIK ARAP EMIRLIKLERI', 'UNITED ARAB EMIRATES'],
        VEN: ['VENEZUELA'],
        VNM: ['VIETNAM', 'VIET NAM'],
        YEM: ['YEMEN']
    });

    function getCountryIso3Code(value) {
        const normalized = String(value || '')
            .toLocaleUpperCase('tr-TR')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Z0-9\u0400-\u04FF]+/g, ' ')
            .trim();
        if (/^[A-Z]{3}$/.test(normalized)) return normalized;
        for (const [code, aliases] of Object.entries(COUNTRY_CODE_ALIASES)) {
            if (aliases.some((alias) => normalized.includes(alias))) return code;
        }
        return (value || '').slice(0, 3).toUpperCase();
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
        const source = normalizeText(text);
        const escaped = labels.map((l) => l.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
        const regex = new RegExp(`(?:${escaped})\\s*[:/#\\-]?\\s*([\\s\\S]{0,150})`, 'gi');
        let m;
        while ((m = regex.exec(source)) !== null) {
            const windowText = m[1];
            // Split window at next date label so we don't bleed into other fields
            const cutWindow = windowText.split(/(?:date\s+of|tarihi|düzenleme|geçerlilik|expiry|issue|délivrance|delivrance|expiration|birth|doğum|senesi|wagty|möhleti|mohleti)/i)[0] || windowText;

            const datePatterns = [
                /\b\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü\u0400-\u04ff\u0600-\u06ff]{1,15}(?:\s*[\/\-]\s*[A-Za-zÇĞİÖŞÜçğıöşü\u0400-\u04ff\u0600-\u06ff]{1,15})?\s+\d{2,4}\b/g,
                /\b[A-Za-zÇĞİÖŞÜçğıöşü\u0400-\u04ff\u0600-\u06ff]{1,15}\s+\d{1,2}(?:st|nd|rd|th)?[,\s]+\d{2,4}\b/g,
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
        let passportNumber = '';
        const pCodeMatch = compact.match(/P[<A-Z0-9]([A-Z]{3})([A-Z0-9<]{9})/);
        if (pCodeMatch) {
            const pNum = pCodeMatch[2].replace(/</g, '').trim();
            if (pNum && pNum.length >= 5) passportNumber = pNum;
        }

        // Standard TD3 (passport) line 2
        let match = compact.match(/([A-Z0-9<]{9})[0-9A-Z<][A-Z<]{3}(\d{6})[0-9A-Z<]([MFX<])(\d{6})/);
        // Fallback: any 6 digits followed by check digit, sex (M/F), and 6 digits
        if (!match) {
            match = compact.match(/(\d{6})[0-9A-Z<]([MF])(\d{6})/);
        }
        if (!match) return { expiryDate: '', birthDate: '', cinsiyet: '', passportNumber };

        if (match.length >= 5) {
            if (!passportNumber && match[1]) {
                const pNum = match[1].replace(/</g, '').trim();
                if (pNum && pNum.length >= 5) passportNumber = pNum;
            }
        }

        const birthRaw = match.length >= 5 ? match[2] : match[1];
        const sexRaw = match.length >= 5 ? match[3] : match[2];
        const expiryRaw = match.length >= 5 ? match[4] : match[3];

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

        return { expiryDate, birthDate, cinsiyet, passportNumber };
    }

    function extractPassportDates(text, options = {}) {
        let issueDate = findDateAfterLabel(text, [
            'date of issue', 'issue date', 'date issued', 'issuing date', 'issued on',
            'düzenleme tarihi', 'düzenlenme tarihi', 'veriliş tarihi', 'verilme tarihi',
            'tanzim tarihi', 'belge düzenleme tarihi', 'belge veriliş tarihi',
            'date de délivrance', 'date de delivrance', 'délivrance', 'delivrance',
            'date d\'émission', 'date d emission', 'émis le', 'emis le',
            'дата выдачи', 'дата выдачи паспорта', 'дата выпуска', 'дата оформления', 'выдан',
            'تاريخ الإصدار', 'تاريخ الاصدار', 'تاريخ الصدور', 'تاريخ التحرير', 'صدر بتاريخ',
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
            'действителен до', 'срок действия', 'дата окончания', 'дата истечения', 'термін дії',
            'تاريخ الانتهاء', 'تاريخ الصلاحية', 'تاريخ النفاذ', 'صالح حتى', 'صالحة لغاية', 'صالح لغاية',
            'hereket ediş möhleti', 'hereket edis mohleti', 'hereket möhleti', 'hereket mohleti', 'möhleti', 'mohleti',
            'amal qilish muddati', 'қолданылу мерзімі'
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

    const POB_LABELS = [
        // English
        'place of birth', 'birth place', 'place of origin', 'pob', 'city of birth', 'town of birth', 'country / place of birth',
        // French
        'lieu de naissance', 'lieu d\'origine', 'lieu d origine', 'lieu naissance',
        // Turkish / Azeri
        'doğum yeri', 'dogum yeri', 'doğduğu yer', 'dogdugu yer', 'doğulduğu yer', 'doguldugu yer',
        // Arabic / Persian / Urdu
        'مكان الميلاد', 'محل الميلاد', 'مكان الولادة', 'محل الولادة', 'مكان الازدياد', 'مكان الإزدياد',
        'محل الازدياد', 'مكان وتاريخ الميلاد', 'مكان وتاريخ الولادة', 'تاريخ ومكان الميلاد', 'تاريخ ومكان الولادة',
        'محل وتاريخ الولادة', 'محل وتاريخ الميلاد', 'محل تولد', 'محل ولادت', 'مقام پیدائش',
        // Russian / Cyrillic
        'место рождения', 'место рожд', 'туған жері', 'туған жер', 'туган жери', 'туулган жери',
        'ҷои таваллуд', 'чои таваллуд', 'ҷойи таваллуд', 'туғилган жойи', 'доглан йери', 'доглан ери',
        'місце народження', 'места нараджэння', 'место на раждане', 'место на раждање',
        // Uzbek / Turkmen Latin
        'tug\'ilgan joyi', 'tugilgan joyi', 'tug\'ilgan joy', 'doglan ýeri', 'doglan yeri',
        // Other European / African
        'geburtsort', 'lugar de nacimiento', 'local de nascimento', 'luogo di nascita', 'goobta dhallashada', 'goobta dhalashada'
    ];

    const POB_STOP_WORDS = [
        'date of birth', 'date of issue', 'date of expiry', 'date', 'issue', 'issuing', 'expiry', 'expiration', 'valid until', 'valid', 'sex', 'gender', 'authority', 'issued by', 'signature', 'nationality', 'national',
        'date de naissance', 'date de délivrance', 'date de delivrance', 'date d\'expiration', 'date d expiration', 'date', 'sexe', 'autorité', 'autorite', 'delivre par', 'signature', 'nationalité', 'nationalite',
        'doğum tarihi', 'dogum tarihi', 'veriliş tarihi', 'verilis tarihi', 'tanzim tarihi', 'geçerlilik tarihi', 'gecerlilik tarihi', 'son geçerlilik', 'tarih', 'tarihi', 'cinsiyet', 'veren makam', 'makam', 'imza', 'uyruk', 'uyruğu',
        'дата рождения', 'дата выдачи', 'срок действия', 'действителен до', 'дата', 'пол', 'орган выдачи', 'кем выдан', 'подпись', 'гражданство', 'национальность',
        'تاريخ الميلاد', 'تاريخ الاصدار', 'تاريخ الإصدار', 'تاريخ الصدور', 'تاريخ الانتهاء', 'تاريخ النفاذ', 'تاريخ', 'الجنس', 'النوع', 'المهنة', 'السلطة', 'الجهة', 'الرقم الوطني', 'الرقم القومي', 'الجنسية', 'التوقيع', 'حامل',
        'amal', 'sana', 'sanasi', 'beril', 'berilgan', 'qoldanylu', 'mohleti', 'möhleti', 'etibarliliq', 'jynsy', 'jinsi'
    ];

    const AUTHORITY_LABELS = [
        // English
        'issuing authority', 'issuing office', 'office of issue', 'place of issue', 'issued by', 'authority', 'passport office',
        'issuing state', 'issuing post', 'issuing country', 'issuing government',
        // French
        'autorité de délivrance', 'autorite de delivrance', 'autorité', 'autorite', 'délivré par', 'delivre par', 'lieu de délivrance', 'lieu de delivrance',
        'délivré à', 'delivre a',
        // Turkish / Azeri
        'belgeyi veren makam', 'pasaportu veren makam', 'tanzim eden makam', 'düzenleyen makam', 'duzenleyen makam', 'veren makam', 'verildiği yer', 'verildigi yer',
        'verən makam', 'verən orqan', 'tərtib edən orqan',
        // Arabic / Persian / Urdu
        'جهة الإصدار', 'جهة الاصدار', 'الجهة المصدرة', 'الجهة المصدرة للوثيقة', 'مكان الإصدار', 'مكان الاصدار', 'مكان الصدور', 'مكان التحرير',
        'سلطة الإصدار', 'سلطة الاصدار', 'السلطة', 'مركز الإصدار', 'مركز الاصدار', 'صدر عن', 'صدرت من',
        'مكان وتاريخ الإصدار', 'مكان وتاريخ الاصدار', 'تاريخ ومكان الإصدار', 'تاريخ ومكان الاصدار', 'محل صدور', 'مرجع صدور',
        // Russian / Cyrillic / CIS
        'орган, выдавший документ', 'орган выдавший документ', 'орган выдачи', 'орган, що видав документ', 'орган що видав',
        'орган що видав паспорт', 'кем выдан', 'выдан',
        'берген орган', 'берген мекеме', 'берген жай', 'берілген жер', 'берілген жері',
        'мақоми васиқадиҳанда', 'макоми васикадиханда', 'орган, ки васиқа додааст', 'орган ки васика додааст',
        'ким томонидан берилган', 'берган organ', 'берган орган', 'берилган жойи',
        'ким тарапындан берлен', 'берлен ýeri', 'берlen ýeri', 'berlen ýeri', 'berlen yeri', 'berlən yeri', 'bergan organ',
        // Spanish / Portuguese / Italian / German
        'autoridad de expedición', 'autoridad expedidora', 'autoridad de emision', 'lugar de expedición', 'lugar de expedicion', 'expedido por', 'autoridad',
        'autoridade emissora', 'emitido por', 'autoridade',
        'autorità di rilascio', 'autorita di rilascio', 'rilasciato da', 'autorità', 'autorita',
        'ausstellende behörde', 'ausstellende behoerde', 'ausgestellt durch', 'passbehörde', 'passbehoerde', 'behörde', 'behoerde'
    ];

    const AUTHORITY_STOP_WORDS = [
        'date of issue', 'date of expiry', 'date of birth', 'date of expiration', 'date of validity', 'valid until',
        'date de délivrance', 'date de delivrance', 'date d\'expiration', 'date d expiration', 'date de naissance',
        'veriliş tarihi', 'verilis tarihi', 'geçerlilik tarihi', 'gecerlilik tarihi', 'son geçerlilik', 'doğum tarihi', 'dogum tarihi', 'tanzim tarihi',
        'дата выдачи', 'срок действия', 'дата окончания', 'действителен до', 'дата рождения',
        'تاريخ الإصدار', 'تاريخ الاصدار', 'تاريخ الصدور', 'تاريخ الانتهاء', 'تاريخ النفاذ', 'تاريخ الميلاد',
        'fecha de expedicion', 'fecha de emision', 'fecha de caducidad', 'fecha de nacimiento',
        'data di rilascio', 'data di scadenza', 'data di nascita',
        'ausstellungsdatum', 'gueltig bis', 'gültig bis', 'geburtsdatum',
        'place of birth', 'lieu de naissance', 'doğum yeri', 'dogum yeri', 'место рождения', 'مكان الميلاد', 'lugar de nacimiento',
        'signature of bearer', 'bearer\'s signature', 'holder\'s signature', 'signature du titulaire', 'imza', 'sahibinin imzası', 'подпись владельца', 'подпись', 'التوقيع',
        'sex', 'gender', 'cinsiyet', 'sexe', 'пол', 'الجنس', 'sexo', 'sesso', 'geschlecht',
        'nationality', 'uyruk', 'uyruğu', 'nationalité', 'nationalite', 'гражданство', 'الجنسية',
        'passport no', 'passport number', 'no de passeport', 'pasaport no', 'номер паспорта', 'رقم الجواز',
        'berilgan sanasi', 'berilgen sanasi', 'berilgen kuni', 'berilgan vaqti', 'amal qilish muddati', 'amal qilish', 'sanasi', 'sana', 'kuni',
        'etibarlılıq müddəti', 'etibarliliq muddati', 'bitmə tarixi', 'bitme tarixi', 'verilmə tarixi', 'verilme tarixi',
        'qoldanylu merzimi', 'qoldanylu', 'mohleti', 'möhleti',
        'mrz'
    ];

    const KNOWN_AUTHORITY_PATTERNS = [
        /\bDEPARTMENT OF STATE\b/i,
        /\bPASSPORT OFFICE\b/i,
        /\bMINISTRY OF FOREIGN AFFAIRS\b/i,
        /\bMINISTRY OF INTERIOR\b/i,
        /\bMINISTRY OF HOME AFFAIRS\b/i,
        /\bIMMIGRATION AND PASSPORTS\b/i,
        /\bHM PASSPORT OFFICE\b/i,
        /\bDEPARTMENT OF HOME AFFAIRS\b/i,
        /\bIDENTITY AND PASSPORT SERVICE\b/i,
        /\bMINISTERE DE L'INTERIEUR\b/i,
        /\bMINISTERE DES AFFAIRES ETRANGERES\b/i,
        /\bDIRECTION GENERALE DE LA POLICE(?: NATIONALE)?\b/i,
        /\bPREFECTURE DE POLICE\b/i,
        /\bCOMMISSARIAT CENTRAL\b/i,
        /\bNÜFUS VE VATANDAŞLIK İŞLERİ(?: GENEL MÜDÜRLÜĞÜ)?\b/i,
        /\bNUFUS VE VATANDASLIK ISLERI(?: GENEL MUDURLUGU)?\b/i,
        /\bEMNİYET GENEL MÜDÜRLÜĞÜ\b/i,
        /\bEMNIYET GENEL MUDURLUGU\b/i,
        /\bİL EMNİYET MÜDÜRLÜĞÜ\b/i,
        /\bIL EMNIYET MUDURLUGU\b/i,
        /\bМВД(?:\s+РОССИИ|\s+[А-ЯA-Z0-9]+|\s*\d{3,6})?\b/u,
        /\bУФМС(?:\s+РОССИИ|\s+[А-ЯA-Z0-9]+|\s*\d{3,6})?\b/u,
        /\bФМС(?:\s+[А-ЯA-Z0-9]+|\s*\d{3,6})?\b/u,
        /\bMIA OF RUSSIA\b/i,
        /\bMIA\s*\d{3,6}\b/i,
        /\bIIB\s+[A-Z\s]{2,20}\b/i,
        /\bIIV\b/i,
        /\bВКД\b/u,
        /\bІІМ\b/u,
        /\bSMST\b/i,
        /\bمصلحة الجوازات(?: والجنسية)?\b/u,
        /\bوزارة الداخلية\b/u,
        /\bوزارة الخارجية\b/u,
        /\bإدارة الهجرة والجوازات\b/u,
        /\bادارة الهجرة والجوازات\b/u
    ];

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function cleanPlaceOfBirthValue(rawValue) {
        if (!rawValue) return '';
        let val = String(rawValue).trim();

        // 1. Strip dates
        val = val.replace(/\b\d{1,4}[./\-]\d{1,2}[./\-]\d{2,4}\b/g, '').trim();
        val = val.replace(/\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|OCAK|ŞUBAT|MART|NİSAN|MAYIS|HAZİRAN|TEMMUZ|AĞUSTOS|EYLÜL|EKİM|KASIM|ARALIK|ЯНВ|ФЕВ|МАР|АПР|МАЙ|ИЮН|ИЮЛ|АВГ|СЕН|ОКТ|НОЯ|ДЕК|يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر)[a-zа-яء-ي]*\s+\d{2,4}\b/gi, '').trim();

        // 2. Strip Russian/Cyrillic administrative prefixes
        val = val.replace(/^(?:Г\.|ГОР\.|ГОРОД|С\.|СЕЛО|П\.|ПОС\.|ПОСЕЛОК|ОБЛ\.|ОБЛАСТЬ|КРАЙ|РЕСП\.|РЕСПУБЛИКА|Р-Н\.|Р-Н|РАЙОН)(?:\s+|$|[.,:;])\s*/i, '');
        val = val.replace(/^(?:Г|С|П)(?:\s+|$|[.,:;])\s*/i, '');

        // 3. Strip Arabic administrative prefixes
        val = val.replace(/^(?:محافظة|ولاية|مدينة|منطقة|بلدية|مركز|دائرة)(?:\s+|$|[.,:;])\s*/i, '');

        // 4. Strip French / English administrative prefixes
        val = val.replace(/^(?:VILLE DE|PROVINCE DE|REGION DE|COMMUNE DE|DEPARTEMENT DE|CITY OF|PROVINCE OF|STATE OF|DISTRICT OF)(?:\s+|$|[.,:;])\s*/i, '');

        // 5. Prefer Latin part in bilingual dual-script
        const parts = val.split(/\s*[/\\|]\s*/);
        if (parts.length >= 2) {
            const latinPart = parts.find(p => /[A-Za-z]/.test(p) && !/^(?:Г\.|ГОР\.|CITY|VILLE|P\b)/i.test(p.trim()));
            if (latinPart) {
                val = latinPart;
            } else {
                val = parts[0];
            }
        }

        val = val.replace(/^[\s:;#\-_/\\\\|.,]+|[\s:;#\-_/\\\\|.,]+$/g, '').trim();
        val = val.replace(/\s+/g, ' ');
        val = val.replace(/^(?:Г\.|ГОР\.|ГОРОД|Г)(?:\s+|$|[.,:;])\s*/i, '');
        val = val.replace(/^(?:محافظة|ولاية|مدينة)(?:\s+|$|[.,:;])\s*/i, '');
        val = val.replace(/^(?:VILLE DE|CITY OF)(?:\s+|$|[.,:;])\s*/i, '');

        if (!val || val.length < 2 || /^\d+$/.test(val)) return '';
        return val;
    }

    function cleanIssuingAuthorityValue(rawValue) {
        if (!rawValue) return '';
        let val = String(rawValue).trim();

        // Remove dates
        val = val.replace(/\b\d{1,4}[./\-]\d{1,2}[./\-]\d{2,4}\b/g, '').trim();
        val = val.replace(/\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|OCAK|ŞUBAT|MART|NİSAN|MAYIS|HAZİRAN|TEMMUZ|AĞUSTOS|EYLÜL|EKİM|KASIM|ARALIK|ЯНВ|ФЕВ|МАР|АПР|МАЙ|ИЮН|ИЮЛ|АВГ|СЕН|ОКТ|НОЯ|ДЕК|يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر)[a-zа-яء-ي]*\s+\d{2,4}\b/gi, '').trim();

        // Clean OCR artifacts: brackets, guillemets, quotes, chevron fillers
        val = val.replace(/^[«"'\(\[\{<]+|[»"'\)\]\}>]+$/g, '').trim();
        val = val.replace(/<{2,}/g, ' ').replace(/</g, ' ');

        // Bilingual / dual-script splitting (e.g. "МВД 77001 / MIA 77001" or "МВД РОССИИ / MIA OF RUSSIA")
        const parts = val.split(/\s*[/\\|]\s*/);
        if (parts.length >= 2) {
            const latinPart = parts.find(p => /[A-Za-z]/.test(p) && !isLabelOnlyLine(p, AUTHORITY_LABELS));
            if (latinPart) {
                val = latinPart;
            } else {
                val = parts[parts.length - 1];
            }
        }

        // Strip leftover leading labels
        val = val.replace(/^[\s:;#\-_/\\\\|.,]+|[\s:;#\-_/\\\\|.,]+$/g, '').trim();
        val = val.replace(/^(?:AUTHORITY|AUTORITE|ISSUING AUTHORITY|ISSUED BY|OFFICE|PASSPORT OFFICE|VEREN MAKAM|BELGEYI VEREN MAKAM|ОРГАН ВЫДАЧИ|КЕМ ВЫДАН|جهة الإصدار|جهة الاصدار)\s*[:\-]?\s*/i, '');
        val = val.replace(/\s+/g, ' ');

        if (!val || val.length < 2 || /^\d{1,2}[./\-]/.test(val)) return '';
        return val;
    }

    function isLabelOnlyLine(line, labels) {
        let rem = line.trim();
        if (!rem) return false;
        let matchedAny = false;
        let keepLooping = true;
        while (keepLooping) {
            keepLooping = false;
            rem = rem.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();
            for (const l of labels) {
                const regex = new RegExp('^' + escapeRegex(l), 'i');
                if (regex.test(rem)) {
                    rem = rem.replace(regex, '').trim();
                    matchedAny = true;
                    keepLooping = true;
                    break;
                }
            }
        }
        rem = rem.replace(/^[\s:;#\-_/\\\\|.,]+|[\s:;#\-_/\\\\|.,]+$/g, '').trim();
        return matchedAny && rem.length === 0;
    }

    function extractPassportPlaceOfBirth(text, options = {}) {
        if (!text || typeof text !== 'string') return '';
        const normalized = text.replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, ' ');
        const upperText = normalized.toUpperCase();

        const nationalityCheck = String(options.nationality || options.country || options.uyruk || options.dogumUlkesi || '').toUpperCase();
        const isTurkmen = nationalityCheck.includes('TÜRKMEN') ||
            nationalityCheck.includes('TURKMEN') ||
            nationalityCheck === 'TKM' ||
            upperText.includes('P<TKM') ||
            (upperText.includes('TURKMENISTAN') && !upperText.includes('EMBASSY OF TURKMENISTAN'));

        if (isTurkmen) return 'TKM';

        const lines = normalized.split(/[\r\n]+/);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const foundLabel = POB_LABELS.find(l => {
                const regex = new RegExp('(?:^|[\\s:;#\-_/\\\\|.,])' + escapeRegex(l) + '(?:$|[\\s:;#\-_/\\\\|.,])', 'i');
                return regex.test(line);
            });

            if (!foundLabel) continue;

            const labelIndex = line.toLowerCase().indexOf(foundLabel.toLowerCase());
            let remainder = line.slice(labelIndex);

            let keepStripping = true;
            while (keepStripping) {
                keepStripping = false;
                remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();
                for (const l of POB_LABELS) {
                    const r = new RegExp('^' + escapeRegex(l), 'i');
                    if (r.test(remainder)) {
                        remainder = remainder.replace(r, '').trim();
                        keepStripping = true;
                        break;
                    }
                }
            }

            remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();

            if (remainder.length >= 2) {
                for (const stop of POB_STOP_WORDS) {
                    const stopRegex = new RegExp('(?:\\s+|^)' + escapeRegex(stop) + '(?:[:;#\\-_/\\\\|\\s.,]|$)', 'i');
                    const stopMatch = remainder.match(stopRegex);
                    if (stopMatch && stopMatch.index !== undefined && stopMatch.index > 0) {
                        remainder = remainder.slice(0, stopMatch.index).trim();
                    }
                }
                const cleaned = cleanPlaceOfBirthValue(remainder);
                if (cleaned) return cleaned.toUpperCase();
            }

            for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                const nextLine = lines[j].trim();
                if (!nextLine) continue;

                if (isLabelOnlyLine(nextLine, POB_LABELS)) continue;
                if (isLabelOnlyLine(nextLine, POB_STOP_WORDS)) break;

                let val = nextLine;
                for (const stop of POB_STOP_WORDS) {
                    const stopRegex = new RegExp('(?:\\s+|^)' + escapeRegex(stop) + '(?:[:;#\\-_/\\\\|\\s.,]|$)', 'i');
                    const stopMatch = val.match(stopRegex);
                    if (stopMatch && stopMatch.index !== undefined && stopMatch.index > 0) {
                        val = val.slice(0, stopMatch.index).trim();
                    }
                }
                const cleaned = cleanPlaceOfBirthValue(val);
                if (cleaned) return cleaned.toUpperCase();
            }
        }

        return '';
    }

    function extractPassportIssuingAuthority(text, options = {}) {
        if (!text || typeof text !== 'string') {
            return getCountryIso3Code(
                options.uyruk || options.nationality || options.country || options.dogumUlkesi
            );
        }
        const normalized = text.replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, ' ');
        const lines = normalized.split(/[\r\n]+/);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const foundLabel = AUTHORITY_LABELS.find(l => {
                const regex = new RegExp('(?:^|[\\s:;#\-_/\\\\|.,])' + escapeRegex(l) + '(?:$|[\\s:;#\-_/\\\\|.,])', 'i');
                return regex.test(line);
            });

            if (!foundLabel) continue;

            const labelIndex = line.toLowerCase().indexOf(foundLabel.toLowerCase());

            // Check text BEFORE the label (RTL / Arabic or multi-column table layout: e.g. "دمشق جهة الإصدار")
            let beforeRemainder = line.slice(0, labelIndex).trim();
            beforeRemainder = beforeRemainder.replace(/^[«"'\(\[\{]+|[»"'\)\]\}]+$/g, '').trim();
            let candidateBefore = '';
            if (beforeRemainder.length >= 2 && !isLabelOnlyLine(beforeRemainder, AUTHORITY_LABELS) && !isLabelOnlyLine(beforeRemainder, AUTHORITY_STOP_WORDS)) {
                for (const stop of AUTHORITY_STOP_WORDS) {
                    const stopRegex = new RegExp('(?:\\s+|^)' + escapeRegex(stop) + '(?:[:;#\\-_/\\\\|\\s.,]|$)', 'i');
                    const stopMatch = beforeRemainder.match(stopRegex);
                    if (stopMatch && stopMatch.index !== undefined) {
                        beforeRemainder = beforeRemainder.slice(0, stopMatch.index).trim();
                    }
                }
                const cleanedBefore = cleanIssuingAuthorityValue(beforeRemainder);
                if (cleanedBefore && !isLabelOnlyLine(cleanedBefore, AUTHORITY_LABELS)) {
                    candidateBefore = cleanedBefore;
                }
            }

            // Check text AFTER the label
            let remainder = line.slice(labelIndex);
            let keepStripping = true;
            while (keepStripping) {
                keepStripping = false;
                remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();
                for (const l of AUTHORITY_LABELS) {
                    const r = new RegExp('^' + escapeRegex(l) + '(?:$|[\\s:;#\-_/\\\\|.,])', 'i');
                    if (r.test(remainder)) {
                        remainder = remainder.replace(r, '').trim();
                        keepStripping = true;
                        break;
                    }
                }
            }
            remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();

            const collectedLineValues = [];

            if (remainder.length >= 2) {
                for (const stop of AUTHORITY_STOP_WORDS) {
                    const stopRegex = new RegExp('(?:\\s+|^)' + escapeRegex(stop) + '(?:[:;#\\-_/\\\\|\\s.,]|$)', 'i');
                    const stopMatch = remainder.match(stopRegex);
                    if (stopMatch && stopMatch.index !== undefined && stopMatch.index > 0) {
                        remainder = remainder.slice(0, stopMatch.index).trim();
                    }
                }
                const cleaned = cleanIssuingAuthorityValue(remainder);
                if (cleaned) collectedLineValues.push(cleaned);
            }

            // Multi-line collection: check up to 3 lines following the label
            for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                const nextLine = lines[j].trim();
                if (!nextLine) continue;

                if (isLabelOnlyLine(nextLine, AUTHORITY_LABELS)) continue;
                if (isLabelOnlyLine(nextLine, AUTHORITY_STOP_WORDS)) break;

                // If next line contains a date, it is a date field (issue/expiry/birth), not an authority name continuation
                if (/\b(?:\d{4}[./\-]\d{1,2}[./\-]\d{1,2}|\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})\b/.test(nextLine) ||
                    /\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|OCAK|ŞUBAT|MART|NİSAN|MAYIS|HAZİRAN|TEMMUZ|AĞUSTOS|EYLÜL|EKİM|KASIM|ARALIK|ЯНВ|ФЕВ|МАР|АПР|МАЙ|ИЮН|ИЮЛ|АВГ|СЕН|ОКТ|НОЯ|ДЕК|يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر)[a-zа-яء-ي]*\s+\d{2,4}\b/i.test(nextLine)) {
                    break;
                }

                let val = nextLine;
                let hitStop = false;
                for (const stop of AUTHORITY_STOP_WORDS) {
                    const stopRegex = new RegExp('(?:\\s+|^)' + escapeRegex(stop) + '(?:[:;#\\-_/\\\\|\\s.,]|$)', 'i');
                    const stopMatch = val.match(stopRegex);
                    if (stopMatch && stopMatch.index !== undefined) {
                        if (stopMatch.index === 0) {
                            hitStop = true;
                            break;
                        }
                        val = val.slice(0, stopMatch.index).trim();
                    }
                }
                if (hitStop) break;

                const cleaned = cleanIssuingAuthorityValue(val);
                if (cleaned) {
                    collectedLineValues.push(cleaned);
                }
            }

            if (collectedLineValues.length > 0) {
                // Check if we have bilingual dual-script across collected lines
                // (e.g. Line 1 Cyrillic/Arabic, Line 2 Latin). If so, prefer Latin for YÖKSİS!
                const latinLines = collectedLineValues.filter(l => /[A-Za-z]/.test(l) && !isLabelOnlyLine(l, AUTHORITY_LABELS));
                if (latinLines.length > 0 && latinLines.length < collectedLineValues.length) {
                    return latinLines.join(' ').toUpperCase();
                }
                return collectedLineValues.join(' ').toUpperCase();
            }

            if (candidateBefore) {
                return candidateBefore.toUpperCase();
            }
        }

        // Fallback: Known Authority Patterns
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.length < 3) continue;
            for (const pattern of KNOWN_AUTHORITY_PATTERNS) {
                const match = trimmed.match(pattern);
                if (match) {
                    const cleaned = cleanIssuingAuthorityValue(match[0]);
                    if (cleaned) return cleaned.toUpperCase();
                }
            }
        }

        // Fallback: MRZ Country Code
        const cleanMrzText = normalized.replace(/[«‹([{]/g, '<').toUpperCase();
        const mrzMatch = cleanMrzText.match(/P\s*[<A-Z0-9]\s*([A-Z]{3})/);
        if (mrzMatch && mrzMatch[1] !== 'UTO' && mrzMatch[1] !== 'XXX') {
            return mrzMatch[1];
        }

        return getCountryIso3Code(
            options.uyruk || options.nationality || options.country || options.dogumUlkesi
        );
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

    const GENDER_LABELS = [
        'sex', 'gender',
        'sexe',
        'cinsiyet', 'cinsiyeti',
        'пол', 'жынысы', 'жынсы',
        'الجنس', 'النوع',
        'geschlecht',
        'sexo',
        'sesso',
        'jinsi', 'jynsy'
    ];

    function extractPassportGender(text, options = {}) {
        if (!text || typeof text !== 'string') return '';

        // 1. Try MRZ first
        const mrz = extractDatesFromMrz(text);
        if (mrz.cinsiyet) return mrz.cinsiyet;

        // 2. Search label-based sex fields
        const normalized = normalizeText(text);
        const lines = normalized.split(/[\r\n]+/);

        const maleRegex = /(?:^|[\s:;#\-_/\\|.,])(?:M|MALE|ERKEK|HOMME|MASCULIN|MASCULINO|MAENNLICH|MÄNNLICH|М|МУЖ|МУЖСКОЙ|МУЖЧИНА|ЕРКЕК|ЭРКЕК|МАРД|ذكر)(?:$|[\s:;#\-_/\\|.,])/i;
        const femaleRegex = /(?:^|[\s:;#\-_/\\|.,])(?:F|FEMALE|KADIN|KIZ|FEMME|FEMININ|FEMENINO|WEIBLICH|W|Ж|ЖЕН|ЖЕНСКИЙ|ЖЕНЩИНА|ӘЙЕЛ|АЯЛ|ЗАН|انثى|أنثى)(?:$|[\s:;#\-_/\\|.,])/i;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const foundLabel = GENDER_LABELS.find(l => {
                const regex = new RegExp('(?:^|[\\s:;#\-_/\\\\|.,])' + escapeRegex(l) + '(?:$|[\\s:;#\-_/\\\\|.,])', 'i');
                return regex.test(line);
            });

            if (!foundLabel) continue;

            const labelIndex = line.toLowerCase().indexOf(foundLabel.toLowerCase());
            let remainder = line.slice(labelIndex + foundLabel.length).trim();
            remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();

            let keepStripping = true;
            while (keepStripping) {
                keepStripping = false;
                for (const l of GENDER_LABELS) {
                    const r = new RegExp('^[\\s:;#\-_/\\\\|.,]*' + escapeRegex(l), 'i');
                    if (r.test(remainder)) {
                        remainder = remainder.replace(r, '').trim();
                        keepStripping = true;
                        break;
                    }
                }
            }
            remainder = remainder.replace(/^[\s:;#\-_/\\\\|.,]+/, '').trim();

            if (/^(?:M\/F|F\/M|E\/K|K\/E|М\/Ж|Ж\/М)$/i.test(remainder)) {
                remainder = '';
            }

            if (remainder) {
                const firstToken = remainder.split(/[\s/\\,.;:-]+/)[0].trim();
                if (firstToken) {
                    if (maleRegex.test(` ${firstToken} `)) return 'Erkek';
                    if (femaleRegex.test(` ${firstToken} `)) return 'Kadın';
                }
                if (maleRegex.test(` ${remainder} `)) return 'Erkek';
                if (femaleRegex.test(` ${remainder} `)) return 'Kadın';
            }

            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1].trim();
                if (nextLine && !GENDER_LABELS.some(l => nextLine.toLowerCase().includes(l.toLowerCase()))) {
                    const firstToken = nextLine.split(/[\s/\\,.;:-]+/)[0].trim();
                    if (firstToken) {
                        if (maleRegex.test(` ${firstToken} `)) return 'Erkek';
                        if (femaleRegex.test(` ${firstToken} `)) return 'Kadın';
                    }
                }
            }
        }

        return '';
    }

    function extractPassportMetadata(text, options = {}) {
        const dates = extractPassportDates(text, options);
        const mrz = extractDatesFromMrz(text);
        const mrzNames = extractMrzNames(text);
        const cinsiyet = extractPassportGender(text, options) || mrz.cinsiyet || '';
        return {
            issueDate: dates.issueDate || '',
            expiryDate: dates.expiryDate || mrz.expiryDate || '',
            birthDate: mrz.birthDate || '',
            cinsiyet: cinsiyet,
            passportNumber: mrz.passportNumber || '',
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
        extractPassportGender,
        extractMrzNames,
        parseDateValue,
        isValidYoksisId,
        getCountryIso3Code
    });
})();
