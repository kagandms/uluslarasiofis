import assert from 'node:assert/strict';
import test from 'node:test';
import { TOPI_STATES } from '../src/public/topiMascot.js';
import {
    STAFF_ASSISTANT_MAX_COPIES,
    STAFF_ASSISTANT_PEOPLE,
    STAFF_ASSISTANT_STATES,
    STAFF_ASSISTANT_VIEWS,
    validateStaffAssistantAction,
    validateStaffAssistantRequest,
    validateStaffAssistantResponse
} from '../src/shared/staff-assistant-contract.js';

function makeApplicationItem(index = 1) {
    return {
        id: `app-${index}`,
        referenceNumber: `2026-000${index}`,
        studentNumber: `2026000000${index}`,
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        passportNumber: `P12345${index}`,
        status: 'submitted',
        submittedAt: '2026-11-23T10:00:00.000Z'
    };
}

function makeYoksisAuditItem(index = 1) {
    return {
        applicationNumber: `2026-01-000000${index}`,
        studentNumber: `2026000000${index}`,
        fullName: 'Mehmet Demir',
        applicationStatus: 'Eksik Belge İstendi',
        statusCategory: 'missing_documents',
        missingDocuments: [
            { name: 'Pasaport', required: true, note: 'Ön yüz net değil' }
        ],
        missingDeadline: '2026-12-01',
        unit: 'Mühendislik',
        scannedAt: '2026-11-23T09:00:00.000Z',
        isStale: false
    };
}

function makeTebligatItem(index = 1) {
    return {
        name: `Ahmet Yılmaz ${index}`,
        sheet: '24.11.2026',
        number: String(index),
        date: '24.11.2026',
        marked: index % 2 === 1
    };
}

test('contract constants are frozen and match expected values', () => {
    assert.equal(Object.isFrozen(STAFF_ASSISTANT_VIEWS), true);
    assert.equal(Object.isFrozen(STAFF_ASSISTANT_PEOPLE), true);
    assert.equal(Object.isFrozen(STAFF_ASSISTANT_STATES), true);
    assert.equal(STAFF_ASSISTANT_MAX_COPIES, 50);

    assert.deepEqual(STAFF_ASSISTANT_STATES, TOPI_STATES);
    assert.deepEqual(STAFF_ASSISTANT_VIEWS, [
        'applications',
        'cover',
        'documents',
        'inquiries',
        'physical',
        'print',
        'teblig',
        'work-hours',
        'ykn',
        'yoksis-audit'
    ]);
    assert.deepEqual(STAFF_ASSISTANT_PEOPLE, [
        'kagan_samet',
        'asaf',
        'eyup',
        'oguz',
        'eray'
    ]);
});

test('validateStaffAssistantRequest accepts valid requests and trims message', () => {
    const minimal = validateStaffAssistantRequest({ message: '  Merhaba Topi  ' });
    assert.deepEqual(minimal, { message: 'Merhaba Topi', history: [] });

    const withHistory = validateStaffAssistantRequest({
        message: '10 tane taksit dilekçesi çıkar',
        history: [
            { role: 'user', content: 'Merhaba' },
            { role: 'assistant', content: 'Merhaba, nasıl yardımcı olabilirim?' }
        ]
    });
    assert.equal(withHistory.message, '10 tane taksit dilekçesi çıkar');
    assert.equal(withHistory.history.length, 2);
});

test('validateStaffAssistantRequest rejects invalid payloads and unknown keys', () => {
    const maxHistory = Array.from({ length: 7 }, () => ({ role: 'user', content: 'selam' }));
    const invalidPayloads = [
        null,
        undefined,
        'merhaba',
        [],
        {},
        { message: '' },
        { message: '   ' },
        { message: 'a'.repeat(301) },
        { message: 'ok', extra: true },
        { message: 'ok', history: null },
        { message: 'ok', history: 'bad' },
        { message: 'ok', history: maxHistory },
        { message: 'ok', history: [{ role: 'system', content: 'hi' }] },
        { message: 'ok', history: [{ role: 'user', content: 123 }] },
        { message: 'ok', history: [{ role: 'user', content: 'x'.repeat(301) }] },
        { message: 'ok', history: [{ role: 'user', content: 'hi', extra: 1 }] }
    ];

    for (const payload of invalidPayloads) {
        assert.throws(() => validateStaffAssistantRequest(payload), { message: 'invalid-request' });
    }
});

test('validateStaffAssistantAction accepts every valid action type', () => {
    assert.deepEqual(
        validateStaffAssistantAction({ type: 'navigate', view: 'yoksis-audit' }),
        { type: 'navigate', view: 'yoksis-audit' }
    );
    assert.deepEqual(
        validateStaffAssistantAction({ type: 'ykn.run', passportNo: 'AB123456' }),
        { type: 'ykn.run', passportNo: 'AB123456' }
    );
    assert.deepEqual(
        validateStaffAssistantAction({ type: 'documents.print', documentId: 'taksitlendirme-dilekcesi', copies: 1 }),
        { type: 'documents.print', documentId: 'taksitlendirme-dilekcesi', copies: 1 }
    );
    assert.deepEqual(
        validateStaffAssistantAction({ type: 'documents.print', documentId: 'taksitlendirme-dilekcesi', copies: 50 }),
        { type: 'documents.print', documentId: 'taksitlendirme-dilekcesi', copies: 50 }
    );
    assert.deepEqual(
        validateStaffAssistantAction({
            type: 'workHours.propose',
            person: 'kagan_samet',
            minutes: 390,
            label: '6,5 saat · Kağan Samet · bugün'
        }),
        {
            type: 'workHours.propose',
            person: 'kagan_samet',
            minutes: 390,
            label: '6,5 saat · Kağan Samet · bugün'
        }
    );
    assert.deepEqual(
        validateStaffAssistantAction({ type: 'tebligat.search', query: '  Ahmet  ' }),
        { type: 'tebligat.search', query: 'Ahmet' }
    );
});

test('validateStaffAssistantAction rejects out-of-range, invalid, and unknown-key actions', () => {
    const invalidActions = [
        null,
        {},
        { type: 'unknown' },
        { type: 'navigate', view: 'admin' },
        { type: 'navigate', view: 'archive' },
        { type: 'navigate', view: 'applications', extra: 1 },
        { type: 'ykn.run', passportNo: 'a b' },
        { type: 'ykn.run', passportNo: 'ab1234' },
        { type: 'ykn.run', passportNo: 'ABCD' },
        { type: 'ykn.run', passportNo: 'A'.repeat(21) },
        { type: 'ykn.run', passportNo: 'AB123456', extra: true },
        { type: 'documents.print', documentId: 'taksitlendirme-dilekcesi', copies: 51 },
        { type: 'documents.print', documentId: 'taksitlendirme-dilekcesi', copies: 0 },
        { type: 'documents.print', documentId: 'taksitlendirme-dilekcesi', copies: 1.5 },
        { type: 'documents.print', documentId: 'INVALID_ID', copies: 1 },
        { type: 'documents.print', documentId: 'taksitlendirme-dilekcesi', copies: 2, extra: 1 },
        { type: 'workHours.propose', person: 'ali', minutes: 60, label: '1 saat' },
        { type: 'workHours.propose', person: 'asaf', minutes: 45, label: '45 dk' },
        { type: 'workHours.propose', person: 'asaf', minutes: 1500, label: '25 saat' },
        { type: 'workHours.propose', person: 'asaf', minutes: -30, label: 'negatif' },
        { type: 'workHours.propose', person: 'asaf', minutes: 60, label: '   ' },
        { type: 'workHours.propose', person: 'asaf', minutes: 60, label: '1 saat', extra: 'x' },
        { type: 'tebligat.search', query: 'a' },
        { type: 'tebligat.search', query: 'a'.repeat(81) },
        { type: 'tebligat.search', query: 'Ahmet', extra: 1 }
    ];

    for (const action of invalidActions) {
        assert.throws(() => validateStaffAssistantAction(action), { message: 'invalid-action' });
    }
});

test('validateStaffAssistantResponse accepts valid responses with action and results', () => {
    const basic = validateStaffAssistantResponse({
        reply: 'Merhaba, nasıl yardımcı olabilirim?',
        state: 'hello'
    });
    assert.deepEqual(basic, { reply: 'Merhaba, nasıl yardımcı olabilirim?', state: 'hello' });

    const withApplications = validateStaffAssistantResponse({
        reply: '5 başvuru bulundu.',
        state: 'understood',
        action: { type: 'navigate', view: 'applications' },
        results: {
            kind: 'applications',
            total: 12,
            items: [1, 2, 3, 4, 5].map(makeApplicationItem)
        }
    });
    assert.equal(withApplications.results.items.length, 5);
    assert.equal(withApplications.action.type, 'navigate');

    const withYoksis = validateStaffAssistantResponse({
        reply: 'YÖKSİS eksik evrak kaydı bulundu.',
        state: 'checking',
        results: {
            kind: 'yoksisAudit',
            total: 1,
            lastImportAt: null,
            items: [makeYoksisAuditItem(1)]
        }
    });
    assert.equal(withYoksis.results.kind, 'yoksisAudit');
    assert.equal(withYoksis.results.items[0].missingDocuments.length, 1);

    const withTebligat = validateStaffAssistantResponse({
        reply: '"Ahmet" için 2026 yılında 7 kayıt buldum; ilk 5\'ini gösteriyorum; adı ve soyadıyla daraltın.',
        state: 'understood',
        results: {
            kind: 'tebligat',
            total: 7,
            truncated: true,
            items: [1, 2, 3, 4, 5].map((i) => ({ ...makeTebligatItem(i), date: i === 1 ? null : '24.11.2026' }))
        }
    });
    assert.equal(withTebligat.results.kind, 'tebligat');
    assert.equal(withTebligat.results.truncated, true);
    assert.equal(withTebligat.results.items.length, 5);
});

test('validateStaffAssistantResponse rejects unknown state, >5 items, and extra keys at every level', () => {
    const sixApps = [1, 2, 3, 4, 5, 6].map(makeApplicationItem);
    const sixYoksis = [1, 2, 3, 4, 5, 6].map(makeYoksisAuditItem);
    const sixTebligat = [1, 2, 3, 4, 5, 6].map(makeTebligatItem);

    const invalidResponses = [
        null,
        {},
        { reply: '   ', state: 'idle' },
        { reply: 'Merhaba', state: 'unknown_state' },
        { reply: 'Merhaba', state: 'idle', extra: 1 },
        { reply: 'Merhaba', state: 'idle', action: { type: 'navigate', view: 'admin' } },
        {
            reply: 'Sonuçlar',
            state: 'understood',
            results: { kind: 'other', total: 0, items: [] }
        },
        {
            reply: 'Başvurular',
            state: 'understood',
            results: { kind: 'applications', total: 6, items: sixApps }
        },
        {
            reply: 'Başvurular',
            state: 'understood',
            results: { kind: 'applications', total: 1, items: [makeApplicationItem(1)], extra: true }
        },
        {
            reply: 'Başvurular',
            state: 'understood',
            results: {
                kind: 'applications',
                total: 1,
                items: [{ ...makeApplicationItem(1), extra: 'nope' }]
            }
        },
        {
            reply: 'YÖKSİS',
            state: 'checking',
            results: { kind: 'yoksisAudit', total: 6, lastImportAt: null, items: sixYoksis }
        },
        {
            reply: 'YÖKSİS',
            state: 'checking',
            results: {
                kind: 'yoksisAudit',
                total: 1,
                lastImportAt: null,
                items: [makeYoksisAuditItem(1)],
                extra: 1
            }
        },
        {
            reply: 'YÖKSİS',
            state: 'checking',
            results: {
                kind: 'yoksisAudit',
                total: 1,
                lastImportAt: null,
                items: [{ ...makeYoksisAuditItem(1), extra: 1 }]
            }
        },
        {
            reply: 'YÖKSİS',
            state: 'checking',
            results: {
                kind: 'yoksisAudit',
                total: 1,
                lastImportAt: null,
                items: [{
                    ...makeYoksisAuditItem(1),
                    missingDocuments: [{ name: 'Pasaport', required: true, note: '', extra: 1 }]
                }]
            }
        },
        {
            reply: 'Tebligat',
            state: 'understood',
            results: { kind: 'tebligat', total: 6, truncated: true, items: sixTebligat }
        },
        {
            reply: 'Tebligat',
            state: 'understood',
            results: {
                kind: 'tebligat',
                total: 1,
                truncated: false,
                items: [makeTebligatItem(1)],
                extra: 1
            }
        },
        {
            reply: 'Tebligat',
            state: 'understood',
            results: {
                kind: 'tebligat',
                total: 1,
                truncated: false,
                items: [{ ...makeTebligatItem(1), rawId: 'secret' }]
            }
        },
        {
            reply: 'Tebligat',
            state: 'understood',
            results: {
                kind: 'tebligat',
                total: 1,
                truncated: 'yes',
                items: [makeTebligatItem(1)]
            }
        },
        {
            reply: 'Tebligat',
            state: 'understood',
            results: {
                kind: 'tebligat',
                total: 1,
                truncated: false,
                items: [{ ...makeTebligatItem(1), marked: 'true' }]
            }
        }
    ];

    for (const response of invalidResponses) {
        assert.throws(() => validateStaffAssistantResponse(response), { message: 'invalid-response' });
    }
});
