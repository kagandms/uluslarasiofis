import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { getNewestSheetNames } from '../src/ui/tebligatSearch.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appsScriptSource = await readFile(resolve(testDirectory, '../apps_script.txt'), 'utf8');

test('Tebliğ search scans the newest sixteen date sheets and collects all matches', () => {
    assert.match(appsScriptSource, /var ARAMA_SAYFA_LIMITI = 16;/);
    assert.match(appsScriptSource, /Math\.min\(tarih[^\n]+ARAMA_SAYFA_LIMITI\)/);
    assert.doesNotMatch(appsScriptSource, /sonuclar\.length\s*>\s*0[\s\S]{0,120}break;/);
});

test('local Tebliğ search uses the same newest sixteen date-sheet window', () => {
    const records = Array.from({ length: 17 }, (_, index) => ({
        sayfa: `${String(17 - index).padStart(2, '0')}.06.2026`
    }));

    const searchableSheets = getNewestSheetNames(records, '2026');

    assert.equal(searchableSheets.size, 16);
    assert.equal(searchableSheets.has('17.06.2026'), true);
    assert.equal(searchableSheets.has('02.06.2026'), true);
    assert.equal(searchableSheets.has('01.06.2026'), false);
});
