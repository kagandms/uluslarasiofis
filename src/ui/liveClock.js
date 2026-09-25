/**
 * Live Digital Clock for Header
 * Updates every second with current time (HH:mm:ss) and Turkish date.
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
 * Formats a Date object into localized Turkish date string.
 * @param {Date} date
 * @param {string} [locale='tr-TR']
 * @returns {string} e.g. "25 Eylül 2026, Cuma"
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
 * @param {Object} [options]
 * @param {HTMLElement} [options.container]
 * @param {HTMLElement} [options.timeElement]
 * @param {HTMLElement} [options.dateElement]
 * @returns {Function} cleanup/destroy function
 */
export function initLiveClock(options = {}) {
    const timeEl = options.timeElement || (typeof document !== 'undefined' ? document.getElementById('live-clock-time') : null);
    const dateEl = options.dateElement || (typeof document !== 'undefined' ? document.getElementById('live-clock-date') : null);

    if (!timeEl && !dateEl) {
        return () => {};
    }

    let intervalId = null;
    let timeoutId = null;
    let isDestroyed = false;

    function render() {
        if (isDestroyed) return;
        const now = new Date();
        const timeStr = formatClockTime(now);
        if (timeEl && timeEl.textContent !== timeStr) {
            timeEl.textContent = timeStr;
        }
        if (dateEl) {
            const dateStr = formatClockDate(now);
            if (dateEl.textContent !== dateStr) {
                dateEl.textContent = dateStr;
            }
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
        }, msUntilNextSecond);
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
    }

    return function destroy() {
        isDestroyed = true;
        if (intervalId) clearInterval(intervalId);
        if (timeoutId) clearTimeout(timeoutId);
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        }
    };
}
