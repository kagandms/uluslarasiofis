import { readApplicationRatingMessages } from './i18n/applicationRatingMessages.js';

const STAR_COUNT = 5;
const HALF_STEP_COUNT = STAR_COUNT * 2;
const FEEDBACK_MAX_LENGTH = 1000;
const STAR_GLYPH = '★';

/**
 * Formats a star value for the document locale, for example 4.5 as "4,5" in Turkish.
 * @param {number} stars Star value in half-star steps.
 * @param {string} locale Document language code.
 * @returns {string} Localized numeric text.
 */
function formatStars(stars, locale) {
    return stars.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

/**
 * Sets each star's fill from a half-star selection: 0, 50, or 100 percent per star.
 * @param {Array<HTMLElement>} glyphs Star glyph elements, leftmost first.
 * @param {number|null} selectedHalf Selected half-star value (1 to 10), or null.
 */
function paintStars(glyphs, selectedHalf) {
    glyphs.forEach((glyph, index) => {
        const starStart = index * 2;
        const share = selectedHalf === null ? 0 : Math.min(Math.max((selectedHalf - starStart) / 2, 0), 1);
        glyph.style.setProperty('--fill', `${Math.round(share * 100)}%`);
    });
}

/**
 * Builds the 10 half-star radio buttons laid over five star glyphs.
 * Arrow keys move one half step, Home and End jump to the ends; the checked half is the only tab stop.
 * @param {Document} document Owning document.
 * @param {object} messages Localized copy.
 * @param {string} locale Document language code.
 * @param {(half: number) => void} onSelect Called with the chosen half-star value.
 * @returns {{element: HTMLElement, glyphs: Array<HTMLElement>, buttons: Array<HTMLElement>, show: (half: number|null) => void}}
 */
function createStarControl(document, messages, locale, onSelect) {
    const group = document.createElement('div');
    group.className = 'rating-stars-control';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', messages.ratingStarsLabel);

    const glyphs = [];
    const buttons = [];
    for (let star = 0; star < STAR_COUNT; star += 1) {
        const cell = document.createElement('span');
        cell.className = 'rating-star-cell';
        const glyph = document.createElement('span');
        glyph.className = 'rating-star-glyph';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.textContent = STAR_GLYPH;
        cell.append(glyph);
        glyphs.push(glyph);
        for (const side of ['start', 'end']) {
            const half = star * 2 + (side === 'start' ? 1 : 2);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `rating-half rating-half-${side}`;
            button.dataset.half = String(half);
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-checked', 'false');
            button.setAttribute('aria-label', `${formatStars(half / 2, locale)} ${messages.ratingStarWord}`);
            button.tabIndex = -1;
            cell.append(button);
            buttons[half - 1] = button;
        }
        group.append(cell);
    }

    group.addEventListener('click', (event) => {
        const button = event.target.closest?.('[data-half]');
        if (button) onSelect(Number(button.dataset.half));
    });
    group.addEventListener('keydown', (event) => {
        const current = Number(event.target.closest?.('[data-half]')?.dataset.half || 0);
        if (!current) return;
        let next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(current + 1, HALF_STEP_COUNT);
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(current - 1, 1);
        else if (event.key === 'Home') next = 1;
        else if (event.key === 'End') next = HALF_STEP_COUNT;
        if (next === null) return;
        event.preventDefault();
        onSelect(next);
        buttons[next - 1]?.focus();
    });

    function show(selectedHalf) {
        paintStars(glyphs, selectedHalf);
        const tabStop = selectedHalf ?? 1;
        buttons.forEach((button, index) => {
            const isChecked = index + 1 === selectedHalf;
            button.setAttribute('aria-checked', String(isChecked));
            button.tabIndex = index + 1 === tabStop ? 0 : -1;
        });
    }

    return { element: group, glyphs, buttons, show };
}

/**
 * Creates the application-system rating form shown inside the submitted-application confirmation.
 * It preloads any rating already saved for this application and posts updates through the owner session.
 * @param {Document} document Owning document.
 * @param {{readCurrentApplicationRating?: Function, saveCurrentApplicationRating?: Function}} api Applicant API.
 * @returns {HTMLElement} Rating section element.
 */
export function createApplicationRatingSection(document, api) {
    const locale = document.documentElement.lang || 'tr';
    const messages = readApplicationRatingMessages(locale);
    const uid = Math.random().toString(36).slice(2, 8);
    const section = document.createElement('section');
    section.className = 'application-rating';
    section.setAttribute('aria-labelledby', `rating-heading-${uid}`);

    const heading = document.createElement('h4');
    heading.id = `rating-heading-${uid}`;
    heading.textContent = messages.ratingHeading;
    const intro = document.createElement('p');
    intro.className = 'application-rating-intro';
    intro.textContent = messages.ratingIntro;

    let selectedHalf = null;
    let savedHalf = null;
    let isSaving = false;

    const stars = createStarControl(document, messages, locale, (half) => {
        selectedHalf = half;
        refresh();
    });
    const valueText = document.createElement('p');
    valueText.className = 'rating-value';
    valueText.setAttribute('aria-live', 'polite');

    const feedbackLabel = document.createElement('label');
    feedbackLabel.className = 'rating-feedback';
    const feedbackTitle = document.createElement('span');
    feedbackTitle.textContent = messages.ratingFeedbackLabel;
    const textarea = document.createElement('textarea');
    textarea.rows = 4;
    textarea.maxLength = FEEDBACK_MAX_LENGTH;
    textarea.placeholder = messages.ratingFeedbackPlaceholder;
    feedbackLabel.append(feedbackTitle, textarea);
    const counter = document.createElement('p');
    counter.className = 'rating-counter';
    counter.setAttribute('aria-live', 'off');

    const status = document.createElement('p');
    status.className = 'rating-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const savedAtLine = document.createElement('p');
    savedAtLine.className = 'rating-saved-at';
    savedAtLine.hidden = true;

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'application-button application-button-primary rating-submit';

    function refresh() {
        stars.show(selectedHalf);
        valueText.textContent = selectedHalf === null
            ? messages.ratingNoValue
            : `${messages.ratingValue} ${formatStars(selectedHalf / 2, locale)} / ${STAR_COUNT}`;
        counter.textContent = `${textarea.value.length} / ${FEEDBACK_MAX_LENGTH} ${messages.ratingCounter}`;
        submit.textContent = isSaving
            ? messages.ratingSubmitting
            : (savedHalf === null ? messages.ratingSubmit : messages.ratingUpdate);
        submit.disabled = isSaving;
    }

    function setStatus(text, tone = '') {
        status.textContent = text;
        status.dataset.tone = tone;
    }

    function applySaved(rating) {
        selectedHalf = Math.round(rating.rating * 2);
        savedHalf = selectedHalf;
        textarea.value = typeof rating.feedback === 'string' ? rating.feedback : '';
        const savedAt = new Date(rating.updated_at);
        if (Number.isFinite(savedAt.getTime())) {
            savedAtLine.textContent = `${messages.ratingSavedAt} ${new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul'
            }).format(savedAt)}`;
            savedAtLine.hidden = false;
        }
        refresh();
    }

    textarea.addEventListener('input', refresh);

    submit.addEventListener('click', async () => {
        if (isSaving) return;
        if (selectedHalf === null) {
            setStatus(messages.ratingRequired, 'error');
            stars.buttons[0]?.focus();
            return;
        }
        isSaving = true;
        setStatus('');
        refresh();
        try {
            const payload = await api.saveCurrentApplicationRating({
                rating: selectedHalf / 2,
                feedback: textarea.value.trim()
            });
            applySaved(payload.rating);
            setStatus(messages.ratingSaved, 'success');
        } catch {
            setStatus(messages.ratingSaveFailed, 'error');
        } finally {
            isSaving = false;
            refresh();
        }
    });

    section.append(heading, intro, stars.element, valueText, feedbackLabel, counter, submit, status, savedAtLine);
    refresh();

    if (typeof api.readCurrentApplicationRating === 'function') {
        api.readCurrentApplicationRating()
            .then((payload) => { if (payload?.rating) applySaved(payload.rating); })
            .catch(() => setStatus(messages.ratingLoadFailed, 'error'));
    }
    return section;
}
