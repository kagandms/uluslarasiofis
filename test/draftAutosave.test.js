import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDraftAutosave } from '../src/public/draftAutosave.js';

const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

test('draft autosave debounces and coalesces rapid edits into one patch', async () => {
    const patches = [];
    const autosave = createDraftAutosave({
        delayMs: 15,
        save: async (patch) => { patches.push(patch); return { saved: true }; }
    });

    autosave.schedule({ first_name: 'A' });
    autosave.schedule({ last_name: 'B' });
    await wait(30);

    assert.deepEqual(patches, [{ first_name: 'A', last_name: 'B' }]);
    assert.equal(autosave.getStatus(), 'saved');
    autosave.dispose();
});

test('continue flush waits for the pending patch and avoids a duplicate patch', async () => {
    const patches = [];
    const autosave = createDraftAutosave({ delayMs: 1000, save: async (patch) => { patches.push(patch); return {}; } });

    autosave.schedule({ student_phone: '123' });
    assert.equal(await autosave.flush(), true);
    assert.equal(await autosave.flush(), true);
    assert.deepEqual(patches, [{ student_phone: '123' }]);
    autosave.dispose();
});

test('failed autosave keeps pending values and reports failure for an explicit flush retry', async () => {
    let shouldFail = true;
    const patches = [];
    const autosave = createDraftAutosave({ delayMs: 1000, save: async (patch) => {
        patches.push(patch);
        if (shouldFail) throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' });
        return {};
    } });

    autosave.schedule({ passport_number: 'P-1' });
    assert.equal(await autosave.flush(), false);
    assert.equal(autosave.getStatus(), 'failed');
    shouldFail = false;
    assert.equal(await autosave.flush(), true);
    assert.deepEqual(patches, [{ passport_number: 'P-1' }, { passport_number: 'P-1' }]);
    autosave.dispose();
});

test('older response does not replace latest canonical state and writes stay serialized', async () => {
    const responses = [];
    const states = [];
    let releaseFirst;
    const autosave = createDraftAutosave({
        delayMs: 1000,
        save: (patch) => new Promise((resolve) => {
            responses.push(patch);
            if (responses.length === 1) releaseFirst = () => resolve({ value: 'old' });
            else resolve({ value: 'new' });
        }),
        onSaved: (application) => states.push(application.value)
    });

    autosave.schedule({ value: 'one' });
    const firstFlush = autosave.flush();
    await wait(0);
    autosave.schedule({ value: 'two' });
    releaseFirst();
    assert.equal(await firstFlush, true);
    assert.deepEqual(responses, [{ value: 'one' }, { value: 'two' }]);
    assert.deepEqual(states, ['new']);
    autosave.dispose();
});
