function areValuesEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
        && keys.every(key => Object.hasOwn(right, key) && areValuesEqual(left[key], right[key]));
}

function createPatch(latestValues, savedValues) {
    return Object.fromEntries(Object.entries(latestValues)
        .filter(([key, value]) => !areValuesEqual(savedValues[key], value)));
}

/**
 * Creates a serialized, debounced draft writer that keeps unsaved values in memory.
 * @param {object} options Save callback, timing, state callback, and initial canonical values.
 * @returns {object} Scheduling, flush, status, and disposal operations.
 */
export function createDraftAutosave({
    save,
    eventTarget = globalThis.window,
    delayMs = 500,
    initialValues = {},
    onStatus = () => {},
    onSaved = () => {},
    onError = () => {}
}) {
    let latestValues = structuredClone(initialValues);
    let savedValues = structuredClone(initialValues);
    let pendingValues = {};
    let timer = null;
    let activeSave = null;
    let revision = 0;
    let status = 'saved';
    let disposed = false;

    function updateStatus(nextStatus) {
        status = nextStatus;
        onStatus(nextStatus);
    }

    function schedule(values) {
        if (disposed) return;
        latestValues = { ...latestValues, ...structuredClone(values) };
        revision += 1;
        pendingValues = createPatch(latestValues, savedValues);
        if (Object.keys(pendingValues).length === 0) {
            clearTimeout(timer);
            timer = null;
            updateStatus('saved');
            return;
        }
        updateStatus('unsaved');
        clearTimeout(timer);
        timer = setTimeout(() => { void flush(); }, delayMs);
    }

    async function writePending() {
        const patch = pendingValues;
        const requestRevision = revision;
        pendingValues = {};
        updateStatus('saving');
        try {
            const application = await save(structuredClone(patch));
            savedValues = { ...savedValues, ...patch };
            pendingValues = createPatch(latestValues, savedValues);
            if (requestRevision === revision || Object.keys(pendingValues).length === 0) onSaved(application);
            if (Object.keys(pendingValues).length === 0) updateStatus('saved');
            else updateStatus('unsaved');
            return true;
        } catch (error) {
            pendingValues = createPatch(latestValues, savedValues);
            onError(error);
            updateStatus('failed');
            return false;
        }
    }

    async function flush() {
        clearTimeout(timer);
        timer = null;
        while (!disposed) {
            if (activeSave) {
                const completed = await activeSave;
                if (!completed) return false;
                continue;
            }
            if (Object.keys(pendingValues).length === 0) return true;
            activeSave = writePending();
            const completed = await activeSave;
            activeSave = null;
            if (!completed) return false;
        }
        return false;
    }

    const handleOnline = () => { void flush(); };
    eventTarget?.addEventListener('online', handleOnline);

    function dispose() {
        disposed = true;
        eventTarget?.removeEventListener('online', handleOnline);
        clearTimeout(timer);
    }

    return Object.freeze({ schedule, flush, dispose, getStatus: () => status });
}
