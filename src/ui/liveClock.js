/**
 * Live Digital Clock for Header
 * Updates every second with current time (HH:mm:ss) and localized date.
 */

/**
 * Formats a Date object into HH:mm:ss string with leading zeros.
 * @param {Date} date
 * @returns {string} e.g. "14:05:09"
 */
export function formatClockTime(date = new Date()) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

/**
 * Formats a Date object into localized date string.
 * @param {Date} date
 * @param {string} [locale='tr-TR']
 * @returns {string} e.g. "5 Ekim 2026, Pazartesi"
 */
export function formatClockDate(date = new Date(), locale = 'tr-TR') {
    try {
        const day = date.getDate();
        const month = date.toLocaleDateString(locale, { month: 'long' });
        const year = date.getFullYear();
        const weekday = date.toLocaleDateString(locale, { weekday: 'long' });
        return `${day} ${month} ${year}, ${weekday}`;
    } catch {
        return date.toLocaleDateString(locale);
    }
}

/**
 * Initializes the header live clock and keeps it in sync with real time.
 * Supports multiple instances across the page if present.
 * @param {Object} [options]
 * @param {HTMLElement|NodeList|Array} [options.timeElements]
 * @param {HTMLElement|NodeList|Array} [options.dateElements]
 * @param {Function} [options.getLocale]
 * @returns {Function} cleanup/destroy function
 */
export function initLiveClock(options = {}) {
    function resolveElements(query, explicit) {
        if (explicit) {
            if (explicit instanceof NodeList || Array.isArray(explicit)) return Array.from(explicit);
            return [explicit];
        }
        if (typeof document !== 'undefined') {
            return Array.from(document.querySelectorAll(query));
        }
        return [];
    }

    const timeEls = resolveElements('#live-clock-time, .live-clock-time', options.timeElements);
    const dateEls = resolveElements('#live-clock-date, .live-clock-date', options.dateElements);

    if (timeEls.length === 0 && dateEls.length === 0) {
        return () => {};
    }

    let intervalId = null;
    let timeoutId = null;
    let isDestroyed = false;

    function getCurrentLocale() {
        if (typeof options.getLocale === 'function') {
            try { return options.getLocale() || 'tr-TR'; } catch { /* ignore */ }
        }
        if (typeof document !== 'undefined') {
            const docLang = document.documentElement.lang;
            if (docLang === 'en') return 'en-US';
            if (docLang === 'ru') return 'ru-RU';
            if (docLang === 'ar') return 'ar-SA';
            if (docLang === 'tk') return 'tr-TR'; // Türkmençe fallback
            if (docLang === 'tr') return 'tr-TR';
        }
        return 'tr-TR';
    }

    function render() {
        if (isDestroyed) return;
        const now = new Date();
        const timeStr = formatClockTime(now);
        timeEls.forEach((el) => {
            if (el && el.textContent !== timeStr) el.textContent = timeStr;
        });

        if (dateEls.length > 0) {
            const locale = getCurrentLocale();
            const dateStr = formatClockDate(now, locale);
            dateEls.forEach((el) => {
                if (el && el.textContent !== dateStr) el.textContent = dateStr;
            });
        }
    }

    // Initial immediate render
    render();

    // Synchronize interval with exact second roll-over
    function startTicker() {
        if (isDestroyed) return;
        const now = new Date();
        const msUntilNextSecond = 1000 - now.getMilliseconds();

        timeoutId = setTimeout(() => {
            render();
            intervalId = setInterval(render, 1000);
            if (intervalId && typeof intervalId.unref === 'function') {
                intervalId.unref();
            }
        }, msUntilNextSecond);
        if (timeoutId && typeof timeoutId.unref === 'function') {
            timeoutId.unref();
        }
    }

    startTicker();

    // Re-sync when page tab becomes visible again
    function handleVisibilityChange() {
        if (typeof document !== 'undefined' && !document.hidden && !isDestroyed) {
            if (intervalId) clearInterval(intervalId);
            if (timeoutId) clearTimeout(timeoutId);
            render();
            startTicker();
        }
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', handleVisibilityChange);
        document.addEventListener('public:locale-changed', render);
    }

    return function destroy() {
        isDestroyed = true;
        if (intervalId) clearInterval(intervalId);
        if (timeoutId) clearTimeout(timeoutId);
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            document.removeEventListener('public:locale-changed', render);
        }
    };
}
