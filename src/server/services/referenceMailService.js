import { isValidAccessCodeFormat } from '../auth/applicationAccessCode.js';

const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 5_000;
const RETRY_BATCH_SIZE = 20;
const KNOWN_ERROR_CODES = new Set(['unauthorized', 'bad_request', 'quota', 'send_failed']);
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/;
const REFERENCE_PATTERN = /^ITU-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

export const DAILY_TOTAL_MAIL_QUOTA = 100;
export const DAILY_DRAFT_MAIL_QUOTA = 70;
export const DAILY_RECOVERY_MAIL_QUOTA = 30;
export const SUPPORTED_MAIL_LANGUAGES = Object.freeze(['tr', 'en', 'ru', 'tk', 'ar']);

const SUPPORTED_MAIL_LANGUAGE_SET = new Set(SUPPORTED_MAIL_LANGUAGES);
const DEFAULT_DRAFT_SUBJECT = 'Başvuru taslağınız kaydedildi · Application draft saved';
const DEFAULT_RECOVERY_SUBJECT = 'Başvuru erişim kodunuz yenilendi · Application access code reset';

const MAIL_TEXT = Object.freeze({
  tr: { subject: 'Başvuru taslağınız kaydedildi', greeting: 'Merhaba,', intro: 'Başvuru taslağınız kaydedildi.', ref: 'Başvuru numaranız', student: 'Öğrenci numaranız', type: 'Başvuru türü', next: 'Başvurunuzu tamamlamak için portala girin:', login: 'Giriş için başvuru numaranız ve öğrenci numaranız gerekir. Lütfen bunları saklayın.', types: { initial: 'İlk başvuru', renewal: 'Yenileme', transition: 'Geçiş başvurusu' } },
  en: { subject: 'Application draft saved', greeting: 'Hello,', intro: 'Your application draft has been saved.', ref: 'Application number', student: 'Student number', type: 'Application type', next: 'To complete your application, open the portal:', login: 'To sign in you need your application number and student number. Please keep them safe.', types: { initial: 'Initial application', renewal: 'Renewal', transition: 'Transition application' } },
  ru: { subject: 'Черновик заявки сохранён', greeting: 'Здравствуйте!', intro: 'Черновик вашей заявки сохранён.', ref: 'Номер заявки', student: 'Номер студента', type: 'Тип заявки', next: 'Чтобы завершить заявку, откройте портал:', login: 'Для входа нужны номер заявки и номер студента. Пожалуйста, сохраните их.', types: { initial: 'Первичная заявка', renewal: 'Продление', transition: 'Заявка на переход' } },
  tk: { subject: 'Arzaňyzyň taslamasy saklandy', greeting: 'Salam,', intro: 'Arzaňyzyň taslamasy saklandy.', ref: 'Arzaňyzyň belgisi', student: 'Talyp belgisi', type: 'Arza görnüşi', next: 'Arzaňyzy tamamlamak üçin portala giriň:', login: 'Girmek üçin arzaňyzyň belgisi we talyp belgisi gerek. Olary saklaň.', types: { initial: 'Ilkinji arza', renewal: 'Täzeleme', transition: 'Geçiş arzasy' } },
  ar: { subject: 'تم حفظ مسودة طلبك', greeting: 'مرحبًا،', intro: 'تم حفظ مسودة طلبك.', ref: 'رقم الطلب', student: 'رقم الطالب', type: 'نوع الطلب', next: 'لإكمال طلبك، افتح البوابة:', login: 'للدخول تحتاج إلى رقم الطلب ورقم الطالب. احتفظ بهما.', types: { initial: 'طلب أولي', renewal: 'تجديد', transition: 'طلب انتقال' } }
});

const RECOVERY_MAIL_TEXT = Object.freeze({
  tr: {
    subject: 'Başvuru erişim kodunuz yenilendi',
    greeting: 'Merhaba,',
    intro: 'Başvurunuz için yeni bir erişim kodu oluşturuldu. Eski erişim kodunuz artık geçersizdir.',
    ref: 'Başvuru numaranız',
    student: 'Öğrenci numaranız',
    code: 'Yeni erişim kodunuz',
    next: 'Başvurunuza devam etmek için portala girin:',
    ignore: 'Bu işlemi siz istemediyseniz bu e-postayı yok sayabilirsiniz.',
    spam: 'E-posta birkaç dakika içinde görünmezse gereksiz (spam) klasörünü kontrol edin.'
  },
  en: {
    subject: 'Your application access code has been reset',
    greeting: 'Hello,',
    intro: 'A new access code has been created for your application. Your previous access code is no longer valid.',
    ref: 'Application number',
    student: 'Student number',
    code: 'New access code',
    next: 'To continue your application, open the portal:',
    ignore: 'If you did not request this, you can safely ignore this email.',
    spam: 'If you do not see emails within a few minutes, please check your spam or junk folder.'
  },
  ru: {
    subject: 'Код доступа к вашей заявке обновлён',
    greeting: 'Здравствуйте!',
    intro: 'Для вашей заявки создан новый код доступа. Прежний код доступа больше не действителен.',
    ref: 'Номер заявки',
    student: 'Номер студента',
    code: 'Новый код доступа',
    next: 'Чтобы продолжить работу с заявкой, откройте портал:',
    ignore: 'Если вы не запрашивали это изменение, просто проигнорируйте это письмо.',
    spam: 'Если письмо не появилось во входящих в течение нескольких минут, проверьте папку «Спам».'
  },
  tk: {
    subject: 'Arzaňyzyň giriş kody täzelendi',
    greeting: 'Salam,',
    intro: 'Arzaňyz üçin täze giriş kody döredildi. Öňki giriş kodyňyz indi güýjüni ýitirdi.',
    ref: 'Arzaňyzyň belgisi',
    student: 'Talyp belgisi',
    code: 'Täze giriş kodyňyz',
    next: 'Arzaňyzy dowam etdirmek üçin portala giriň:',
    ignore: 'Bu amaly siz islemän bolsaňyz, bu haty üns bermän geçip bilersiňiz.',
    spam: 'Hat birnäçe minudyň içinde görünmese, gereksiz (spam) bukjasyny barlaň.'
  },
  ar: {
    subject: 'تم تجديد رمز الدخول لطلبك',
    greeting: 'مرحبًا،',
    intro: 'تم إنشاء رمز دخول جديد لطلبك. لم يعد رمز الدخول السابق صالحًا.',
    ref: 'رقم الطلب',
    student: 'رقم الطالب',
    code: 'رمز الدخول الجديد',
    next: 'لمتابعة طلبك، افتح البوابة:',
    ignore: 'إذا لم تطلب هذا الإجراء، يمكنك تجاهل هذا البريد الإلكتروني.',
    spam: 'إذا لم يصل البريد خلال بضع دقائق، يرجى التحقق من مجلد الرسائل غير المرغوب فيها (Spam).'
  }
});

/**
 * Geçerli desteklenen e-posta dilini döndürür; geçersiz veya eksik değerleri yok sayar.
 * @param {unknown} language İstemciden gelen dil değeri.
 * @returns {'tr'|'en'|'ru'|'tk'|'ar'|null} Doğrulanmış dil kodu veya null.
 */
export function normalizeMailLanguage(language) {
  if (typeof language !== 'string') return null;
  return SUPPORTED_MAIL_LANGUAGE_SET.has(language) ? language : null;
}

/** E-posta biçiminin gönderime uygun olup olmadığını denetler. */
export function isValidReferenceMailRecipient(email) {
  return typeof email === 'string' && EMAIL_PATTERN.test(email);
}

/** Başvuru numarası biçiminin e-posta şablonları için geçerli olup olmadığını denetler. */
export function isValidReferenceMailNumber(referenceNumber) {
  return typeof referenceNumber === 'string' && REFERENCE_PATTERN.test(referenceNumber);
}

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
 * Resolves the portal URL embedded in reference e-mails. Uses PORTAL_CANONICAL_ORIGIN when it is a
 * bare https origin without credentials, path, query or hash; otherwise falls back to the request origin.
 * @param {object} environment Worker bindings.
 * @param {string} requestUrl Incoming request URL.
 * @returns {string} Absolute portal entry URL.
 */
export function resolveMailPortalUrl(environment, requestUrl) {
  const rawOrigin = environment?.PORTAL_CANONICAL_ORIGIN;
  if (typeof rawOrigin === 'string' && rawOrigin.length > 0) {
    try {
      const parsed = new URL(rawOrigin);
      if (
        parsed.protocol === 'https:'
        && !parsed.username
        && !parsed.password
        && parsed.pathname === '/'
        && !parsed.search
        && !parsed.hash
        && rawOrigin.toLowerCase() === parsed.origin
      ) {
        return `${parsed.origin}/basvurum/`;
      }
    } catch {
      // Invalid canonical origin falls back to the request URL.
    }
  }
  return new URL('/basvurum/', requestUrl).href;
}

function formatDraftSection(labels, { referenceNumber, studentNumber, applicationType, portalUrl }) {
  return [
    labels.greeting,
    labels.intro,
    '',
    `${labels.ref}: ${referenceNumber}`,
    `${labels.student}: ${studentNumber}`,
    `${labels.type}: ${labels.types[applicationType] ?? labels.types.initial}`,
    '',
    `${labels.next} ${portalUrl}`,
    labels.login
  ].join('\n');
}

function formatRecoverySection(labels, { referenceNumber, studentNumber, accessCode, portalUrl }) {
  return [
    labels.greeting,
    labels.intro,
    '',
    `${labels.ref}: ${referenceNumber}`,
    `${labels.student}: ${studentNumber}`,
    `${labels.code}: ${accessCode}`,
    '',
    `${labels.next} ${portalUrl}`,
    '',
    labels.ignore,
    labels.spam
  ].join('\n');
}

/**
 * Taslak kaydedildi e-postasını oluşturur. Geçerli bir dil verilirse yalnızca o dilde konu ve gövde
 * üretir; dil eksik veya geçersizse mevcut beş dilli birleşik gövdeyi ve konuyu döndürür.
 * @param {{referenceNumber: string, studentNumber: string, applicationType: string, portalUrl: string, language?: string|null}} input
 * @returns {{subject: string, text: string}} Mail subject and plain-text body.
 */
export function buildReferenceMail({ referenceNumber, studentNumber, applicationType, portalUrl, language = null }) {
  if (!REFERENCE_PATTERN.test(referenceNumber)) throw new TypeError('Invalid application reference.');
  if (typeof studentNumber !== 'string' || studentNumber.length === 0 || studentNumber.length > 64) {
    throw new TypeError('Invalid student number.');
  }
  const normalizedLanguage = normalizeMailLanguage(language);
  if (normalizedLanguage) {
    const labels = MAIL_TEXT[normalizedLanguage];
    return {
      subject: labels.subject,
      text: formatDraftSection(labels, { referenceNumber, studentNumber, applicationType, portalUrl })
    };
  }
  const sections = Object.values(MAIL_TEXT).map((labels) =>
    formatDraftSection(labels, { referenceNumber, studentNumber, applicationType, portalUrl })
  );
  return {
    subject: DEFAULT_DRAFT_SUBJECT,
    text: sections.join('\n\n---\n\n')
  };
}

/**
 * Erişim kodu kurtarma e-postasını düz metin olarak oluşturur. Geçerli dilde tek dilli, eksik veya
 * geçersiz dilde beş dilli birleşik gövde ve iki dilli konu üretir. Yön işaretçisi (LRM/RLM) eklemez.
 * @param {{referenceNumber: string, studentNumber: string, accessCode: string, portalUrl: string, language?: string|null}} input
 * @returns {{subject: string, text: string}} Konu ve düz metin e-posta gövdesi.
 */
export function buildRecoveryMail({ referenceNumber, studentNumber, accessCode, portalUrl, language = null }) {
  if (!REFERENCE_PATTERN.test(referenceNumber)) throw new TypeError('Invalid application reference.');
  if (typeof studentNumber !== 'string' || studentNumber.length === 0 || studentNumber.length > 64) {
    throw new TypeError('Invalid student number.');
  }
  if (!isValidAccessCodeFormat(accessCode)) throw new TypeError('Invalid access code.');
  if (typeof portalUrl !== 'string' || portalUrl.length === 0) throw new TypeError('Invalid portal URL.');

  const normalizedLanguage = normalizeMailLanguage(language);
  if (normalizedLanguage) {
    const labels = RECOVERY_MAIL_TEXT[normalizedLanguage];
    return {
      subject: labels.subject,
      text: formatRecoverySection(labels, { referenceNumber, studentNumber, accessCode, portalUrl })
    };
  }
  const sections = Object.values(RECOVERY_MAIL_TEXT).map((labels) =>
    formatRecoverySection(labels, { referenceNumber, studentNumber, accessCode, portalUrl })
  );
  return {
    subject: DEFAULT_RECOVERY_SUBJECT,
    text: sections.join('\n\n---\n\n')
  };
}

/**
 * Kayan 24 saatlik pencerede taslak ve kurtarma e-posta kota kullanımını mevcut tablolardan sayar.
 * @param {D1Database} database Cloudflare D1 bağlamı.
 * @param {string} [now] UTC ISO zaman damgası.
 * @returns {Promise<{draftSentCount: number, recoverySentCount: number, totalSentCount: number, draftRemaining: number, recoveryRemaining: number, totalRemaining: number}>}
 */
export async function readMailQuotaStatus(database, now = new Date().toISOString()) {
  const timestampMs = Date.parse(now);
  const cutoff = new Date((Number.isFinite(timestampMs) ? timestampMs : Date.now()) - 24 * 60 * 60 * 1000).toISOString();
  const [draftRow, recoveryRow] = await Promise.all([
    database.prepare(`
      SELECT COUNT(*) AS count
      FROM application_reference_mails
      WHERE status = 'sent'
        AND sent_at IS NOT NULL
        AND datetime(sent_at) >= datetime(?)
    `).bind(cutoff).first(),
    database.prepare(`
      SELECT COUNT(*) AS count
      FROM audit_events
      WHERE event_type = 'application.access_code_recovered'
        AND (json_extract(safe_metadata_json, '$.channel') IS NULL OR json_extract(safe_metadata_json, '$.channel') = 'email')
        AND datetime(created_at) >= datetime(?)
    `).bind(cutoff).first()
  ]);
  const draftSentCount = Number(draftRow?.count || 0);
  const recoverySentCount = Number(recoveryRow?.count || 0);
  const totalSentCount = draftSentCount + recoverySentCount;
  const totalRemaining = Math.max(0, DAILY_TOTAL_MAIL_QUOTA - totalSentCount);
  const draftRemaining = Math.min(totalRemaining, Math.max(0, DAILY_DRAFT_MAIL_QUOTA - draftSentCount));
  const recoveryRemaining = Math.min(totalRemaining, Math.max(0, DAILY_RECOVERY_MAIL_QUOTA - recoverySentCount));
  return {
    draftSentCount,
    recoverySentCount,
    totalSentCount,
    draftRemaining,
    recoveryRemaining,
    totalRemaining
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

function mailFromRow(row, portalUrl, language = null) {
  return buildReferenceMail({
    referenceNumber: row.reference_number,
    studentNumber: row.student_number,
    applicationType: row.application_route === 'transition' ? 'transition' : row.application_type,
    portalUrl,
    language
  });
}

/**
 * Called when an applicant saves a new draft. Queues and sends this application's mail, then retries a
 * few older deferred or failed mails. Any problem is contained so the draft itself still succeeds.
 * @param {object} environment Worker bindings.
 * @param {{applicationId: string, portalUrl: string, language?: string|null, now?: string, fetchImplementation?: Function}} input
 */
export async function sendDraftReferenceMail(environment, { applicationId, portalUrl, language = null, now = new Date().toISOString(), fetchImplementation } = {}) {
  try {
    const config = readReferenceMailConfig(environment);
    const database = environment.DB;
    if (!config || !database || typeof applicationId !== 'string') return;
    const transport = fetchImplementation || environment?.REFERENCE_MAIL_FETCH || fetch;

    const row = await database.prepare(`SELECT a.student_email, a.reference_number, a.application_type, a.application_route, s.student_number
        FROM applications a JOIN students s ON s.id = a.student_id WHERE a.id = ?`).bind(applicationId).first();
    if (!row || !EMAIL_PATTERN.test(row.student_email || '')) return;

    await enqueueReferenceMail(database, applicationId, now);
    const current = await database.prepare('SELECT status FROM application_reference_mails WHERE application_id = ?')
      .bind(applicationId).first();
    if (current?.status === 'sent') return;

    // İlk kayıt e-postaları kayan 24 saatte en fazla 70 gönderim yapar; 30 slot kurtarmaya ayrılır.
    const quota = await readMailQuotaStatus(database, now);
    if (quota.draftRemaining <= 0) {
      await database.prepare(`UPDATE application_reference_mails
          SET status = 'quota_deferred', last_error_code = 'quota', updated_at = ?
          WHERE application_id = ? AND status <> 'sent'`)
        .bind(now, applicationId).run();
      return;
    }

    const outcome = await deliverReferenceMail(database, config, {
      applicationId, recipient: row.student_email, mail: mailFromRow(row, portalUrl, language), now, fetchImplementation: transport
    });
    if (outcome === 'quota_deferred') return;

    let remainingDraftQuota = quota.draftRemaining - (outcome === 'sent' ? 1 : 0);
    if (remainingDraftQuota <= 0) return;

    const retry = await database.prepare(`SELECT m.application_id, a.student_email, a.reference_number, a.application_type, a.application_route, s.student_number
        FROM application_reference_mails m
        JOIN applications a ON a.id = m.application_id
        JOIN students s ON s.id = a.student_id
        WHERE m.status IN ('quota_deferred', 'failed') AND m.attempts < ? AND m.application_id != ?
        ORDER BY m.updated_at LIMIT ?`).bind(MAX_ATTEMPTS, applicationId, Math.min(RETRY_BATCH_SIZE, remainingDraftQuota)).all();
    for (const retryRow of retry.results || []) {
      if (remainingDraftQuota <= 0) break;
      if (!EMAIL_PATTERN.test(retryRow.student_email || '') || !REFERENCE_PATTERN.test(retryRow.reference_number)) continue;
      const retryOutcome = await deliverReferenceMail(database, config, {
        applicationId: retryRow.application_id, recipient: retryRow.student_email,
        mail: mailFromRow(retryRow, portalUrl), now: new Date().toISOString(), fetchImplementation: transport
      });
      if (retryOutcome !== 'sent') break;
      remainingDraftQuota -= 1;
    }
  } catch {
    console.warn('reference_mail_skipped');
  }
}

/**
 * Kurtarma e-postasını gönderir. Gönderim hatasında asla hata fırlatmaz; uç noktanın 202 yanıtını bozmaz.
 * @param {object} environment Worker bağlamı.
 * @param {{recipient: string, referenceNumber: string, studentNumber: string, accessCode: string, portalUrl: string, language?: string|null, fetchImplementation?: Function}} input
 * @returns {Promise<{status: 'sent'|'quota_deferred'|'failed'|'skipped', errorCode: string|null}>}
 */
export async function sendRecoveryReferenceMail(environment, { recipient, referenceNumber, studentNumber, accessCode, portalUrl, language = null, fetchImplementation } = {}) {
  try {
    const config = readReferenceMailConfig(environment);
    if (!config || !EMAIL_PATTERN.test(recipient || '')) {
      return { status: 'skipped', errorCode: config ? 'invalid_recipient' : 'unconfigured' };
    }
    const transport = fetchImplementation || environment?.REFERENCE_MAIL_FETCH || fetch;
    const mail = buildRecoveryMail({ referenceNumber, studentNumber, accessCode, portalUrl, language });
    return await postToMailer(config, { to: recipient, subject: mail.subject, text: mail.text }, transport);
  } catch {
    console.warn('recovery_mail_skipped');
    return { status: 'failed', errorCode: 'network' };
  }
}
