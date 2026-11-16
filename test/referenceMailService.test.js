import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DAILY_DRAFT_MAIL_QUOTA,
  DAILY_RECOVERY_MAIL_QUOTA,
  REFERENCE_REMINDER_MAIL_DAILY_LIMIT,
  buildReferenceMail,
  buildReferenceReminderMail,
  readMailQuotaStatus,
  readReferenceMailConfig,
  resolveMailPortalUrl,
  sendDraftReferenceMail,
  sendReferenceReminderMail
} from '../src/server/services/referenceMailService.js';
import { createRateLimitRepository } from '../src/server/repositories/d1/rateLimitRepository.js';
import { consumePublicRateLimit } from '../src/server/security/requestRateLimit.js';
import { createNotificationFixture } from './helpers/notification-fixtures.js';

const TOKEN = 't'.repeat(40);
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbTestDeployment/exec';
const PORTAL_URL = 'https://portal.test/basvurum/';
const RESUME_PORTAL_URL = 'https://portal.test/basvuruya-devam-et/';
const ACCESS_CODE_PATTERN = /[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{6}/;

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
  assert.equal(mail.subject, 'Başvuru taslağınız kaydedildi · Application draft saved');
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
  assert.equal(calls[0].body.subject, 'Başvuru taslağınız kaydedildi · Application draft saved');
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

test('resolveMailPortalUrl uses a valid canonical origin and falls back to the request origin', () => {
  const requestUrl = 'https://worker.example.workers.dev/api/applications/current/contact-acknowledgement';
  assert.equal(
    resolveMailPortalUrl({ PORTAL_CANONICAL_ORIGIN: 'https://ikamet.example.edu.tr' }, requestUrl),
    'https://ikamet.example.edu.tr/basvurum/'
  );
  assert.equal(
    resolveMailPortalUrl({ PORTAL_CANONICAL_ORIGIN: 'https://ikamet.example.edu.tr:8443' }, requestUrl),
    'https://ikamet.example.edu.tr:8443/basvurum/'
  );
  assert.equal(
    resolveMailPortalUrl({}, requestUrl),
    'https://worker.example.workers.dev/basvurum/'
  );
  assert.equal(
    resolveMailPortalUrl(undefined, requestUrl),
    'https://worker.example.workers.dev/basvurum/'
  );
  for (const invalidOrigin of [
    '',
    '   ',
    null,
    123,
    'not-a-url',
    'http://ikamet.example.edu.tr',
    'https://ikamet.example.edu.tr/',
    'https://ikamet.example.edu.tr/basvurum',
    'https://ikamet.example.edu.tr/basvurum/',
    'https://ikamet.example.edu.tr?foo=bar',
    'https://ikamet.example.edu.tr?',
    'https://ikamet.example.edu.tr#hash',
    'https://ikamet.example.edu.tr#',
    'https://user:pass@ikamet.example.edu.tr',
    'https://user@ikamet.example.edu.tr'
  ]) {
    assert.equal(
      resolveMailPortalUrl({ PORTAL_CANONICAL_ORIGIN: invalidOrigin }, requestUrl),
      'https://worker.example.workers.dev/basvurum/'
    );
  }
});

function seedSentDraftMails(database, count, sentAt) {
  for (let i = 0; i < count; i += 1) {
    const studentId = `quota-student-${i}`;
    const appId = `quota-app-${i}`;
    database.prepare('INSERT INTO students (id, student_number, normalized_student_number) VALUES (?, ?, ?)')
      .bind(studentId, `QUOTA-${i}`, `QUOTA-${i}`).run();
    database.prepare("INSERT INTO applications (id, student_id, application_type, status) VALUES (?, ?, 'initial', 'draft')")
      .bind(appId, studentId).run();
    database.prepare(`INSERT INTO application_reference_mails (application_id, status, attempts, created_at, updated_at, sent_at)
        VALUES (?, 'sent', 1, ?, ?, ?)`).bind(appId, sentAt, sentAt, sentAt).run();
  }
}

test('draft mail defers locally when 70-recipient rolling 24h draft quota is full so 30 slots stay for recovery', async () => {
  const { database, applicationId } = await createNotificationFixture();
  const now = new Date().toISOString();
  const withinWindow = new Date(Date.parse(now) - 60 * 60 * 1000).toISOString();
  seedSentDraftMails(database, DAILY_DRAFT_MAIL_QUOTA, withinWindow);
  const { calls, fetchImplementation } = recordingFetch([{ ok: true }]);

  await sendDraftReferenceMail(configuredEnvironment(database), { applicationId, portalUrl: PORTAL_URL, now, fetchImplementation });

  assert.equal(calls.length, 0);
  const row = await mailRow(database, applicationId);
  assert.equal(row.status, 'quota_deferred');
  assert.equal(row.last_error_code, 'quota');

  const quota = await readMailQuotaStatus(database, now);
  assert.equal(quota.draftSentCount, DAILY_DRAFT_MAIL_QUOTA);
  assert.equal(quota.draftRemaining, 0);
  assert.equal(quota.recoveryRemaining, DAILY_RECOVERY_MAIL_QUOTA);
});

test('reference reminder mail sends plain text with reference and student number without access code and returns failed on transport error', async () => {
  const { calls, fetchImplementation } = recordingFetch([{ ok: true }, new Error('network down')]);
  const environment = configuredEnvironment({});

  const okResult = await sendReferenceReminderMail(environment, {
    recipient: 'student@example.invalid',
    referenceNumber: 'ITU-7K9M-4X2P',
    studentNumber: 'SYN-001',
    portalUrl: RESUME_PORTAL_URL,
    language: 'tr',
    fetchImplementation
  });
  assert.equal(okResult.status, 'sent');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].body.text.includes('ITU-7K9M-4X2P'));
  assert.ok(calls[0].body.text.includes('SYN-001'));
  assert.ok(calls[0].body.text.includes(RESUME_PORTAL_URL));
  assert.doesNotMatch(calls[0].body.text, ACCESS_CODE_PATTERN);

  const failResult = await sendReferenceReminderMail(environment, {
    recipient: 'student@example.invalid',
    referenceNumber: 'ITU-7K9M-4X2P',
    studentNumber: 'SYN-001',
    portalUrl: RESUME_PORTAL_URL,
    language: 'en',
    fetchImplementation
  });
  assert.equal(failResult.status, 'failed');
  assert.equal(failResult.errorCode, 'network');
  assert.throws(() => buildReferenceReminderMail({
    referenceNumber: 'invalid-ref',
    studentNumber: 'SYN-001',
    portalUrl: RESUME_PORTAL_URL
  }), TypeError);
  assert.throws(() => buildReferenceReminderMail({
    referenceNumber: 'ITU-7K9M-4X2P',
    studentNumber: '',
    portalUrl: RESUME_PORTAL_URL
  }), TypeError);
});

test('readMailQuotaStatus reads reference-reminder-mail-daily from public_rate_limits and isolates blocked counts from draft quota', async () => {
  const { database } = await createNotificationFixture();
  const rateLimits = createRateLimitRepository(database);
  const nowMs = Date.UTC(2026, 10, 16, 12, 0, 0);
  const nowSeconds = Math.floor(nowMs / 1000);
  const nowIso = new Date(nowMs).toISOString();

  // 30 başarılı + 5 reddedilmiş deneme global sayacı artırsa da recoverySentCount 30 ile sınırlanır.
  for (let i = 0; i < 35; i += 1) {
    await consumePublicRateLimit(rateLimits, {
      ...REFERENCE_REMINDER_MAIL_DAILY_LIMIT,
      nowSeconds
    });
  }

  const fullQuota = await readMailQuotaStatus(database, nowIso);
  assert.equal(fullQuota.recoverySentCount, DAILY_RECOVERY_MAIL_QUOTA);
  assert.equal(fullQuota.recoveryRemaining, 0);
  assert.equal(fullQuota.draftRemaining, DAILY_DRAFT_MAIL_QUOTA);
  assert.equal(fullQuota.totalRemaining, DAILY_DRAFT_MAIL_QUOTA);

  const nextDayIso = new Date(nowMs + 86_401 * 1000).toISOString();
  const resetQuota = await readMailQuotaStatus(database, nextDayIso);
  assert.equal(resetQuota.recoverySentCount, 0);
  assert.equal(resetQuota.recoveryRemaining, DAILY_RECOVERY_MAIL_QUOTA);
});
