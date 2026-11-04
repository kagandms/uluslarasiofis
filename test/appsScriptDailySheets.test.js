import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));

function createSheet(name, values = []) {
    const metadata = new Map();
    const protections = [];
    return {
        name,
        values,
        metadata,
        rangeReads: 0,
        autoResizeRange: null,
        getName() { return this.name; },
        setName(value) { this.name = value; return this; },
        getMaxRows() { return 1000; },
        getLastRow() { return this.values.reduce((last, row, index) => row?.some(value => value !== '' && value != null) ? index + 1 : last, 0); },
        getProtections() { return protections; },
        autoResizeColumns(start, count) { this.autoResizeRange = [start, count]; },
        hideColumns() { this.hidden = true; },
        deleteRow(row) { this.values.splice(row - 1, 1); },
        protect() { return { setWarningOnly() { return this; } }; },
        addDeveloperMetadata(key, value) { metadata.set(key, value); return this; },
        getDeveloperMetadata() { return [...metadata].map(([key, value]) => ({ getKey: () => key, getValue: () => value })); },
        getRange(row, column, rows = 1, columns = 1) {
            const sheet = this;
            return {
                setValues(next) {
                    for (let r = 0; r < rows; r++) {
                        sheet.values[row - 1 + r] ??= [];
                        for (let c = 0; c < columns; c++) sheet.values[row - 1 + r][column - 1 + c] = next[r][c];
                    }
                    return this;
                },
                getValues() {
                    sheet.rangeReads++;
                    return Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => sheet.values[row - 1 + r]?.[column - 1 + c] ?? ''));
                },
                getValue() { return sheet.values[row - 1]?.[column - 1] ?? ''; },
                setValue(value) { sheet.values[row - 1] ??= []; sheet.values[row - 1][column - 1] = value; return this; },
                clearContent() { if (sheet.values[row - 1]) sheet.values[row - 1][column - 1] = ''; return this; },
                setBackground(color) { sheet.headerBackground = color; return this; },
                getColumn() { return column; },
                getLastColumn() { return column + columns - 1; },
                protect() {
                    const range = this;
                    const protection = { getRange: () => range, setWarningOnly() { return this; } };
                    protections.push(protection);
                    return protection;
                },
                setFontWeight() { return this; },
                setNumberFormat() { return this; }
            };
        }
    };
}

function loadScript({ sheets = [], now = new Date('2026-11-03T05:00:00Z'), triggers = [], apiKey = 'test-api-key', spreadsheetId = null } = {}) {
    const workbook = {
        sheets,
        getSheets() { return this.sheets; },
        getSheetByName(name) { return this.sheets.find(sheet => sheet.name === name) ?? null; },
        insertSheet(name) {
            const sheet = createSheet(name);
            this.sheets.push(sheet);
            return sheet;
        },
        setActiveSheet(sheet) { this.activeSheet = sheet; },
        moveActiveSheet(position) {
            const index = this.sheets.indexOf(this.activeSheet);
            this.sheets.splice(index, 1);
            this.sheets.splice(position - 1, 0, this.activeSheet);
        }
    };
    const createdTriggers = [];
    const openedSpreadsheetIds = [];
    const cache = new Map();
    const context = {
        SpreadsheetApp: {
            ProtectionType: { RANGE: 'RANGE' },
            getActiveSpreadsheet: () => {
                if (spreadsheetId) throw new Error('Standalone staging script must open its configured sheet.');
                return workbook;
            },
            openById: id => { openedSpreadsheetIds.push(id); return workbook; }
        },
        LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
        CacheService: { getScriptCache: () => ({
            get: key => cache.get(key) ?? null,
            getAll: keys => Object.fromEntries(keys.filter(key => cache.has(key)).map(key => [key, cache.get(key)])),
            putAll: entries => Object.entries(entries).forEach(([key, value]) => cache.set(key, value)),
            removeAll: keys => keys.forEach(key => cache.delete(key))
        }) },
        ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
        PropertiesService: { getScriptProperties: () => ({ getProperty: name =>
            name === 'API_KEY' ? apiKey : name === 'SPREADSHEET_ID' ? spreadsheetId : null }) },
        Utilities: { formatDate: (date, timezone, pattern) => {
            assert.equal(timezone, 'Europe/Istanbul');
            const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(date);
            const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
            if (pattern === 'dd.MM.yyyy') return `${fields.day}.${fields.month}.${fields.year}`;
            if (pattern === 'dd.MM.yyyy HH:mm:ss') return `${fields.day}.${fields.month}.${fields.year} 08:00:00`;
            if (pattern === 'u') return String(new Date(`${fields.year}-${fields.month}-${fields.day}T12:00:00Z`).getUTCDay() || 7);
            throw new Error(`Unexpected format ${pattern}`);
        } },
        Session: { getScriptTimeZone: () => 'Europe/Istanbul' },
        ScriptApp: {
            WeekDay: { MONDAY: 'MONDAY', TUESDAY: 'TUESDAY', WEDNESDAY: 'WEDNESDAY', THURSDAY: 'THURSDAY', FRIDAY: 'FRIDAY' },
            getProjectTriggers: () => triggers,
            deleteTrigger: trigger => { trigger.deleted = true; },
            newTrigger: handler => ({
                timeBased() {
                    const trigger = { handlerFunction: handler, weekdays: [], getHandlerFunction() { return this.handlerFunction; } };
                    const builder = {
                        atHour(hour) { trigger.hour = hour; return builder; },
                        nearMinute(minute) { trigger.minute = minute; return builder; },
                        inTimezone(timezone) { trigger.timezone = timezone; return builder; },
                        everyWeeks(count) { trigger.weeks = count; return builder; },
                        onWeekDay(day) { trigger.weekdays.push(day); return builder; },
                        create() { createdTriggers.push(trigger); return trigger; }
                    };
                    return builder;
                }
            })
        },
        Logger: { log() {} },
        console,
        Date: class extends Date {
            constructor(value) { super(value === undefined ? now : value); }
            static now() { return now.getTime(); }
        }
    };
    vm.createContext(context);
    return readFile(resolve(testDirectory, '../apps_script.txt'), 'utf8')
        .then(source => {
            vm.runInContext(source, context);
            return { context, workbook, createdTriggers, openedSpreadsheetIds };
        });
}

test('daily residence sheet uses Istanbul date, exact headers, and remains idempotent', async () => {
    const oldSheet = createSheet('02.11.2026', [['legacy header'], ['keep this']]);
    const { context, workbook } = await loadScript({ sheets: [oldSheet], now: new Date('2026-11-03T05:00:00Z') });

    const sheet = context.ensureDailyResidenceSheet_(new Date('2026-11-03T05:00:00Z'));
    const again = context.ensureDailyResidenceSheet_(new Date('2026-11-03T10:00:00Z'));

    assert.equal(sheet, again);
    assert.equal(sheet.getName(), '03.11.2026');
    assert.deepEqual(Array.from(sheet.values[0]), ['AD SOYAD', 'PASAPORT', 'YÖKSİS DURUMU']);
    assert.equal(sheet.headerBackground, '#d9eaf7');
    assert.deepEqual(Array.from(oldSheet.values[0]), ['legacy header']);
    assert.equal(workbook.sheets.at(-1), sheet);
});

test('staging standalone script opens its configured existing spreadsheet by ID', async () => {
    const { context, workbook, openedSpreadsheetIds } = await loadScript({ spreadsheetId: 'existing-sheet-id' });
    const result = JSON.parse(context.doPost({ postData: { contents: JSON.stringify({
        action: 'residenceAdd', key: 'test-api-key', applicationId: 'app-123', recordKey: 'app-123',
        firstName: 'Ada', lastName: 'Lovelace', passportNumber: '0012345'
    }) } }).text);

    assert.equal(result.success, true);
    assert.equal(openedSpreadsheetIds.length, 1);
    assert.ok(openedSpreadsheetIds.every(id => id === 'existing-sheet-id'));
    assert.deepEqual(workbook.getSheetByName('03.11.2026').values[1], ['Ada Lovelace', '0012345', 'Yüklendi', 'app-123']);
});

test('residence add writes to the Istanbul calendar day of the application last update', async () => {
    const { context, workbook } = await loadScript({ now: new Date('2026-11-04T10:00:00Z') });
    const result = JSON.parse(context.doPost({ postData: { contents: JSON.stringify({
        action: 'residenceAdd', key: 'test-api-key', applicationId: 'app-123', recordKey: 'app-123',
        firstName: 'Ada', lastName: 'Lovelace', passportNumber: '0012345', submittedAt: '2026-11-03T08:26:00.000Z'
    }) } }).text);

    assert.deepEqual(result, { success: true, state: 'present', sheetName: '03.11.2026', recordKey: 'app-123' });
    assert.equal(workbook.getSheetByName('04.11.2026'), null);
    assert.deepEqual(Array.from(workbook.getSheetByName('03.11.2026').values[1]), ['Ada Lovelace', '0012345', 'Yüklendi', 'app-123']);
});

test('residence add adopts an existing daily sheet with exact headers and preserves its rows', async () => {
    const existing = createSheet('03.11.2026', [
        ['AD SOYAD', 'PASAPORT', 'YÖKSİS DURUMU'],
        ['Existing Student', 'P-123', 'Yüklendi']
    ]);
    const { context, workbook } = await loadScript({ sheets: [existing], now: new Date('2026-11-04T10:00:00Z') });
    const result = JSON.parse(context.doPost({ postData: { contents: JSON.stringify({
        action: 'residenceAdd', key: 'test-api-key', applicationId: 'app-123', recordKey: 'app-123',
        firstName: 'Ada', lastName: 'Lovelace', passportNumber: '0012345', submittedAt: '2026-11-03T08:26:00.000Z'
    }) } }).text);

    assert.deepEqual(result, { success: true, state: 'present', sheetName: '03.11.2026', recordKey: 'app-123' });
    assert.equal(workbook.getSheetByName('03.11.2026'), existing);
    assert.deepEqual(Array.from(existing.values[1]), ['Existing Student', 'P-123', 'Yüklendi']);
    assert.deepEqual(Array.from(existing.values[2]), ['Ada Lovelace', '0012345', 'Yüklendi', 'app-123']);
    assert.equal(existing.metadata.get('residence-sheet-schema'), 'daily-residence-v1');
});

test('residence add keeps an existing dated legacy sheet unchanged when headers differ', async () => {
    const legacy = createSheet('03.11.2026', [['AD SOYAD', 'NO', 'TEBLIGAT']]);
    const { context } = await loadScript({ sheets: [legacy], now: new Date('2026-11-04T10:00:00Z') });
    const result = JSON.parse(context.doPost({ postData: { contents: JSON.stringify({
        action: 'residenceAdd', key: 'test-api-key', applicationId: 'app-123', recordKey: 'app-123',
        firstName: 'Ada', lastName: 'Lovelace', passportNumber: '0012345', submittedAt: '2026-11-03T08:26:00.000Z'
    }) } }).text);

    assert.deepEqual(result, { success: false, error: 'Ikamet kaydi eklenemedi.' });
    assert.deepEqual(Array.from(legacy.values[0]), ['AD SOYAD', 'NO', 'TEBLIGAT']);
    assert.equal(legacy.metadata.has('residence-sheet-schema'), false);
});

test('automatic creation skips Istanbul weekends and handles year changes', async () => {
    const saturday = await loadScript({ now: new Date('2026-11-06T21:30:00Z') });
    const weekendResult = saturday.context.otomatikGunlukIkametSayfasiOlustur();
    assert.equal(weekendResult.success, false);
    assert.equal(saturday.workbook.sheets.length, 0);

    const yearEnd = await loadScript({ now: new Date('2026-12-31T21:30:00Z') });
    const result = yearEnd.context.otomatikGunlukIkametSayfasiOlustur();
    assert.equal(result.sayfa, '01.01.2027');
});

test('trigger installer replaces only the weekly sheet trigger with five weekday 08:00 triggers', async () => {
    const weekly = { handlerFunction: 'otomatikHaftalikSayfaOlustur', getHandlerFunction() { return this.handlerFunction; } };
    const unrelated = { handlerFunction: 'otherScheduledTask', getHandlerFunction() { return this.handlerFunction; } };
    const { context, createdTriggers } = await loadScript({ triggers: [weekly, unrelated] });

    context.kurGunlukIkametSayfasiTetikleyicisi();

    assert.equal(weekly.deleted, true);
    assert.equal(unrelated.deleted, undefined);
    assert.equal(createdTriggers.length, 5);
    assert.ok(createdTriggers.every(trigger => trigger.hour === 8 && trigger.timezone === 'Europe/Istanbul'));
    assert.deepEqual(createdTriggers.map(trigger => trigger.weekdays[0]), ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']);
});

test('residence add and remove use the stable record key and return confirmed state', async () => {
    const { context, workbook } = await loadScript({ now: new Date('2026-11-03T05:00:00Z') });
    const post = action => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ key: 'test-api-key', ...action }) } }).text);
    const addPayload = {
        action: 'residenceAdd', applicationId: 'app-123', recordKey: 'app-123',
        firstName: 'Ada', lastName: 'Lovelace', passportNumber: '0012345'
    };

    const added = post(addPayload);
    const repeated = post(addPayload);
    const sheet = workbook.getSheetByName('03.11.2026');
    assert.deepEqual(added, { success: true, state: 'present', sheetName: '03.11.2026', recordKey: 'app-123' });
    assert.deepEqual(repeated, added);
    assert.deepEqual(sheet.values[1], ['Ada Lovelace', '0012345', 'Yüklendi', 'app-123']);
    assert.deepEqual(sheet.autoResizeRange, [1, 3]);
    assert.equal(sheet.getProtections().length, 1);
    assert.deepEqual(post({ action: 'residenceRemove', applicationId: 'app-123', recordKey: 'app-123' }),
        { success: true, state: 'absent', recordKey: 'app-123' });
    assert.deepEqual(post({ action: 'residenceRemove', applicationId: 'app-123', recordKey: 'app-123' }),
        { success: true, state: 'absent', recordKey: 'app-123' });
});

test('first residence add checks only today while an ambiguous retry searches historical daily sheets', async () => {
    const archivedDay = createSheet('02.11.2026', [
        ['AD SOYAD', 'PASAPORT', 'YÖKSİS DURUMU', 'KAYIT_ANAHTARI'],
        ['Other Student', '0099', 'Yüklendi', 'other-app']
    ]);
    archivedDay.addDeveloperMetadata('residence-sheet-schema', 'daily-residence-v1');
    const { context, workbook } = await loadScript({ sheets: [archivedDay] });
    const post = action => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ key: 'test-api-key', ...action }) } }).text);
    const base = {
        action: 'residenceAdd', applicationId: 'app-123', recordKey: 'app-123',
        firstName: 'Ada', lastName: 'Lovelace', passportNumber: '0012345'
    };

    assert.equal(post({ ...base, verifyExisting: 'false' }).success, true);
    assert.equal(archivedDay.rangeReads, 0);
    assert.deepEqual(workbook.getSheetByName('03.11.2026').values[1], ['Ada Lovelace', '0012345', 'Yüklendi', 'app-123']);

    const retry = post({ ...base, verifyExisting: 'true' });
    assert.deepEqual(retry, { success: true, state: 'present', sheetName: '03.11.2026', recordKey: 'app-123' });
    assert.equal(workbook.getSheetByName('03.11.2026').getLastRow(), 2);
    assert.ok(archivedDay.rangeReads > 0);
});

test('residence add repairs a missing key-column protection when its header already exists', async () => {
    const sheet = createSheet('03.11.2026', [['AD SOYAD', 'PASAPORT', 'YÖKSİS DURUMU', 'KAYIT_ANAHTARI']]);
    sheet.addDeveloperMetadata('residence-sheet-schema', 'daily-residence-v1');
    const { context } = await loadScript({ sheets: [sheet] });
    const result = JSON.parse(context.doPost({ postData: { contents: JSON.stringify({
        action: 'residenceAdd', key: 'test-api-key', applicationId: 'app-123', recordKey: 'app-123',
        firstName: 'Ada', lastName: 'Lovelace', passportNumber: '0012345'
    }) } }).text);

    assert.equal(result.success, true);
    assert.equal(sheet.getProtections().length, 1);
});

test('residence actions fail closed without a configured script key and escape formula text', async () => {
    const closed = await loadScript({ apiKey: null });
    const denied = JSON.parse(closed.context.doPost({ postData: { contents: JSON.stringify({
        action: 'residenceAdd', key: 'GIZLI_SIFRE_123', applicationId: 'app-123', recordKey: 'app-123',
        firstName: 'Ada', lastName: 'Lovelace', passportNumber: '001'
    }) } }).text);
    assert.equal(denied.success, false);
    assert.equal(closed.workbook.sheets.length, 0);

    const configured = await loadScript();
    const added = JSON.parse(configured.context.doPost({ postData: { contents: JSON.stringify({
        action: 'residenceAdd', key: 'test-api-key', applicationId: 'app-123', recordKey: 'app-123',
        firstName: '=1+1', lastName: 'Lovelace', passportNumber: '001'
    }) } }).text);
    assert.equal(added.success, true);
    assert.equal(configured.workbook.getSheetByName(added.sheetName).values[1][0], "'=1+1 Lovelace");
});

test('remove finds a stable key in its original sheet after the current day changes', async () => {
    const archivedDay = createSheet('02.11.2026', [
        ['AD SOYAD', 'PASAPORT', 'YÖKSİS DURUMU', 'KAYIT_ANAHTARI'],
        ['Ada Lovelace', '0012345', 'Yüklendi', 'app-123']
    ]);
    archivedDay.addDeveloperMetadata('residence-sheet-schema', 'daily-residence-v1');
    const { context, workbook } = await loadScript({ sheets: [archivedDay], now: new Date('2026-11-03T05:00:00Z') });
    const removed = JSON.parse(context.doPost({ postData: { contents: JSON.stringify({
        action: 'residenceRemove', key: 'test-api-key', applicationId: 'app-123', recordKey: 'app-123'
    }) } }).text);

    assert.deepEqual(removed, { success: true, state: 'absent', recordKey: 'app-123' });
    assert.equal(workbook.getSheetByName('02.11.2026').values.length, 1);
    assert.equal(workbook.getSheetByName('03.11.2026'), null);
});

test('residence removal uses the stored daily sheet and skips scanning other dates', async () => {
    const correctDay = createSheet('02.11.2026', [
        ['AD SOYAD', 'PASAPORT', 'YÖKSİS DURUMU', 'KAYIT_ANAHTARI'],
        ['Ada Lovelace', '0012345', 'Yüklendi', 'app-123']
    ]);
    correctDay.addDeveloperMetadata('residence-sheet-schema', 'daily-residence-v1');
    const otherDay = createSheet('01.11.2026', [
        ['AD SOYAD', 'PASAPORT', 'YÖKSİS DURUMU', 'KAYIT_ANAHTARI'],
        ['Other Student', '0099', 'Yüklendi', 'other-app']
    ]);
    otherDay.addDeveloperMetadata('residence-sheet-schema', 'daily-residence-v1');
    const { context } = await loadScript({ sheets: [otherDay, correctDay], now: new Date('2026-11-03T05:00:00Z') });

    const removed = JSON.parse(context.doPost({ postData: { contents: JSON.stringify({
        action: 'residenceRemove', key: 'test-api-key', applicationId: 'app-123', recordKey: 'app-123', sheetName: '02.11.2026'
    }) } }).text);

    assert.deepEqual(removed, { success: true, state: 'absent', recordKey: 'app-123' });
    assert.equal(correctDay.values.length, 1);
    assert.equal(correctDay.rangeReads, 1);
    assert.equal(otherDay.rangeReads, 0);
});

test('daily residence rows are excluded from legacy search and getAll results', async () => {
    const legacy = createSheet('03.11.2026', [['AD SOYAD', 'NO', 'TESLİM'], ['Ada Lovelace', 1, '']]);
    const { context } = await loadScript();
    const daily = createSheet('04.11.2026', [['AD SOYAD', 'PASAPORT', 'YÖKSİS DURUMU', 'KAYIT_ANAHTARI'], ['Ada Lovelace', '0012345', 'Yüklendi', 'app-123']]);
    daily.addDeveloperMetadata('residence-sheet-schema', 'daily-residence-v1');
    const workbook = context.SpreadsheetApp.getActiveSpreadsheet();
    workbook.sheets.push(legacy, daily);

    const search = JSON.parse(context.islemArama_('Ada', '2026').text);
    const all = JSON.parse(context.islemGetAll_({ parameter: {} }).text);
    assert.deepEqual(search.results.map(row => row.sayfa), ['03.11.2026']);
    assert.deepEqual(all.results.map(row => row.sayfa), ['03.11.2026']);
});

test('legacy delivery actions cannot mutate daily residence rows or create new teblig records', async () => {
    const { context, workbook } = await loadScript({ now: new Date('2026-11-03T05:00:00Z') });
    const post = action => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ key: 'test-api-key', ...action }) } }).text);
    const added = post({ action: 'residenceAdd', applicationId: 'app-123', recordKey: 'app-123',
        firstName: 'Ada', lastName: 'Lovelace', passportNumber: '0012345' });
    const sheet = workbook.getSheetByName(added.sheetName);

    assert.equal(post({ action: 'update', sayfa: added.sheetName, isim: 'Ada Lovelace', no: '0012345' }).success, false);
    assert.equal(post({ action: 'unmark', sayfa: added.sheetName, isim: 'Ada Lovelace', no: '0012345' }).success, false);
    assert.equal(post({ action: 'remove', sayfa: added.sheetName, isim: 'Ada Lovelace', no: '0012345' }).success, false);
    assert.equal(post({ action: 'add', sayfa: added.sheetName, isim: 'Other Student' }).success, false);
    assert.equal(sheet.values[1][2], 'Yüklendi');
    assert.equal(sheet.values.length, 2);
});

test('legacy delivery marking still updates and unmarks old-schema rows', async () => {
    const legacy = createSheet('03.11.2026', [['AD SOYAD', 'NO', 'TESLİM'], ['Ada Lovelace', '17', '']]);
    const { context } = await loadScript({ sheets: [legacy], now: new Date('2026-11-03T05:00:00Z') });
    const post = action => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ key: 'test-api-key', ...action }) } }).text);

    assert.equal(post({ action: 'update', sayfa: legacy.getName(), isim: 'Ada Lovelace', no: '17' }).success, true);
    assert.notEqual(legacy.values[1][2], '');
    assert.equal(post({ action: 'unmark', sayfa: legacy.getName(), isim: 'Ada Lovelace', no: '17' }).success, true);
    assert.equal(legacy.values[1][2], '');
});

test('twenty daily sheets do not reduce the legacy search window of sixteen sheets', async () => {
    const { context, workbook } = await loadScript();
    for (let day = 1; day <= 17; day++) {
        const name = `${String(day).padStart(2, '0')}.01.2026`;
        workbook.sheets.push(createSheet(name, [['AD SOYAD', 'NO', 'TESLİM'], ['Ada Lovelace', String(day), '']]));
    }
    for (let day = 1; day <= 20; day++) {
        const sheet = createSheet(`${String(day).padStart(2, '0')}.02.2026`, [
            ['AD SOYAD', 'PASAPORT', 'YÖKSİS DURUMU', 'KAYIT_ANAHTARI'], ['Ada Lovelace', '0012345', 'Yüklendi', `app-${day}`]
        ]);
        sheet.addDeveloperMetadata('residence-sheet-schema', 'daily-residence-v1');
        workbook.sheets.push(sheet);
    }

    const results = JSON.parse(context.islemArama_('Ada', '2026').text).results;

    assert.equal(results.length, 16);
    assert.ok(results.every(row => row.sayfa.endsWith('.01.2026')));
    assert.ok(!results.some(row => row.sayfa === '01.01.2026'));
});
