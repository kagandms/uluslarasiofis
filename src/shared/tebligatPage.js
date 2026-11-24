const TURKISH_ASCII_MAP = Object.freeze({
    ç: 'c', Ç: 'C',
    ğ: 'g', Ğ: 'G',
    ı: 'i', İ: 'I',
    ö: 'o', Ö: 'O',
    ş: 's', Ş: 'S',
    ü: 'u', Ü: 'U'
});

function displayValue(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function appendText(document, parent, tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
}

/** Returns true only when an application is in the sent_to_migration status. */
export function canPrintTebligat(status) {
    return status === 'sent_to_migration';
}

/** Formats an E-İKAMET application number as ####-##-####### from up to 13 digits. */
export function formatEIkametNumber(value) {
    const digits = String(value ?? '').replace(/\D+/gu, '').slice(0, 13);
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/** Formats an ISO/Turkish date or Date object as dd.mm.yyyy for Istanbul display. */
export function formatTebligatDate(value) {
    if (value instanceof Date) {
        if (!Number.isFinite(value.valueOf())) return '';
        return new Intl.DateTimeFormat('tr-TR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'Europe/Istanbul'
        }).format(value);
    }
    const text = displayValue(value);
    if (!text) return '';
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
    if (isoMatch) return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`;
    const trMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(text);
    if (trMatch) return text;
    const parsed = new Date(text);
    if (!Number.isFinite(parsed.valueOf())) return text;
    return new Intl.DateTimeFormat('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Europe/Istanbul'
    }).format(parsed);
}

/** Converts a timestamp or ISO date string to an Europe/Istanbul YYYY-MM-DD date, or '' when invalid. */
export function toIstanbulIsoDate(value) {
    let date;
    if (value instanceof Date) {
        date = value;
    } else if (typeof value === 'string') {
        const text = value.trim();
        if (!text || /^\d+$/u.test(text)) return '';
        const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
        if (dateOnly) {
            const year = Number(dateOnly[1]);
            const month = Number(dateOnly[2]);
            const day = Number(dateOnly[3]);
            const check = new Date(Date.UTC(year, month - 1, day));
            return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
                ? text : '';
        }
        // SQLite CURRENT_TIMESTAMP omits the UTC suffix; treat bare timestamps as UTC instants.
        const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(text)
            ? `${text.replace(' ', 'T')}Z` : text;
        date = new Date(normalized);
    } else {
        return '';
    }
    if (!Number.isFinite(date.valueOf())) return '';
    const parts = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Europe/Istanbul'
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : '';
}

/** Builds an ASCII-folded, hyphen-separated PDF filename capped at 60 characters. */
export function buildTebligatFilename(firstName, lastName) {
    const suffix = '-tebligat.pdf';
    const maxStemLength = 60 - suffix.length;
    const rawName = [firstName, lastName].map(displayValue).filter(Boolean).join(' ');
    const folded = rawName
        .replace(/[çÇğĞıİöÖşŞüÜ]/gu, (character) => TURKISH_ASCII_MAP[character] || character)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/gu, '');
    const sanitised = folded
        .replace(/[^a-zA-Z0-9_-]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, maxStemLength)
        .replace(/-+$/gu, '');
    return `${sanitised || 'ogrenci'}${suffix}`;
}

const TEBLIGAT_FONT_FAMILY = "'Times New Roman',Times,'Liberation Serif',serif";

export const TEBLIGAT_PAGE_STYLES = `
.tebligat-page,.tebligat-page *{font-family:${TEBLIGAT_FONT_FAMILY} !important}
.tebligat-page{position:relative;box-sizing:border-box;display:flex;flex-direction:column;width:794px;height:1123px;padding:49px;overflow:hidden;background:#fff;color:#000;font-size:14px;line-height:1.4}
.tebligat-page .tebligat-header{display:grid;grid-template-columns:140px 1fr 140px;align-items:center;gap:16px;padding-bottom:16px;margin-bottom:28px;border-bottom:1.5px solid #000}
.tebligat-page .tebligat-logo{display:flex;align-items:center;height:62px}
.tebligat-page .tebligat-logo-left{justify-content:flex-start}
.tebligat-page .tebligat-logo-right{justify-content:flex-end}
.tebligat-page .tebligat-logo img{max-width:140px;height:62px;object-fit:contain;display:block}
.tebligat-page .tebligat-header-center{text-align:center}
.tebligat-page .tebligat-university-name{margin:0 0 4px;font-size:12px;letter-spacing:.5px !important;color:#000}
.tebligat-page .tebligat-title{margin:0;font-size:22px;font-weight:700;line-height:1.2;color:#000}
.tebligat-page .tebligat-student{margin-bottom:28px}
.tebligat-page .tebligat-caption{display:block;margin:0 0 6px;font-size:11px;color:#444;text-transform:uppercase !important;letter-spacing:.4px !important}
.tebligat-page .tebligat-student-name{margin:0;font-size:28px;font-weight:700;line-height:1.2;color:#000;overflow-wrap:anywhere}
.tebligat-page .tebligat-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px 28px;margin:0 0 28px}
.tebligat-page .tebligat-field{min-width:0}
.tebligat-page .tebligat-field dt{margin:0 0 6px;font-size:11px;color:#444;text-transform:uppercase !important;letter-spacing:.4px !important;font-weight:400}
.tebligat-page .tebligat-field dd,.tebligat-page .tebligat-value{margin:0;padding:0 0 6px;border-bottom:1px solid #999;font-size:16px;color:#000;min-height:22px;overflow-wrap:anywhere}
.tebligat-page .tebligat-status-section{margin-bottom:24px}
.tebligat-page .tebligat-status-box{border:1.5px solid #000;padding:12px 16px;font-size:16px;font-weight:700;color:#000}
.tebligat-page .tebligat-date-section{margin-bottom:24px}
.tebligat-page .tebligat-footer{margin-top:auto;padding-top:12px;border-top:1px solid #999;font-size:12px;color:#333}
`;

/** Creates the single-page A4 Tebliğ / Tebligat DOM node using textContent-safe writes. */
export function createTebligatPage(document, details = {}, logos = null) {
    const root = document.createElement('article');
    root.className = 'tebligat-page';
    root.setAttribute('aria-label', 'TEBLİĞ / TEBLİGAT SAYFASI');
    root.lang = 'tr';
    root.dir = 'ltr';

    const header = document.createElement('header');
    header.className = 'tebligat-header';

    const migrationWrap = document.createElement('div');
    migrationWrap.className = 'tebligat-logo tebligat-logo-left';
    const migrationLogo = document.createElement('img');
    migrationLogo.dataset.documentLogo = 'migration';
    migrationLogo.src = logos?.migration || '';
    migrationLogo.alt = 'Göç İdaresi Başkanlığı logosu';
    migrationWrap.append(migrationLogo);

    const center = document.createElement('div');
    center.className = 'tebligat-header-center';
    appendText(document, center, 'p', 'tebligat-university-name', 'TOPKAPI ÜNİVERSİTESİ');
    appendText(document, center, 'h1', 'tebligat-title', 'TEBLİĞ / TEBLİGAT SAYFASI');

    const universityWrap = document.createElement('div');
    universityWrap.className = 'tebligat-logo tebligat-logo-right';
    const universityLogo = document.createElement('img');
    universityLogo.dataset.documentLogo = 'university';
    universityLogo.src = logos?.university || '';
    universityLogo.alt = 'İstanbul Topkapı Üniversitesi logosu';
    universityWrap.append(universityLogo);

    header.append(migrationWrap, center, universityWrap);
    root.append(header);

    const studentSection = document.createElement('section');
    studentSection.className = 'tebligat-student';
    appendText(document, studentSection, 'span', 'tebligat-caption', 'ÖĞRENCİ');
    const rawFullName = [details.firstName, details.lastName].map(displayValue).filter(Boolean).join(' ');
    const fullName = rawFullName ? rawFullName.toUpperCase() : '—';
    appendText(document, studentSection, 'p', 'tebligat-student-name', fullName);
    root.append(studentSection);

    const grid = document.createElement('dl');
    grid.className = 'tebligat-grid';
    const gridFields = [
        ['E-İKAMET BAŞVURU NO', displayValue(details.eIkametNo) || '—'],
        ['PASAPORT NO', displayValue(details.passportNumber) || '—'],
        ['YÖKSİS BAŞVURU KAYIT NO', displayValue(details.basvuruKayitNo) || '—'],
        ['YÖKSİS İŞLEM KAYIT NO', displayValue(details.islemKayitNo) || '—'],
        ['DOĞUM TARİHİ', formatTebligatDate(details.birthDate) || '—']
    ];
    for (const [label, value] of gridFields) {
        const item = document.createElement('div');
        item.className = 'tebligat-field';
        appendText(document, item, 'dt', '', label);
        const dd = appendText(document, item, 'dd', '', value);
        dd.dir = 'ltr';
        grid.append(item);
    }
    root.append(grid);

    const statusSection = document.createElement('section');
    statusSection.className = 'tebligat-status-section';
    appendText(document, statusSection, 'span', 'tebligat-caption', 'GÖÇ DURUMU');
    appendText(document, statusSection, 'div', 'tebligat-status-box', 'Göç İdaresine iletildi');
    root.append(statusSection);

    const dateSection = document.createElement('section');
    dateSection.className = 'tebligat-date-section';
    appendText(document, dateSection, 'span', 'tebligat-caption', 'GÖÇ İDARESİNE GİDİŞ TARİHİ');
    const goDate = appendText(document, dateSection, 'div', 'tebligat-value', formatTebligatDate(details.migrationGoDate) || '—');
    goDate.dir = 'ltr';
    root.append(dateSection);

    const printedLabel = formatTebligatDate(details.printedAt instanceof Date ? details.printedAt : new Date());
    appendText(document, root, 'footer', 'tebligat-footer', `Çıktı tarihi: ${printedLabel}`);

    return root;
}
