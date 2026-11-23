import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    INQUIRY_STATUSES,
    createInquiryDto,
    validateInquiryInput
} from '../src/server/domain/officeInquiry.js';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createRepositories() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return { database, repositories: createD1Repositories(database) };
}

function seedStaffUser(database, { id = 'staff-1', username = 'reviewer-1', displayName = 'Ayşe Görevli', role = 'reviewer' } = {}) {
    database.prepare(`
        INSERT OR IGNORE INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, 'test-hash', ?, ?)
    `).bind(id, username, username.toLowerCase(), displayName, role).run();
}

function validInput(overrides = {}) {
    return {
        first_name: 'Mert',
        last_name: 'Kaya',
        phone: '0090 505 123 45 67',
        email: 'mert@example.edu',
        message: 'Öğrenci belgesi hakkında sorum var.',
        language: 'tr',
        website: '',
        ...overrides
    };
}

test('validateInquiryInput canonicalizes phones to E.164, accepts missing email, and validates international formats', () => {
    assert.deepEqual(INQUIRY_STATUSES, ['new', 'answered']);

    const normalizedFromZeroPrefix = validateInquiryInput(validInput({
        phone: '  \u200b0090 505 123 45 67\u200e  ',
        email: undefined,
        website: undefined
    }));
    assert.equal(normalizedFromZeroPrefix.phone, '+905051234567');
    assert.equal(normalizedFromZeroPrefix.email, null);

    const nullEmail = validateInquiryInput(validInput({ email: null }));
    assert.equal(nullEmail.email, null);

    const emptyEmail = validateInquiryInput(validInput({ email: '' }));
    assert.equal(emptyEmail.email, null);

    for (const phone of [
        '+90 505 123 45 67',
        '+905051234567',
        '+90-505-123-4567',
        '0090 505 123 45 67',
        '0505 123 45 67'
    ]) {
        const result = validateInquiryInput(validInput({ phone }));
        assert.equal(result.phone, '+905051234567');
    }

    for (const [phone, expectedE164] of [
        ['+90 555 111 22 33', '+905551112233'],
        ['+993 65 12 34 56', '+99365123456'],
        ['+7 912 345 67 89', '+79123456789'],
        ['+966 50 123 4567', '+966501234567']
    ]) {
        const result = validateInquiryInput(validInput({ phone }));
        assert.equal(result.phone, expectedE164);
    }

    const crlfMessage = validateInquiryInput(validInput({ message: '  Satır 1\r\nSatır 2  ' }));
    assert.equal(crlfMessage.message, 'Satır 1\nSatır 2');

    const plusDotEmail = validateInquiryInput(validInput({ email: 'mert.kaya+basvuru@uni.edu.tr' }));
    assert.equal(plusDotEmail.email, 'mert.kaya+basvuru@uni.edu.tr');

    const multilingualCases = [
        {
            first_name: 'أحمد',
            last_name: 'محمد',
            message: 'أحتاج مساعدة بخصوص إقامة الطالب.',
            language: 'ar'
        },
        {
            first_name: 'Иван',
            last_name: 'Петров',
            message: 'Подскажите порядок подачи документов на ВНЖ.',
            language: 'ru'
        },
        {
            first_name: 'Çağrı Şükrü',
            last_name: 'Öztürk İzzet',
            message: 'Öğrenci belgesi ve ikamet izni hakkında bilgi alabilir miyim?',
            language: 'tr'
        }
    ];
    for (const item of multilingualCases) {
        const accepted = validateInquiryInput(validInput(item));
        assert.equal(accepted.first_name, item.first_name);
        assert.equal(accepted.last_name, item.last_name);
        assert.equal(accepted.message, item.message);
    }
});

test('validateInquiryInput rejects invalid phone, malformed email, short message, and bad inputs without echoing values', () => {
    const invalidCases = [
        validInput({ phone: 'abc' }),
        validInput({ phone: '123' }),
        validInput({ phone: '+90 123' }),
        validInput({ phone: '123456' }),
        validInput({ phone: '1234567' }),
        validInput({ phone: '1'.repeat(20) }),
        validInput({ phone: '1'.repeat(41) }),
        validInput({ email: 'not-an-email' }),
        validInput({ email: 'a@b' }),
        validInput({ email: 'a@b.co?cc=x@y.z' }),
        validInput({ email: 'mert@example.com/admin' }),
        validInput({ email: 'mert@example.com#frag' }),
        validInput({ email: `${'a'.repeat(250)}@b.com` }),
        validInput({ email: 'mert\u200B@example.edu' }),
        validInput({ first_name: '' }),
        validInput({ first_name: 'x'.repeat(61) }),
        validInput({ first_name: 'Mert\u202EKaya' }),
        validInput({ first_name: 'Mert\u200BKaya' }),
        validInput({ last_name: '   ' }),
        validInput({ last_name: 'Kaya\u2066Test' }),
        validInput({ message: 'abcd' }),
        validInput({ message: '   ab   ' }),
        validInput({ message: 'a'.repeat(1001) }),
        validInput({ message: 'gizli\tmesaj' }),
        validInput({ message: 'Normal metin\u202Egizli' }),
        validInput({ message: 'Normal metin\u200Bdevam' }),
        validInput({ message: 'Normal metin\uFEFFdevam' }),
        validInput({ language: 'fr' }),
        validInput({ website: 'https://spam.example' }),
        { ...validInput(), extra_field: 'unexpected' }
    ];

    for (const payload of invalidCases) {
        assert.throws(
            () => validateInquiryInput(payload),
            (error) => {
                assert.equal(error.status, 400);
                assert.equal(error.code, 'VALIDATION_ERROR');
                if (typeof payload.phone === 'string' && payload.phone.length > 0) {
                    assert.equal(error.message.includes(payload.phone), false);
                }
                if (typeof payload.email === 'string' && payload.email.length > 0) {
                    assert.equal(error.message.includes(payload.email), false);
                }
                if (typeof payload.message === 'string' && payload.message.length > 0) {
                    assert.equal(error.message.includes(payload.message), false);
                }
                return true;
            }
        );
    }
});

test('repository list returns newest first, honors status and limit, and countByStatus reports totals', async () => {
    const { database, repositories } = createRepositories();
    seedStaffUser(database, { id: 'staff-1', displayName: 'Elif Görevli' });

    await repositories.officeInquiries.create({
        id: 'inq-oldest',
        firstName: 'First',
        lastName: 'User',
        phone: '+905551112233',
        email: null,
        message: 'Birinci soru metni',
        language: 'tr',
        nowIso: '2026-11-19T08:00:00.000Z'
    });
    await repositories.officeInquiries.create({
        id: 'inq-middle',
        firstName: 'Second',
        lastName: 'User',
        phone: '+905551112234',
        email: 'second@example.edu',
        message: 'İkinci soru metni',
        language: 'en',
        nowIso: '2026-11-19T09:00:00.000Z'
    });
    await repositories.officeInquiries.create({
        id: 'inq-newest',
        firstName: 'Third',
        lastName: 'User',
        phone: '+905551112235',
        email: null,
        message: 'Üçüncü soru metni',
        language: 'ru',
        nowIso: '2026-11-19T10:00:00.000Z'
    });
    await repositories.officeInquiries.updateStatus({
        id: 'inq-middle',
        status: 'answered',
        staffId: 'staff-1',
        nowIso: '2026-11-19T10:30:00.000Z'
    });

    const allItems = await repositories.officeInquiries.list({ status: 'all', limit: 10 });
    assert.deepEqual(allItems.map((item) => item.id), ['inq-newest', 'inq-middle', 'inq-oldest']);

    const limitedItems = await repositories.officeInquiries.list({ status: 'all', limit: 2 });
    assert.deepEqual(limitedItems.map((item) => item.id), ['inq-newest', 'inq-middle']);

    const newItems = await repositories.officeInquiries.list({ status: 'new', limit: 10 });
    assert.deepEqual(newItems.map((item) => item.id), ['inq-newest', 'inq-oldest']);

    const answeredItems = await repositories.officeInquiries.list({ status: 'answered', limit: 10 });
    assert.deepEqual(answeredItems.map((item) => item.id), ['inq-middle']);
    assert.equal(answeredItems[0].handled_by_name, 'Elif Görevli');
    assert.equal(answeredItems[0].handled_at, '2026-11-19T10:30:00.000Z');

    const counts = await repositories.officeInquiries.countByStatus();
    assert.deepEqual(counts, { new: 2, answered: 1 });

    const dto = createInquiryDto(answeredItems[0]);
    assert.deepEqual(Object.keys(dto).sort(), [
        'created_at', 'email', 'first_name', 'handled_at', 'handled_by_name',
        'id', 'language', 'last_name', 'message', 'phone', 'status'
    ]);
});

test('updateStatus and deleteById write privacy-safe audit rows atomically in D1 batches', async () => {
    const { database, repositories } = createRepositories();
    seedStaffUser(database, { id: 'staff-1', displayName: 'Ayşe Görevli' });

    const sensitiveMessage = 'GIZLI-SORU-METNI-12345';
    const sensitivePhone = '+905559998877';
    const sensitiveEmail = 'gizli@example.edu';

    await repositories.officeInquiries.create({
        id: 'inq-audit-1',
        firstName: 'GizliAd',
        lastName: 'GizliSoyad',
        phone: sensitivePhone,
        email: sensitiveEmail,
        message: sensitiveMessage,
        language: 'tr',
        nowIso: '2026-11-19T08:00:00.000Z'
    });

    const answered = await repositories.officeInquiries.updateStatus({
        id: 'inq-audit-1',
        status: 'answered',
        staffId: 'staff-1',
        nowIso: '2026-11-19T09:00:00.000Z'
    });
    assert.equal(answered.status, 'answered');
    assert.equal(answered.handled_at, '2026-11-19T09:00:00.000Z');
    assert.equal(answered.handled_by_name, 'Ayşe Görevli');

    const reopened = await repositories.officeInquiries.updateStatus({
        id: 'inq-audit-1',
        status: 'new',
        staffId: 'staff-1',
        nowIso: '2026-11-19T09:15:00.000Z'
    });
    assert.equal(reopened.status, 'new');
    assert.equal(reopened.handled_at, null);
    assert.equal(reopened.handled_by_name, null);

    assert.equal(await repositories.officeInquiries.updateStatus({
        id: 'missing-id',
        status: 'answered',
        staffId: 'staff-1',
        nowIso: '2026-11-19T09:20:00.000Z'
    }), null);

    const deleted = await repositories.officeInquiries.deleteById({
        id: 'inq-audit-1',
        staffId: 'staff-1',
        nowIso: '2026-11-19T09:30:00.000Z'
    });
    assert.equal(deleted, true);
    assert.equal(await repositories.officeInquiries.deleteById({
        id: 'inq-audit-1',
        staffId: 'staff-1',
        nowIso: '2026-11-19T09:35:00.000Z'
    }), false);

    const audits = database.prepare(`
        SELECT event_type, actor_type, actor_staff_id, safe_metadata_json
        FROM audit_events
        ORDER BY rowid
    `).all().results;
    assert.equal(audits.length, 3);
    assert.equal(audits[0].event_type, 'staff.office_inquiry_status_updated');
    assert.equal(audits[1].event_type, 'staff.office_inquiry_status_updated');
    assert.equal(audits[2].event_type, 'staff.office_inquiry_deleted');

    for (const row of audits) {
        const meta = JSON.parse(row.safe_metadata_json);
        assert.equal(Object.hasOwn(meta, 'message'), false);
        assert.equal(Object.hasOwn(meta, 'phone'), false);
        assert.equal(Object.hasOwn(meta, 'email'), false);
        assert.equal(Object.hasOwn(meta, 'first_name'), false);
        assert.equal(Object.hasOwn(meta, 'last_name'), false);
        assert.doesNotMatch(row.safe_metadata_json, /GIZLI-SORU-METNI-12345|\+905559998877|gizli@example\.edu|GizliAd|GizliSoyad/);
    }

    // Denetim yazımı başarısız olduğunda durum güncellemesi geri alınır
    await repositories.officeInquiries.create({
        id: 'inq-rollback',
        firstName: 'Test',
        lastName: 'User',
        phone: '+905551112299',
        email: null,
        message: 'Geri alma testi sorusu',
        language: 'tr',
        nowIso: '2026-11-19T10:00:00.000Z'
    });
    database.exec(`
        CREATE TRIGGER reject_inquiry_audit
        BEFORE INSERT ON audit_events
        WHEN NEW.event_type IN ('staff.office_inquiry_status_updated', 'staff.office_inquiry_deleted')
        BEGIN
            SELECT RAISE(ABORT, 'audit unavailable');
        END;
    `);
    await assert.rejects(repositories.officeInquiries.updateStatus({
        id: 'inq-rollback',
        status: 'answered',
        staffId: 'staff-1',
        nowIso: '2026-11-19T10:05:00.000Z'
    }));
    await assert.rejects(repositories.officeInquiries.deleteById({
        id: 'inq-rollback',
        staffId: 'staff-1',
        nowIso: '2026-11-19T10:10:00.000Z'
    }));
    const rowAfterRollback = database.prepare('SELECT status FROM office_inquiries WHERE id = ?').bind('inq-rollback').first();
    assert.equal(rowAfterRollback.status, 'new');
});
