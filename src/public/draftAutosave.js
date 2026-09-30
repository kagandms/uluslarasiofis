function createPatch(latestValues, savedValues) {
    return Object.fromEntries(Object.entries(latestValues)
        .filter(([key, value]) => savedValues[key] !== value));
}

/**
 * Creates a serialized, debounced draft writer that keeps unsaved values in memory.
 * @param {object} options Save callback, timing, state callback, and initial canonical values.
 * @returns {object} Scheduling, flush, status, and disposal operations.
 */
export function createDraftAutosave({
    save,
    delayMs = 500,
    initialValues = {},
    onStatus = () => {},
    onSaved = () => {},
    onError = () => {}
}) {
    let latestValues = { ...initialValues };
    let savedValues = { ...initialValues };
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
        latestValues = { ...latestValues, ...values };
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
            const application = await save(patch);
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

    function dispose() {
        disposed = true;
        clearTimeout(timer);
    }

    return Object.freeze({ schedule, flush, dispose, getStatus: () => status });
}
