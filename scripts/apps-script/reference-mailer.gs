// Google Apps Script web app that sends application reference-number e-mails from the office Gmail account.
//
// Deployment (oone once by the office account owner, see docs/reference-mail-setup.md):
//   1. Create a new Apps Script project while signed in to the office Google account.
//   2. Paste this file as Code.gs.
//   3. Project Settings > Script properties: add REFERENCE_MAIL_TOKEN with a long random value.
//   4. Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone".
//   5. Copy the /exec URL and the same token into the Worker secrets REFERENCE_MAIL_ENDPOINT and REFERENCE_MAIL_TOKEN.
//
// The request body is JSON: { token, to, subject, text }. Responses are JSON: { ok: true } or { ok: false, error }.
// Error codes: unauthorized, bad_request, quota (daily MailApp quota exhausted), send_failed.

var TOKEN_PROPERTY = 'REFERENCE_MAIL_TOKEN';
var SENDER_NAME = 'İstanbul Topkapı Üniversitesi Uluslararası Öğrenci Ofisi';
var MAX_TEXT_CHARS = 8000;
var MAX_SUBJECT_CHARS = 200;
var EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/;

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (error) {
    return jsonResponse_({ ok: false, error: 'bad_request' });
  }

  var expected = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY);
  if (!expected || !sameText_(String(body.token || ''), expected)) {
    return jsonResponse_({ ok: false, error: 'unauthorized' });
  }

  if (typeof body.to !== 'string' || !EMAIL_PATTERN.test(body.to)
      || typeof body.subject !== 'string' || body.subject.length === 0 || body.subject.length > MAX_SUBJECT_CHARS
      || typeof body.text !== 'string' || body.text.length === 0 || body.text.length > MAX_TEXT_CHARS) {
    return jsonResponse_({ ok: false, error: 'bad_request' });
  }

  if (MailApp.getRemainingDailyQuota() < 1) {
    return jsonResponse_({ ok: false, error: 'quota' });
  }

  try {
    MailApp.sendEmail({ to: body.to, subject: body.subject, body: body.text, name: SENDER_NAME });
    return jsonResponse_({ ok: true });
  } catch (error) {
    return jsonResponse_({ ok: false, error: 'send_failed' });
  }
}

function sameText_(a, b) {
  if (a.length !== b.length) return false;
  var difference = 0;
  for (var index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
      .setMimeType(ContentService.MimeType.JSON);
}
