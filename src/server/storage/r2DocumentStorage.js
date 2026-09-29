import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
    return new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey }
    });
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

function createCapabilityGenerator(bucketName, readSigner, now) {
    return async (key, { expiresInSeconds = DEFAULT_SIGNED_ACCESS_SECONDS, contentType } = {}, operation) => {
        assertStorageKey(key);
        const expiry = readExpiry(expiresInSeconds);
        const signingTime = now();
        if (!(signingTime instanceof Date) || Number.isNaN(signingTime.valueOf())) {
            throw new TypeError('Storage clock must return a valid Date.');
        }
        const putType = operation === 'PUT' ? readContentType(contentType) : undefined;
        const command = operation === 'PUT'
            ? new PutObjectCommand({ Bucket: bucketName, Key: key, ContentType: putType })
            : new GetObjectCommand({ Bucket: bucketName, Key: key });
        const url = await getSignedUrl(readSigner(), command, {
            expiresIn: expiry,
            signingDate: signingTime,
            ...(operation === 'PUT' ? { signableHeaders: new Set(['content-type']) } : {})
        });
        return Object.freeze({
            method: operation,
            url,
            expiresAt: new Date(signingTime.valueOf() + expiry * 1000).toISOString(),
            expiresInSeconds: expiry,
            ...(putType ? { requiredHeaders: Object.freeze({ 'content-type': putType }) } : {})
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
    const createCapability = createCapabilityGenerator(bucketName, readSigner, now);

    return Object.freeze({
        createQuarantineKey: () => createQuarantineKey(createId),
        ...createObjectOperations(bucket),
        createUploadCapability: (key, options = {}) => createCapability(key, options, 'PUT'),
        createReadCapability: (key, options = {}) => createCapability(key, options, 'GET')
    });
}
