import { AwsClient } from 'aws4fetch';

const STORAGE_KEY_PATTERN = /^quarantine\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MIN_SIGNED_ACCESS_SECONDS = 30;
export const MAX_SIGNED_ACCESS_SECONDS = 300;
export const DEFAULT_SIGNED_ACCESS_SECONDS = MAX_SIGNED_ACCESS_SECONDS;

function createStorageError(message, code) {
    const error = new Error(message);
    error.name = 'DocumentStorageError';
    error.code = code;
    return error;
}

function redactSigningText(value, sensitiveValues) {
    if (typeof value !== 'string') return '';
    let safeText = value.replace(/https?:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]');
    safeText = safeText.replace(/([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=)[^&\s"'<>]+/gi, '$1[REDACTED]');
    for (const sensitiveValue of sensitiveValues) {
        if (typeof sensitiveValue !== 'string' || !sensitiveValue) continue;
        for (const candidate of [sensitiveValue, encodeURIComponent(sensitiveValue)]) {
            safeText = safeText.split(candidate).join('[REDACTED]');
        }
    }
    return safeText;
}

/**
 * Wraps a signing error with safe internal diagnostics for the Worker log.
 * @param {unknown} cause Original signing error.
 * @param {string} stage AwsClient, requestConstruction, or sign.
 * @param {string[]} sensitiveValues Signing values to remove from diagnostic text.
 * @returns {Error} Internal error with redacted signing-stage diagnostics.
 */
export function createStorageSigningFailure(cause, stage, sensitiveValues = []) {
    const errorName = typeof cause?.name === 'string' ? cause.name : 'UnknownError';
    const errorCode = typeof cause?.code === 'string' || typeof cause?.code === 'number'
        ? String(cause.code)
        : '';
    const failure = new Error('R2 document capability signing failed.');
    failure.name = errorName;
    if (errorCode) failure.code = redactSigningText(errorCode, sensitiveValues);
    failure.storageSigningDiagnostics = Object.freeze({
        storageSigningStage: stage,
        errorName: redactSigningText(errorName, sensitiveValues),
        errorCode: redactSigningText(errorCode, sensitiveValues),
        errorMessage: redactSigningText(cause?.message, sensitiveValues),
        errorStack: redactSigningText(cause?.stack, sensitiveValues)
    });
    return failure;
}

function assertStorageKey(key) {
    if (typeof key === 'string' && STORAGE_KEY_PATTERN.test(key)) return;
    throw createStorageError('Storage key is outside the private quarantine namespace.', 'INVALID_STORAGE_KEY');
}

function readExpiry(expiresInSeconds) {
    if (!Number.isInteger(expiresInSeconds)
        || expiresInSeconds < MIN_SIGNED_ACCESS_SECONDS
        || expiresInSeconds > MAX_SIGNED_ACCESS_SECONDS) {
        throw createStorageError('Signed access expiry must be between 30 and 300 seconds.', 'INVALID_CAPABILITY_EXPIRY');
    }
    return expiresInSeconds;
}

function readContentType(contentType) {
    if (typeof contentType === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(contentType)) return contentType;
    throw createStorageError('A valid content type is required for an upload capability.', 'INVALID_CONTENT_TYPE');
}

function createSigner(configuration) {
    const { accountId, bucketName, accessKeyId, secretAccessKey } = configuration;
    const isValidAccountId = typeof accountId === 'string' && /^[0-9a-f]{32}$/i.test(accountId);
    const isValidBucketName = typeof bucketName === 'string' && /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(bucketName);
    if (!isValidAccountId || !isValidBucketName
        || ![accessKeyId, secretAccessKey].every((value) => typeof value === 'string' && value.trim())) {
        throw createStorageError('R2 signing configuration is unavailable.', 'STORAGE_SIGNING_CONFIGURATION_ERROR');
    }
    return new AwsClient({
        service: 's3',
        region: 'auto',
        accessKeyId,
        secretAccessKey
    });
}

function formatSigningDate(date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function createObjectUrl(accountId, bucketName, key) {
    const url = new URL(`https://${accountId}.r2.cloudflarestorage.com`);
    url.pathname = `/${bucketName}/${key}`;
    return url;
}

function createQuarantineKey(createId) {
    const id = createId();
    if (typeof id !== 'string' || !/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(id)) {
        throw new TypeError('Storage key generator must return a UUID.');
    }
    return `quarantine/${id}`;
}

function createObjectOperations(bucket) {
    return {
        async put(key, body, contentType) {
            assertStorageKey(key);
            return bucket.put(key, body, { httpMetadata: { contentType } });
        },
        async get(key) {
            assertStorageKey(key);
            return bucket.get(key);
        },
        async head(key) {
            assertStorageKey(key);
            return bucket.head(key);
        },
        async delete(key) {
            assertStorageKey(key);
            return bucket.delete(key);
        }
    };
}

function createCapabilityGenerator(accountId, bucketName, readSigner, now, signingValues) {
    return async (key, options = {}, operation, writeOnce = false) => {
        const { expiresInSeconds = DEFAULT_SIGNED_ACCESS_SECONDS, contentType } = options;
        assertStorageKey(key);
        const expiry = readExpiry(expiresInSeconds);
        const signingTime = now();
        if (!(signingTime instanceof Date) || Number.isNaN(signingTime.valueOf())) {
            throw new TypeError('Storage clock must return a valid Date.');
        }
        const putType = operation === 'PUT' ? readContentType(contentType) : undefined;
        const conditionalHeader = operation === 'PUT' && writeOnce ? { 'if-none-match': '*' } : {};
        let stage = 'AwsClient';
        let signedRequest;
        try {
            const signer = readSigner();
            stage = 'requestConstruction';
            const url = createObjectUrl(accountId, bucketName, key);
            url.searchParams.set('X-Amz-Expires', String(expiry));
            const request = new Request(url, {
                method: operation,
                ...(putType ? { headers: { 'content-type': putType, ...conditionalHeader } } : {})
            });
            stage = 'sign';
            signedRequest = await signer.sign(request, {
                aws: {
                    signQuery: true,
                    allHeaders: true,
                    datetime: formatSigningDate(signingTime)
                }
            });
        } catch (error) {
            throw createStorageSigningFailure(error, stage, signingValues);
        }
        return Object.freeze({
            method: operation,
            url: signedRequest.url,
            expiresAt: new Date(signingTime.valueOf() + expiry * 1000).toISOString(),
            expiresInSeconds: expiry,
            ...(putType ? { requiredHeaders: Object.freeze({ 'content-type': putType, ...conditionalHeader }) } : {})
        });
    };
}

/**
 * Creates a private R2 adapter with provider-neutral object and capability operations.
 * @param {R2Bucket} bucket Private R2 bucket binding available only to the Worker.
 * @param {object} [configuration] Server-only signing credentials and deterministic test hooks.
 * @returns {object} Private storage operations and short-lived upload/read capabilities.
 */
export function createR2DocumentStorage(bucket, configuration = {}) {
    if (!bucket) throw new TypeError('A private R2 bucket binding is required.');
    const { accountId, bucketName, accessKeyId, secretAccessKey } = configuration;
    const createId = configuration.createId || (() => crypto.randomUUID());
    const now = configuration.now || (() => new Date());
    let signer;
    const readSigner = () => signer || (signer = createSigner({ accountId, bucketName, accessKeyId, secretAccessKey }));
    const createCapability = createCapabilityGenerator(accountId, bucketName, readSigner, now, [accessKeyId, secretAccessKey]);

    return Object.freeze({
        createQuarantineKey: () => createQuarantineKey(createId),
        ...createObjectOperations(bucket),
        createUploadCapability: (key, options = {}) => createCapability(key, options, 'PUT'),
        createWriteOnceUploadCapability: (key, options = {}) => createCapability(key, options, 'PUT', true),
        createReadCapability: (key, options = {}) => createCapability(key, options, 'GET')
    });
}
