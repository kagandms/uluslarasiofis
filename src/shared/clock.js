let clockOffsetMs = 0;

/** Synchronizes browser time from a same-origin HTTP Date header.
 * @param {string|null} dateHeader Server response Date.
 * @param {{startedAt: number, receivedAt: number}} timing Client request timestamps.
 * @returns {boolean} Whether a valid time sample was applied.
 */
export function synchronizeClock(dateHeader, { startedAt, receivedAt }) {
    const serverTime = Date.parse(dateHeader);
    if (!Number.isFinite(serverTime) || !Number.isFinite(startedAt) || !Number.isFinite(receivedAt)
        || receivedAt < startedAt) return false;
    clockOffsetMs = serverTime - (startedAt + receivedAt) / 2;
    return true;
}

/** Reads current time corrected by the last server sample.
 * @returns {Date} Synchronized instant, or local time before synchronization.
 */
export function readSynchronizedNow() {
    return new Date(Date.now() + clockOffsetMs);
}
