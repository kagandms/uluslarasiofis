(function registerTemporaryStorage(global) {
    const TEMPORARY_DATA_KEYS = ['studentData', 'pendingPassportCrop', 'croppedPhotoBase64'];
    const TIMESTAMP_KEY = 'temporaryStudentDataSavedAt';
    const TTL_MS = 24 * 60 * 60 * 1000;
    const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

    function getCleanupPlan(snapshot, now = Date.now()) {
        const hasTemporaryData = TEMPORARY_DATA_KEYS.some((key) => Object.hasOwn(snapshot || {}, key));
        const hasTimestamp = Object.hasOwn(snapshot || {}, TIMESTAMP_KEY);
        if (!hasTemporaryData) {
            return { removeKeys: hasTimestamp ? [TIMESTAMP_KEY] : [], timestampToSet: null };
        }

        const savedAt = Number(snapshot[TIMESTAMP_KEY]);
        const hasValidTimestamp = Number.isFinite(savedAt)
            && savedAt > 0
            && savedAt <= now + MAX_CLOCK_SKEW_MS;
        if (!hasValidTimestamp) return { removeKeys: [], timestampToSet: now };

        if (now - savedAt >= TTL_MS) {
            return { removeKeys: [...TEMPORARY_DATA_KEYS, TIMESTAMP_KEY], timestampToSet: null };
        }

        return { removeKeys: [], timestampToSet: null };
    }

    global.YKN_TEMPORARY_STORAGE = Object.freeze({ TEMPORARY_DATA_KEYS, TIMESTAMP_KEY, TTL_MS, getCleanupPlan });
})(globalThis);
