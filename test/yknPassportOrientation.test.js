import assert from 'node:assert/strict';
import test from 'node:test';
import { selectBestPassportOrientation } from '../src/utils/passport-orientation.js';

test('selects the rotated passport orientation with the strongest OCR evidence', () => {
    const result = selectBestPassportOrientation([
        { rotation: 0, score: 8, text: 'unreadable' },
        { rotation: 90, score: 71, text: 'PASSPORT DATE OF ISSUE' },
        { rotation: 180, score: 19, text: 'partial' },
        { rotation: 270, score: 12, text: 'partial' }
    ]);

    assert.deepEqual(result, { rotation: 90, score: 71, text: 'PASSPORT DATE OF ISSUE' });
});

test('keeps upright orientation when OCR scores are tied', () => {
    const result = selectBestPassportOrientation([
        { rotation: 0, score: 40, text: 'upright' },
        { rotation: 180, score: 40, text: 'upside down' }
    ]);

    assert.equal(result.rotation, 0);
});
