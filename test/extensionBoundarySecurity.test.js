import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(testDirectory, '../ykn_eklenti-main');
const portalSecuritySource = await readFile(resolve(extensionRoot, 'portal-security.js'), 'utf8');
const storageLifecycleSource = await readFile(resolve(extensionRoot, 'storage-lifecycle.js'), 'utf8');

function evaluateScript(source, globalName) {
    const context = vm.createContext({ URL, Date, Set, Object, Number, String, Array });
    vm.runInContext(source, context);
    return context[globalName];
}

test('extension accepts only an exact HTTPS portal origin on the authorized staff route', () => {
    const security = evaluateScript(portalSecuritySource, 'YKN_PORTAL_SECURITY');
    const patterns = ['https://portal.example.edu/*', 'http://localhost/*', 'http://127.0.0.1/*'];

    assert.equal(security.isAllowedPortalUrl('https://portal.example.edu/yetkili/', patterns), true);
    assert.equal(security.isAllowedPortalUrl('https://portal.example.edu/', patterns), false);
    assert.equal(security.isAllowedPortalUrl('https://preview-123.vercel.app/yetkili/', patterns), false);
    assert.equal(security.isAllowedPortalUrl('https://other.example.edu/yetkili/', patterns), false);
    assert.equal(security.isAllowedPortalUrl('http://localhost:5173/yetkili/', patterns), true);
    assert.equal(security.isAllowedPortalUrl('http://localhost:9000/yetkili/', patterns), false);
});

test('extension rejects unknown portal actions and malformed high-impact payloads', () => {
    const security = evaluateScript(portalSecuritySource, 'YKN_PORTAL_SECURITY');
    const validRequest = { action: 'SEARCH_STUDENT', requestId: 'request-1', passportNo: 'P123456' };

    assert.equal(security.isValidPortalMessage(validRequest), true);
    assert.equal(security.isValidPortalMessage({ ...validRequest, action: 'DELETE_STUDENT' }), false);
    assert.equal(security.isValidPortalMessage({ ...validRequest, passportNo: '' }), false);
    assert.equal(security.isValidPortalMessage({ ...validRequest, requestId: {} }), false);
    assert.equal(security.isValidPortalMessage({ action: 'SAVE_CROPPED_PHOTO', requestId: 'r1', photoBase64: '<svg onload=x>' }), false);
});

test('extension accepts only correlated YÖKSİS audit commands with a bounded scan id', () => {
    const security = evaluateScript(portalSecuritySource, 'YKN_PORTAL_SECURITY');
    const start = { action: 'START_YOKSIS_DOCUMENT_AUDIT', requestId: 'request-1', scanId: 'scan-1' };
    const stop = { action: 'STOP_YOKSIS_DOCUMENT_AUDIT', requestId: 'request-2', scanId: 'scan-1', targetTabId: 12 };

    assert.equal(security.isValidPortalMessage(start), true);
    assert.equal(security.isValidPortalMessage(stop), true);
    assert.equal(security.isValidPortalMessage({ ...start, scanId: '' }), false);
    assert.equal(security.isValidPortalMessage({ ...start, scanId: 's'.repeat(129) }), false);
    assert.equal(security.isValidPortalMessage({ ...start, entries: [
        { applicationNumber: '2026-00-0000001', studentNumber: '2600000001' }
    ] }), true);
    assert.equal(security.isValidPortalMessage({ ...start, entries: [
        { applicationNumber: 'invalid', studentNumber: '2600000001' }
    ] }), false);
    assert.equal(security.isValidPortalMessage({ ...start, entries: new Array(1001).fill({
        applicationNumber: '2026-00-0000001', studentNumber: '2600000001'
    }) }), false);
    assert.equal(security.isValidPortalMessage({ ...start, requestId: {} }), false);
    assert.equal(security.isValidPortalMessage({ ...stop, targetTabId: '12' }), false);
});

test('extension validates GöçNet reads and bounds writes to the selected tab and PDF size', () => {
    const security = evaluateScript(portalSecuritySource, 'YKN_PORTAL_SECURITY');
    const read = { action: 'CHECK_GOCNET_TRANSFER', requestId: 'request-1', applicationNumber: '2099-12-99999999' };
    const common = { requestId: 'request-1', attemptId: '3e2c0615-f60a-4f11-bb87-eccbfce1c5aa', targetTabId: 42 };
    const save = { ...common, action: 'SAVE_GOCNET_RECORD', applicationNumber: read.applicationNumber,
        studentNumber: '99000000001', passportNumber: 'P123456', firstName: 'TEST', lastName: 'STUDENT', phoneNational: '5000000000' };
    const upload = { ...common, action: 'UPLOAD_GOCNET_DOCUMENT', applicationNumber: read.applicationNumber,
        recordId: '70001', pdfSha256: 'a'.repeat(64), pdfBase64: 'JVBERg==' };
    assert.equal(security.isValidPortalMessage(read), true);
    assert.equal(security.isValidPortalMessage({ ...read, applicationNumber: 'bad' }), false);
    assert.equal(security.isValidPortalMessage(save), true);
    assert.equal(security.isValidPortalMessage({ ...save, phoneNational: '7000000000' }), true);
    assert.equal(security.isValidPortalMessage({ ...save, phoneNational: '7000001' }), true);
    assert.equal(security.isValidPortalMessage({ ...save, phoneNational: '700000' }), false);
    assert.equal(security.isValidPortalMessage({ ...save, phoneNational: '70000000001' }), false);
    assert.equal(security.isValidPortalMessage({ ...save, phoneNational: '123' }), false);
    assert.equal(security.isValidPortalMessage(upload), true);
    assert.equal(security.isValidPortalMessage({ ...upload, pdfBase64: 'x'.repeat(12_582_913) }), false);
});

test('extension audit events require the originating scan and identity-bound bounded results', () => {
    const security = evaluateScript(portalSecuritySource, 'YKN_PORTAL_SECURITY');
    const validRecord = {
        source: 'YOKSIS_DOCUMENT_AUDIT',
        action: 'YOKSIS_DOCUMENT_AUDIT_RECORD',
        requestId: 'request-1',
        scanId: 'scan-1',
        portalTabId: 12,
        data: {
            type: 'record', index: 1, total: 1,
            entry: { applicationNumber: '2026-00-0000001', studentNumber: '2600000001' },
            result: {
                status: 'verified',
                identity: { applicationNumber: '2026-00-0000001', studentNumber: '2600000001', firstName: 'TEST', lastName: 'STUDENT', phone: '5000000000' },
                applicationStatus: 'Eksik Belge Bekliyor',
                documents: [{ code: '99', name: 'Diğer Belge', required: true, note: 'Aktif öğrenci belgesi', uploadStatus: 'Yüklenmedi' }]
            }
        }
    };

    assert.equal(security.isValidYoksisAuditEvent(validRecord), true);
    assert.equal(security.isValidYoksisAuditEvent({
        ...validRecord,
        data: { ...validRecord.data, result: { ...validRecord.data.result,
            identity: { ...validRecord.data.result.identity, passportNumber: 'U12345678' } } }
    }), true);
    assert.equal(security.isValidYoksisAuditEvent({
        ...validRecord,
        data: { ...validRecord.data, result: { ...validRecord.data.result,
            identity: { ...validRecord.data.result.identity, passportNumber: 'P'.repeat(65) } } }
    }), false);
    assert.equal(security.isValidYoksisAuditEvent({ ...validRecord, portalTabId: -1 }), false);
    assert.equal(security.isValidYoksisAuditEvent({ ...validRecord, data: { ...validRecord.data, entry: { ...validRecord.data.entry, studentNumber: 'wrong' } } }), false);
    assert.equal(security.isValidYoksisAuditEvent({ ...validRecord, data: { ...validRecord.data, result: { ...validRecord.data.result, identity: { ...validRecord.data.result.identity, applicationNumber: '2026-00-0000002' } } } }), false);
});

test('extension accepts Apply events only from the Apply applications origin', () => {
    const security = evaluateScript(portalSecuritySource, 'YKN_PORTAL_SECURITY');

    assert.equal(security.isAllowedApplySender('https://apply.topkapi.edu.tr/panel/applications/1'), true);
    assert.equal(security.isAllowedApplySender('https://untrusted.topkapi.edu.tr/panel/applications/1'), false);
    assert.equal(security.isAllowedApplySender('https://apply.topkapi.edu.tr.evil.test/panel/applications/1'), false);
});

test('temporary student data cleanup retains fresh data and expires data after the configured TTL', () => {
    const lifecycle = evaluateScript(storageLifecycleSource, 'YKN_TEMPORARY_STORAGE');
    const now = 2_000_000_000;
    const recent = lifecycle.getCleanupPlan({ studentData: { passportNo: 'P123456' }, temporaryStudentDataSavedAt: now - 1 }, now);
    const expired = lifecycle.getCleanupPlan({ studentData: { passportNo: 'P123456' }, temporaryStudentDataSavedAt: now - lifecycle.TTL_MS }, now);
    const legacy = lifecycle.getCleanupPlan({ studentData: { passportNo: 'P123456' } }, now);

    assert.deepEqual(Array.from(recent.removeKeys), []);
    assert.equal(recent.timestampToSet, null);
    assert.deepEqual(Array.from(expired.removeKeys), ['studentData', 'pendingPassportCrop', 'croppedPhotoBase64', 'temporaryStudentDataSavedAt']);
    assert.equal(expired.timestampToSet, null);
    assert.equal(legacy.timestampToSet, now);
    assert.deepEqual(Array.from(legacy.removeKeys), []);
});

test('extension manifest and bridge contain no broad preview or university-subdomain permissions', async () => {
    const manifest = JSON.parse(await readFile(resolve(extensionRoot, 'manifest.json'), 'utf8'));
    const bridge = await readFile(resolve(extensionRoot, 'bridge.js'), 'utf8');
    const manifestText = JSON.stringify(manifest);

    assert.doesNotMatch(manifestText, /\*\.vercel\.app|\*\.topkapi\.edu\.tr/);
    assert.match(bridge, /event\.origin\s*!==\s*window\.location\.origin/);
    assert.match(bridge, /\/yetkili/);
});

test('passport OCR uses the staff session cookie and accepts requests only from Apply', async () => {
    const bridge = await readFile(resolve(extensionRoot, 'bridge.js'), 'utf8');
    const background = await readFile(resolve(extensionRoot, 'background.js'), 'utf8');

    assert.match(bridge, /credentials:\s*'same-origin'/);
    assert.doesNotMatch(bridge, /localStorage\.getItem|sessionStorage\.getItem/);
    assert.match(background, /isAllowedApplyUrl\(sender\?\.tab\?\.url/);
    assert.match(background, /imageBase64\.length\s*<=\s*15_000_000/);
});

test('extension background validates setGocnetPhone commands for 7 to 10 digits only', async () => {
    const backgroundSource = await readFile(resolve(extensionRoot, 'background.js'), 'utf8');
    const messageListeners = [];
    const executedCommands = [];
    const context = vm.createContext({
        URL, Date, Set, Map, Object, Number, String, Array, Promise, console,
        setTimeout, clearTimeout, setInterval, clearInterval,
        chrome: {
            runtime: {
                onStartup: { addListener() {} },
                onInstalled: { addListener() {} },
                onMessage: { addListener(listener) { messageListeners.push(listener); } },
                getManifest: () => ({ content_scripts: [] })
            },
            tabs: { onUpdated: { addListener() {} } },
            scripting: {
                async executeScript(injection) {
                    if (injection.args) {
                        executedCommands.push(injection.args[0]);
                        return [{ result: { success: true, verified: true } }];
                    }
                    return [];
                }
            }
        }
    });
    context.globalThis = context;
    vm.runInContext(portalSecuritySource, context);
    vm.runInContext(storageLifecycleSource, context);
    vm.runInContext(backgroundSource, context);
    const listener = messageListeners[0];
    assert.equal(typeof listener, 'function');

    const sender = { tab: { id: 10, url: 'https://yoksis.yok.gov.tr/menu/menu.zul' }, frameId: 0 };
    const dispatch = (phoneNational) => new Promise((resolveResponse) => {
        let settled = false;
        let response;
        let returned = false;
        const asyncKeepOpen = listener(
            { action: 'YOKSIS_ZK_COMMAND', command: { action: 'setGocnetPhone', phoneNational, requestId: 'phone-req-1' } },
            sender,
            (value) => {
                settled = true;
                response = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
                if (returned) resolveResponse({ asyncKeepOpen, response });
            }
        );
        returned = true;
        if (settled || !asyncKeepOpen) resolveResponse({ asyncKeepOpen, response });
    });

    const valid = await dispatch('7000000000');
    assert.equal(valid.asyncKeepOpen, true);
    assert.deepEqual(valid.response, { success: true, verified: true });
    assert.equal(executedCommands.length, 1);

    const shortReject = await dispatch('700000');
    assert.equal(shortReject.asyncKeepOpen, false);
    assert.equal(shortReject.response.success, false);

    const longReject = await dispatch('70000000001');
    assert.equal(longReject.asyncKeepOpen, false);
    assert.equal(longReject.response.success, false);
    assert.equal(executedCommands.length, 1);
});
