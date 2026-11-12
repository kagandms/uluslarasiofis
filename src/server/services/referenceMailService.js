const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 5_000;
const RETRY_BATCH_SIZE = 20;
const KNOWN_ERROR_CODES = new Set(['unauthorized', 'bad_request', 'quota', 'send_failed']);
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/;
const REFERENCE_PATTERN = /^ITU-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

const MAIL_TEXT = Object.freeze({
  tr: { greeting: 'Merhaba,', intro: 'Başvuru taslağınız kaydedildi.', ref: 'Başvuru numaranız', student: 'Öğrenci numaranız', type: 'Başvuru türü', next: 'Başvurunuzu tamamlamak için portala girin:', login: 'Giriş için başvuru numaranız ve öğrenci numaranız gerekir. Lütfen bunları saklayın.', types: { initial: 'İlk başvuru', renewal: 'Yenileme', transition: 'Geçiş başvurusu' } },
  en: { greeting: 'Hello,', intro: 'Your application draft has been saved.', ref: 'Application number', student: 'Student number', type: 'Application type', next: 'To complete your application, open the portal:', login: 'To sign in you need your application number and student number. Please keep them safe.', types: { initial: 'Initial application', renewal: 'Renewal', transition: 'Transition application' } },
  ru: { greeting: 'Здравствуйте!', intro: 'Черновик вашей заявки сохранён.', ref: 'Номер заявки', student: 'Номер студента', type: 'Тип заявки', next: 'Чтобы завершить заявку, откройте портал:', login: 'Для входа нужны номер заявки и номер студента. Пожалуйста, сохраните их.', types: { initial: 'Первичная заявка', renewal: 'Продление', transition: 'Заявка на переход' } },
  tk: { greeting: 'Salam,', intro: 'Arzaňyzyň taslamasy saklandy.', ref: 'Arzaňyzyň belgisi', student: 'Talyp belgisi', type: 'Arza görnüşi', next: 'Arzaňyzy tamamlamak üçin portala giriň:', login: 'Girmek üçin arzaňyzyň belgisi we talyp belgisi gerek. Olary saklaň.', types: { initial: 'Ilkinji arza', renewal: 'Täzeleme', transition: 'Geçiş arzasy' } },
  ar: { greeting: 'مرحبًا،', intro: 'تم حفظ مسودة طلبك.', ref: 'رقم الطلب', student: 'رقم الطالب', type: 'نوع الطلب', next: 'لإكمال طلبك، افتح البوابة:', login: 'للدخول تحتاج إلى رقم الطلب ورقم الطالب. احتفظ بهما.', types: { initial: 'طلب أولي', renewal: 'تجديد', transition: 'طلب انتقال' } }
});

/**
 * Reads the Apps Script mailer settings. Returns null unless both secrets are present and the
 * endpoint is an https Apps Script web app, so an unconfigured deployment simply skips mail.
 * @param {object} environment Worker bindings.
 * @returns {{token: string, endpoint: string}|null}
 */
export function readReferenceMailConfig(environment) {
  const token = environment?.REFERENCE_MAIL_TOKEN;
  if (typeof token !== 'string' || token.length < 32 || typeof environment?.REFERENCE_MAIL_ENDPOINT !== 'string') return null;
  let endpoint;
  try { endpoint = new URL(environment.REFERENCE_MAIL_ENDPOINT); } catch { return null; }
  const isAppsScriptWebApp = endpoint.protocol === 'https:' && endpoint.hostname === 'script.google.com'
    && endpoint.pathname.startsWith('/macros/s/') && !endpoint.username && !endpoint.password && !endpoint.search;
  return isAppsScriptWebApp ? { token, endpoint: endpoint.toString() } : null;
}

/**
 * Builds the draft-saved message in all five portal languages. It contains the application number,
 * the student number, the application type and the portal link. It never contains the access code
 * or passport data.
 * @param {{referenceNumber: string, studentNumber: string, applicationType: string, portalUrl: string}} input
 * @returns {{subject: string, text: string}} Mail subject and plain-text body.
 */
export function buildReferenceMail({ referenceNumber, studentNumber, applicationType, portalUrl }) {
  if (!REFERENCE_PATTERN.test(referenceNumber)) throw new TypeError('Invalid application reference.');
  if (typeof studentNumber !== 'string' || studentNumber.length === 0 || studentNumber.length > 64) {
    throw new TypeError('Invalid student number.');
  }
  const sections = Object.values(MAIL_TEXT).map((labels) => [
    labels.greeting,
    labels.intro,
    '',
    `${labels.ref}: ${referenceNumber}`,
    `${labels.student}: ${studentNumber}`,
    `${labels.type}: ${labels.types[applicationType] ?? labels.types.initial}`,
    '',
    `${labels.next} ${portalUrl}`,
    labels.login
  ].join('\n'));
  return {
    subject: 'Başvuru taslağınız kaydedildi · Application draft saved · Черновик сохранён · Arzaňyzyň taslamasy saklandy · تم حفظ المسودة',
    text: sections.join('\n\n---\n\n')
  };
}

/** Queues one reference mail per application. Existing rows are left unchanged. */
export async function enqueueReferenceMail(database, applicationId, now) {
  await database.prepare(`INSERT OR IGNORE INTO application_reference_mails
      (application_id, status, attempts, created_at, updated_at)
      VALUES (?, 'pending', 0, ?, ?)`).bind(applicationId, now, now).run();
}

async function postToMailer(config, payload, fetchImplementation) {
  const response = await fetchImplementation(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: config.token, ...payload }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => null);
  if (data?.ok === true) return { status: 'sent', errorCode: null };
  if (data?.error === 'quota' || response.status === 429) return { status: 'quota_deferred', errorCode: 'quota' };
  const errorCode = KNOWN_ERROR_CODES.has(data?.error) ? data.error : `http_${response.status}`;
  return { status: 'failed', errorCode };
}

/**
 * Sends one queued mail and records the outcome. Never throws for delivery problems.
 * @returns {Promise<'sent'|'quota_deferred'|'failed'>} Recorded outcome.
 */
export async function deliverReferenceMail(database, config, { applicationId, recipient, mail, now, fetchImplementation = fetch }) {
  let outcome;
  try {
    outcome = await postToMailer(config, { to: recipient, subject: mail.subject, text: mail.text }, fetchImplementation);
  } catch {
    outcome = { status: 'failed', errorCode: 'network' };
  }
  await database.prepare(`UPDATE application_reference_mails
      SET status = ?, attempts = attempts + 1, last_error_code = ?, updated_at = ?, sent_at = ?
      WHERE application_id = ?`)
    .bind(outcome.status, outcome.errorCode, now, outcome.status === 'sent' ? now : null, applicationId).run();
  return outcome.status;
}

function mailFromRow(row, portalUrl) {
  return buildReferenceMail({
    referenceNumber: row.reference_number,
    studentNumber: row.student_number,
    applicationType: row.application_route === 'transition' ? 'transition' : row.application_type,
    portalUrl
  });
}

/**
 * Called when an applicant saves a new draft. Queues and sends this application's mail, then retries a
 * few older deferred or failed mails. Any problem is contained so the draft itself still succeeds.
 * @param {object} environment Worker bindings.
 * @param {{applicationId: string, portalUrl: string, now?: string, fetchImplementation?: Function}} input
 */
export async function sendDraftReferenceMail(environment, { applicationId, portalUrl, now = new Date().toISOString(), fetchImplementation = fetch }) {
  try {
    const config = readReferenceMailConfig(environment);
    const database = environment.DB;
    if (!config || !database || typeof applicationId !== 'string') return;

    const row = await database.prepare(`SELECT a.student_email, a.reference_number, a.application_type, a.application_route, s.student_number
        FROM applications a JOIN students s ON s.id = a.student_id WHERE a.id = ?`).bind(applicationId).first();
    if (!row || !EMAIL_PATTERN.test(row.student_email || '')) return;

    await enqueueReferenceMail(database, applicationId, now);
    const current = await database.prepare('SELECT status FROM application_reference_mails WHERE application_id = ?')
      .bind(applicationId).first();
    if (current?.status === 'sent') return;

    const outcome = await deliverReferenceMail(database, config, {
      applicationId, recipient: row.student_email, mail: mailFromRow(row, portalUrl), now, fetchImplementation
    });
    if (outcome === 'quota_deferred') return;

    const retry = await database.prepare(`SELECT m.application_id, a.student_email, a.reference_number, a.application_type, a.application_route, s.student_number
        FROM application_reference_mails m
        JOIN applications a ON a.id = m.application_id
        JOIN students s ON s.id = a.student_id
        WHERE m.status IN ('quota_deferred', 'failed') AND m.attempts < ? AND m.application_id != ?
        ORDER BY m.updated_at LIMIT ?`).bind(MAX_ATTEMPTS, applicationId, RETRY_BATCH_SIZE).all();
    for (const retryRow of retry.results || []) {
      if (!EMAIL_PATTERN.test(retryRow.student_email || '') || !REFERENCE_PATTERN.test(retryRow.reference_number)) continue;
      const retryOutcome = await deliverReferenceMail(database, config, {
        applicationId: retryRow.application_id, recipient: retryRow.student_email,
        mail: mailFromRow(retryRow, portalUrl), now: new Date().toISOString(), fetchImplementation
      });
      if (retryOutcome !== 'sent') break;
    }
  } catch {
    console.warn('reference_mail_skipped');
  }
}
