import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/server/worker.js';
import { CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION } from '../src/config/constants.js';
import { createNotificationFixture, notificationRequest } from './helpers/notification-fixtures.js';

test('accepting contact responsibility on a draft sends one reference mail through the Worker route', async () => {
  const { database, environment, applicationId, ownerCookie } = await createNotificationFixture();
  await database.prepare("UPDATE applications SET status = 'draft', submitted_at = NULL, student_phone = '+905321234567' WHERE id = ?")
    .bind(applicationId).run();
  const { reference_number: reference } = await database.prepare('SELECT reference_number FROM applications WHERE id = ?')
    .bind(applicationId).first();
  const mailerEnvironment = {
    ...environment,
    REFERENCE_MAIL_TOKEN: 't'.repeat(40),
    REFERENCE_MAIL_ENDPOINT: 'https://script.google.com/macros/s/AKfycbRouteTest/exec'
  };

  const mailerCalls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://script.google.com/')) {
      mailerCalls.push(JSON.parse(init.body));
      return Response.json({ ok: true });
    }
    return realFetch(url, init);
  };
  try {
    const response = await worker.fetch(notificationRequest('/api/public/applications/current/contact-acknowledgement', {
      method: 'POST',
      cookie: ownerCookie,
      body: { accepted: true, version: CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION }
    }), mailerEnvironment, {});

    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(mailerCalls.length, 1);
    assert.equal(mailerCalls[0].to, 'student@example.invalid');
    assert.match(mailerCalls[0].text, new RegExp(reference));
    assert.match(mailerCalls[0].text, /NOTIF-001/);
    assert.doesNotMatch(mailerCalls[0].text, /access/i);
  } finally {
    globalThis.fetch = realFetch;
  }
});
