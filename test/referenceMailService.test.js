import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildReferenceMail, readReferenceMailConfig, sendDraftReferenceMail
} from '../src/server/services/referenceMailService.js';
import { createNotificationFixture } from './helpers/notification-fixtures.js';

const TOKEN = 't'.repeat(40);
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbTestDeployment/exec';
const PORTAL_URL = 'https://portal.test/basvurum/';

function configuredEnvironment(database, overrides = {}) {
  return { DB: database, REFERENCE_MAIL_TOKEN: TOKEN, REFERENCE_MAIL_ENDPOINT: ENDPOINT, ...overrides };
}

function recordingFetch(responses) {
  const calls = [];
  const fetchImplementation = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = responses.shift() ?? { ok: true };
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body ?? next), { status: next.status ?? 200 });
  };
  return { calls, fetchImplementation };
}

async function referenceOf(database, applicationId) {
  return database.prepare('SELECT reference_number FROM applications WHERE id = ?').bind(applicationId).first()
    .reference_number;
}

async function mailRow(database, applicationId) {
  return database.prepare('SELECT status, attempts, last_error_code FROM application_reference_mails WHERE application_id = ?')
    .bind(applicationId).first();
}

test('draft mail contains reference, student number, type and portal link in five languages', () => {
  const mail = buildReferenceMail({
    referenceNumber: 'ITU-7K9M-4X2P', studentNumber: 'NOTIF-001', applicationType: 'renewal', portalUrl: PORTAL_URL
  });
  assert.match(mail.text, /ITU-7K9M-4X2P/);
  assert.match(mail.text, /NOTIF-001/);
  assert.match(mail.text, /Yenileme/);
  assert.match(mail.text, /https:\/\/portal\.test\/basvurum\//);
  for (const greeting of ['Merhaba,', 'Hello,', 'Здравствуйте!', 'Salam,', 'مرحبًا،']) {
    assert.match(mail.text, new RegExp(greeting));
  }
  assert.equal(mail.text.split('ITU-7K9M-4X2P').length - 1, 5);
  assert.doesNotMatch(mail.text, /access|erişim/i);
  assert.throws(() => buildReferenceMail({
    referenceNumber: 'not-a-reference', studentNumber: 'NOTIF-001', applicationType: 'initial', portalUrl: PORTAL_URL
  }), TypeError);
  assert.throws(() => buildReferenceMail({
    referenceNumber: 'ITU-7K9M-4X2P', studentNumber: '', applicationType: 'initial', portalUrl: PORTAL_URL
  }), TypeError);
});

test('mailer configuration accepts only a long token and an Apps Script web app URL', () => {
  assert.ok(readReferenceMailConfig(configuredEnvironment({})));
  assert.equal(readReferenceMailConfig(configuredEnvironment({}, { REFERENCE_MAIL_TOKEN: 'short' })), null);
  assert.equal(readReferenceMailConfig(configuredEnvironment({}, { REFERENCE_MAIL_ENDPOINT: 'https://evil.example/macros/s/x/exec' })), null);
  assert.equal(readReferenceMailConfig(configuredEnvironment({}, { REFERENCE_MAIL_ENDPOINT: 'http://script.google.com/macros/s/x/exec' })), null);
  assert.equal(readReferenceMailConfig({ DB: null }), null);
});

test('successful draft mail is sent with reference and student number, and not repeated', async () => {
  const { database, applicationId } = await createNotificationFixture();
  const now = new Date().toISOString();
  const { calls, fetchImplementation } = recordingFetch([{ ok: true }]);
  const input = { applicationId, portalUrl: PORTAL_URL, now, fetchImplementation };

  await sendDraftReferenceMail(configuredEnvironment(database), input);
  await sendDraftReferenceMail(configuredEnvironment(database), input);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENDPOINT);
  assert.equal(calls[0].body.token, TOKEN);
  assert.equal(calls[0].body.to, 'student@example.invalid');
  assert.match(calls[0].body.text, new RegExp(await referenceOf(database, applicationId)));
  assert.match(calls[0].body.text, /NOTIF-001/);
  const row = await mailRow(database, applicationId);
  assert.equal(row.status, 'sent');
  assert.equal(row.last_error_code, null);
});

test('quota response defers the mail and the next draft event retries it', async () => {
  const { database, applicationId } = await createNotificationFixture();
  const { calls, fetchImplementation } = recordingFetch([{ status: 200, body: { ok: false, error: 'quota' } }, { ok: true }]);
  const input = { applicationId, portalUrl: PORTAL_URL, fetchImplementation };

  await sendDraftReferenceMail(configuredEnvironment(database), input);
  assert.equal((await mailRow(database, applicationId)).status, 'quota_deferred');

  await sendDraftReferenceMail(configuredEnvironment(database), input);
  assert.equal(calls.length, 2);
  assert.equal((await mailRow(database, applicationId)).status, 'sent');
});

test('network failure is recorded as failed without throwing', async () => {
  const { database, applicationId } = await createNotificationFixture();
  const { fetchImplementation } = recordingFetch([new Error('socket closed')]);

  await sendDraftReferenceMail(configuredEnvironment(database), { applicationId, portalUrl: PORTAL_URL, fetchImplementation });

  const row = await mailRow(database, applicationId);
  assert.equal(row.status, 'failed');
  assert.equal(row.last_error_code, 'network');
  assert.equal(row.attempts, 1);
});

test('unconfigured mailer or missing recipient queues nothing and calls nothing', async () => {
  const { database, applicationId } = await createNotificationFixture();
  const { calls, fetchImplementation } = recordingFetch([]);

  await sendDraftReferenceMail({ DB: database }, { applicationId, portalUrl: PORTAL_URL, fetchImplementation });
  assert.equal(calls.length, 0);
  assert.equal(await mailRow(database, applicationId), null);

  await database.prepare('UPDATE applications SET student_email = NULL WHERE id = ?').bind(applicationId).run();
  await sendDraftReferenceMail(configuredEnvironment(database), { applicationId, portalUrl: PORTAL_URL, fetchImplementation });
  assert.equal(calls.length, 0);
  assert.equal(await mailRow(database, applicationId), null);
});
