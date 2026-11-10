const LIST_URL = '/api/staff/application-ratings?limit=100';
const STAR_COUNT = 5;

const STATUS_LABELS = Object.freeze({
    submitted: 'Gönderildi',
    under_review: 'İncelemede',
    resubmission_required: 'Belge güncellemesi',
    approved_for_processing: 'İşleme alındı',
    sent_to_migration: 'Göç İdaresine gönderildi',
    migration_approved: 'Göç onaylandı',
    completed: 'Tamamlandı',
    cancelled: 'İptal edildi',
    rejected: 'Reddedildi'
});

function createRatingsApi() {
    return {
        async readRatings() {
            let response;
            try {
                response = await fetch(LIST_URL, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            } catch {
                throw Object.assign(new Error('Değerlendirmeler yüklenemedi. Bağlantınızı kontrol edin.'), { status: 0 });
            }
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw Object.assign(new Error(payload?.error?.message || 'Değerlendirmeler yüklenemedi.'), { status: response.status });
            }
            return payload;
        }
    };
}

function formatNumber(value) {
    return value.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function formatDateTime(value) {
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) return '';
    return new Intl.DateTimeFormat('tr-TR', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul'
    }).format(instant);
}

/**
 * Builds five star glyphs filled to the rating, with half stars shown as a half-filled glyph.
 * @param {Document} document Owning document.
 * @param {number} rating Star value such as 4.5.
 * @returns {HTMLElement} Accessible star display.
 */
function createStarDisplay(document, rating) {
    const display = document.createElement('span');
    display.className = 'rating-stars-display';
    display.setAttribute('role', 'img');
    display.setAttribute('aria-label', `${formatNumber(rating)} / ${STAR_COUNT}`);
    for (let index = 0; index < STAR_COUNT; index += 1) {
        const glyph = document.createElement('span');
        glyph.className = 'rating-star-glyph';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.textContent = '★';
        const share = Math.min(Math.max(rating - index, 0), 1);
        glyph.style.setProperty('--fill', `${Math.round(share * 100)}%`);
        glyph.style.setProperty('--rating-star-size', '1.1rem');
        display.append(glyph);
    }
    return display;
}

function createRatingItem(document, item) {
    const card = document.createElement('article');
    card.className = 'staff-rating-item';

    const head = document.createElement('div');
    head.className = 'staff-rating-item-head';
    const score = document.createElement('strong');
    score.className = 'staff-rating-score';
    score.textContent = `${formatNumber(item.rating)} / ${STAR_COUNT}`;
    head.append(createStarDisplay(document, item.rating), score);

    const meta = document.createElement('p');
    meta.className = 'staff-rating-meta';
    const who = [item.student_name, item.student_number ? `Öğrenci no: ${item.student_number}` : null, item.reference_number ? `Başvuru: ${item.reference_number}` : null]
        .filter(Boolean).join(' · ');
    meta.textContent = who || 'Başvuru bilgisi yok';

    const when = document.createElement('p');
    when.className = 'staff-rating-meta';
    const status = STATUS_LABELS[item.status] || item.status || '';
    when.textContent = [formatDateTime(item.updated_at), status].filter(Boolean).join(' · ');

    const feedback = document.createElement('p');
    feedback.className = 'staff-rating-feedback';
    const text = typeof item.feedback === 'string' ? item.feedback.trim() : '';
    if (text) {
        feedback.textContent = text;
    } else {
        feedback.textContent = 'Geri dönüş yazılmadı.';
        feedback.classList.add('is-empty');
    }

    card.append(head, meta, when, feedback);
    return card;
}

/**
 * Renders the collapsible staff panel listing student ratings with a count and average.
 * The panel reloads on every open and on demand; it never writes data.
 * @param {HTMLDetailsElement} root Details element containing the panel markup.
 * @param {{readRatings: () => Promise<object>}} [api] Staff ratings API.
 * @returns {{refresh: () => Promise<void>}} Refresh handle.
 */
export function initializeStaffApplicationRatings(root, api = createRatingsApi()) {
    const document = root.ownerDocument;
    const countLabel = root.querySelector('[data-ratings-count]');
    const list = root.querySelector('[data-ratings-list]');
    const status = root.querySelector('[data-ratings-status]');
    const refreshButton = root.querySelector('[data-ratings-refresh]');
    let requestId = 0;

    function setBusy(isBusy) {
        refreshButton.disabled = isBusy;
        root.setAttribute('aria-busy', String(isBusy));
    }

    function renderSummary(summary) {
        const average = summary.average === null || summary.average === undefined
            ? 'Henüz puan yok'
            : `Ortalama ${formatNumber(summary.average)} / ${STAR_COUNT}`;
        countLabel.textContent = `${summary.count} değerlendirme · ${average}`;
    }

    function render(payload) {
        renderSummary(payload.summary || { count: 0, average: null });
        list.replaceChildren();
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (items.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'staff-ratings-empty';
            empty.textContent = 'Henüz değerlendirme gelmedi.';
            list.append(empty);
            return;
        }
        list.append(...items.map((item) => createRatingItem(document, item)));
    }

    async function refresh() {
        const id = ++requestId;
        setBusy(true);
        status.textContent = 'Yükleniyor…';
        try {
            const payload = await api.readRatings();
            if (id !== requestId) return;
            render(payload);
            status.textContent = '';
        } catch (error) {
            if (id !== requestId) return;
            status.textContent = error.message || 'Değerlendirmeler yüklenemedi.';
        } finally {
            if (id === requestId) setBusy(false);
        }
    }

    refreshButton.addEventListener('click', () => { void refresh(); });
    root.addEventListener('toggle', () => { if (root.open) void refresh(); });
    void refresh();
    return { refresh };
}
