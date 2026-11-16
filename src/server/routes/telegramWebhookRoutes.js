import { errorResponse, jsonResponse } from '../http/apiResponse.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import {
    RECOVERY_APPLICATION_DAILY_LIMIT,
    RECOVERY_TELEGRAM_USER_DAILY_LIMIT,
    findRecoverableApplication,
    rotateAccessCodeForRecovery
} from '../services/accessRecoveryService.js';
import { createTelegramRecoveryBot, normalizeTelegramPhone } from '../services/telegramBot.js';

const encoder = new TextEncoder();
const TELEGRAM_API_ORIGIN = 'https://api.telegram.org';
const TELEGRAM_REQUEST_TIMEOUT_MS = 5_000;
export const MAX_TELEGRAM_WEBHOOK_BYTES = 256 * 1024;

function constantTimeEqualBytes(left, right) {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return false;
    if (left.length !== right.length) return false;
    if (typeof crypto?.subtle?.timingSafeEqual === 'function') {
        return crypto.subtle.timingSafeEqual(left, right);
    }
    let mismatch = 0;
    for (let index = 0; index < left.length; index += 1) {
        mismatch |= left[index] ^ right[index];
    }
    return mismatch === 0;
}

/**
 * Hata ve günlük iletilerindeki Telegram bot belirteci ve gizli anahtarları maskeler.
 * @param {unknown} value Temizlenecek metin.
 * @param {string[]} [secrets] Maskelenecek gizli dizgeler.
 * @returns {string} Gizli değerlerden arındırılmış metin.
 */
export function redactTelegramSecrets(value, secrets = []) {
    let text = typeof value === 'string' ? value : String(value ?? '');
    text = text.replace(/\/bot[^/\s?#"']+/gi, '/bot[REDACTED]');
    text = text.replace(/\bbot\d{5,20}:[A-Za-z0-9_-]{10,}/g, 'bot[REDACTED]');
    for (const secret of secrets) {
        if (typeof secret !== 'string' || secret.length === 0) continue;
        text = text.split(secret).join('[REDACTED]');
        const encoded = encodeURIComponent(secret);
        if (encoded && encoded !== secret) {
            text = text.split(encoded).join('[REDACTED]');
        }
    }
    return text;
}

/**
 * `X-Telegram-Bot-Api-Secret-Token` başlığını yapılandırılmış gizli anahtarla sabit zamanda doğrular.
 * @param {unknown} expectedSecret Beklenen webhook gizli anahtarı.
 * @param {unknown} providedToken İstek başlığından gelen belirteç.
 * @returns {Promise<boolean>} Doğrulama sonucu.
 */
export async function verifyTelegramWebhookSecret(expectedSecret, providedToken) {
    if (typeof expectedSecret !== 'string' || expectedSecret.length === 0) return false;
    if (typeof providedToken !== 'string' || providedToken.length === 0) return false;
    // Değişken uzunluklu gizli anahtarlarda uzunluk sızmasını önlemek için SHA-256 özetleri karşılaştırılır.
    const [expectedDigest, actualDigest] = await Promise.all([
        crypto.subtle.digest('SHA-256', encoder.encode(expectedSecret)),
        crypto.subtle.digest('SHA-256', encoder.encode(providedToken))
    ]);
    return constantTimeEqualBytes(new Uint8Array(expectedDigest), new Uint8Array(actualDigest));
}

/**
 * Telegram Bot API `sendMessage` uç noktasına belirteç sızdırmadan istek atan göndericiyi oluşturur.
 * @param {{botToken: string, fetchImplementation?: Function, extraSecrets?: string[]}} options
 * @returns {(payload: object) => Promise<object>}
 */
export function createTelegramMessageSender({ botToken, fetchImplementation = fetch, extraSecrets = [] }) {
    if (typeof botToken !== 'string' || botToken.trim().length === 0 || /[\s/?#]/.test(botToken)) {
        throw new Error('Telegram bot yapılandırması geçersiz.');
    }
    if (typeof fetchImplementation !== 'function') {
        throw new TypeError('fetchImplementation function is required.');
    }
    const secrets = [botToken, ...extraSecrets].filter((item) => typeof item === 'string' && item.length > 0);
    const endpoint = `${TELEGRAM_API_ORIGIN}/bot${botToken}/sendMessage`;

    return async function sendTelegramMessage(payload) {
        const requestOptions = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        };
        if (typeof AbortSignal?.timeout === 'function') {
            requestOptions.signal = AbortSignal.timeout(TELEGRAM_REQUEST_TIMEOUT_MS);
        }

        let response;
        try {
            response = await fetchImplementation(endpoint, requestOptions);
        } catch (error) {
            const safeMessage = redactTelegramSecrets(error?.message || 'network_error', secrets);
            throw new Error(`Telegram API isteği başarısız: ${safeMessage}`);
        }

        if (!response?.ok) {
            throw new Error(`Telegram API HTTP ${response?.status ?? 'unknown'} hatası döndürdü.`);
        }
        const body = await response.json().catch(() => null);
        if (body && body.ok === false) {
            throw new Error('Telegram API mesajı reddetti.');
        }
        return body?.result ?? { ok: true };
    };
}

async function readBoundedWebhookJson(request) {
    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_TELEGRAM_WEBHOOK_BYTES) {
        throw new Error('Telegram webhook gövdesi sınırın üzerinde.');
    }
    if (!request.body) {
        throw new Error('Telegram webhook gövdesi boş.');
    }
    const reader = request.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > MAX_TELEGRAM_WEBHOOK_BYTES) {
                await reader.cancel();
                throw new Error('Telegram webhook gövdesi sınırın üzerinde.');
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    const parsed = JSON.parse(new TextDecoder().decode(body));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Telegram webhook JSON nesnesi geçersiz.');
    }
    return parsed;
}

function resolveRecoveryFunctions(deps, environment) {
    if (typeof deps?.findRecoverableApplication === 'function'
        && typeof deps?.rotateAccessCodeForRecovery === 'function') {
        return {
            findRecoverableApplication: deps.findRecoverableApplication,
            rotateAccessCodeForRecovery: deps.rotateAccessCodeForRecovery
        };
    }
    if (environment?.ACCESS_RECOVERY_SERVICE) {
        return environment.ACCESS_RECOVERY_SERVICE;
    }
    return {
        findRecoverableApplication: deps?.findRecoverableApplication ?? findRecoverableApplication,
        rotateAccessCodeForRecovery: deps?.rotateAccessCodeForRecovery ?? rotateAccessCodeForRecovery
    };
}

/**
 * Telegram Bot API webhook isteklerini doğrular ve kurtarma botuna iletir.
 * @param {Request} request Gelen Worker HTTP isteği.
 * @param {object} environment Worker ortam bağlamları ve gizli anahtarlar.
 * @param {string} [requestId] İstek izleme kimliği.
 * @param {object} [deps] Testler ve modüler bağlama için isteğe bağlı bağımlılıklar.
 * @returns {Promise<Response>} HTTP yanıtı.
 */
export async function handleTelegramWebhook(request, environment, requestId = '', deps = {}) {
    if (request.method !== 'POST') {
        return errorResponse(requestId, 405, 'METHOD_NOT_ALLOWED', 'Bu istek yöntemi desteklenmiyor.');
    }

    const webhookSecret = environment?.TELEGRAM_WEBHOOK_SECRET;
    const botToken = environment?.TELEGRAM_BOT_TOKEN;
    const hasWebhookSecret = typeof webhookSecret === 'string' && webhookSecret.trim().length > 0;
    const needsBotToken = !deps?.bot && typeof deps?.sendTelegramMessage !== 'function';
    const hasBotToken = typeof botToken === 'string' && botToken.trim().length > 0 && !/[\s/?#]/.test(botToken);

    if (!hasWebhookSecret || (needsBotToken && !hasBotToken)) {
        return errorResponse(requestId, 503, 'WEBHOOK_NOT_CONFIGURED', 'Telegram webhook yapılandırılmadı.', true);
    }

    const providedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    const isAuthorized = await verifyTelegramWebhookSecret(webhookSecret, providedSecret);
    if (!isAuthorized) {
        return errorResponse(requestId, 401, 'WEBHOOK_UNAUTHORIZED', 'Webhook doğrulaması başarısız.');
    }

    const secretsToRedact = [webhookSecret, botToken].filter((item) => typeof item === 'string' && item.length > 0);
    try {
        const update = await readBoundedWebhookJson(request);
        let bot = deps?.bot;
        if (!bot) {
            const recoveryFunctions = resolveRecoveryFunctions(deps, environment);
            const sendTelegramMessage = typeof deps?.sendTelegramMessage === 'function'
                ? deps.sendTelegramMessage
                : createTelegramMessageSender({
                    botToken,
                    fetchImplementation: deps?.fetch || globalThis.fetch,
                    extraSecrets: secretsToRedact
                });
            const rateLimiter = deps?.rateLimiter
                || (environment?.DB && typeof environment.DB.prepare === 'function'
                    ? createD1Repositories(environment.DB).rateLimits
                    : undefined);
            bot = createTelegramRecoveryBot({
                findRecoverableApplication: recoveryFunctions.findRecoverableApplication,
                rotateAccessCodeForRecovery: recoveryFunctions.rotateAccessCodeForRecovery,
                sendTelegramMessage,
                rateLimiter,
                normalizePhone: deps?.normalizePhone ?? normalizeTelegramPhone,
                userDailyLimit: deps?.userDailyLimit ?? RECOVERY_TELEGRAM_USER_DAILY_LIMIT,
                applicationDailyLimit: deps?.applicationDailyLimit ?? RECOVERY_APPLICATION_DAILY_LIMIT,
                stateSecret: webhookSecret,
                now: deps?.now
            });
        }

        await bot.handleUpdate(environment?.DB ?? null, update, {
            requestId,
            stateSecret: webhookSecret
        });
    } catch (error) {
        console.error('Telegram webhook processing failed.', {
            requestId,
            errorName: error?.name || 'Error',
            message: redactTelegramSecrets(error?.message || 'unknown_error', secretsToRedact)
        });
    }

    // Geçerli gizli anahtara sahip isteklerde Telegram'ın sonsuz yeniden denemesini önlemek için her zaman 200 dönülür.
    return jsonResponse({ ok: true }, 200, requestId);
}
