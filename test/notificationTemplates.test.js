import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOTIFICATION_LANGUAGES, NOTIFICATION_TEMPLATES, buildNotificationMessage,
    canUseNotificationTemplate } from '../src/server/domain/notificationTemplates.js';

test('notification catalogue defines five approved-for-local-use categories in all supported languages', () => {
    assert.deepEqual(NOTIFICATION_LANGUAGES, ['tr', 'en', 'ru', 'tk', 'ar']);
    assert.deepEqual(Object.keys(NOTIFICATION_TEMPLATES), [
        'application_received', 'document_update_needed', 'status_updated',
        'forwarded_to_migration', 'application_completed'
    ]);
    for (const template of Object.values(NOTIFICATION_TEMPLATES)) {
        assert.deepEqual(Object.keys(template).sort(), [...NOTIFICATION_LANGUAGES].sort());
    }
});

test('notification messages use only the normal same-origin tracking page', () => {
    const message = buildNotificationMessage({
        templateKey: 'application_received', language: 'tr', origin: 'https://portal.example.test'
    });
    assert.match(message, /https:\/\/portal\.example\.test\/basvurum\//);
    assert.doesNotMatch(message, /passport|pasaport|YKN|signed|token|bearer/i);
});

test('status-specific templates cannot make a false application claim', () => {
    assert.equal(canUseNotificationTemplate('document_update_needed', 'resubmission_required'), true);
    assert.equal(canUseNotificationTemplate('document_update_needed', 'submitted'), false);
    assert.equal(canUseNotificationTemplate('forwarded_to_migration', 'sent_to_migration'), true);
    assert.equal(canUseNotificationTemplate('forwarded_to_migration', 'under_review'), false);
    assert.equal(canUseNotificationTemplate('application_completed', 'completed'), true);
    assert.equal(canUseNotificationTemplate('application_completed', 'rejected'), false);
});
