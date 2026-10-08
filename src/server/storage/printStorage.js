import { AwsClient } from 'aws4fetch';
import { ApiError } from '../domain/errors.js';

const PRINT_KEY_PATTERN = /^print\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CAPABILITY_SECONDS = 300;

function assertPrintKey(key) {
    if (typeof key !== 'string' || !PRINT_KEY_PATTERN.test(key)) throw new TypeError('Invalid print storage key.');
}

function createSigner(config) {
    if (!config.accountId || !config.bucketName || !config.accessKeyId || !config.secretAccessKey) {
        throw new ApiError(503, 'PRINT_UNAVAILABLE', 'Yazdırma hizmeti şu anda kullanılamıyor.', true);
    }
    return new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: 's3', region: 'auto' });
}

export function createPrintStorage(bucket, config = {}) {
    if (!bucket) throw new TypeError('A private print bucket binding is required.');
    let signer;
    const readSigner = () => signer || (signer = createSigner(config));

    return Object.freeze({
        async createUploadCapability(key, { contentType, expiresInSeconds = MAX_CAPABILITY_SECONDS }) {
            assertPrintKey(key);
            if (!['application/pdf', 'image/jpeg', 'image/png'].includes(contentType)) throw new TypeError('Unsupported print content type.');
            if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 30 || expiresInSeconds > MAX_CAPABILITY_SECONDS) {
                throw new TypeError('Invalid print capability lifetime.');
            }
            const url = new URL(`https://${config.accountId}.r2.cloudflarestorage.com`);
            url.pathname = `/${config.bucketName}/${key}`;
            url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
            const request = new Request(url, { method: 'PUT', headers: { 'content-type': contentType, 'if-none-match': '*' } });
            const signed = await readSigner().sign(request, { aws: { signQuery: true, allHeaders: true } });
            return { url: signed.url, method: 'PUT', expiresInSeconds,
                requiredHeaders: { 'Content-Type': contentType, 'If-None-Match': '*' } };
        },
        head(key) {
            assertPrintKey(key);
            return bucket.head(key);
        },
        get(key) {
            assertPrintKey(key);
            return bucket.get(key);
        },
        async delete(key) {
            assertPrintKey(key);
            await bucket.delete(key);
        }
    });
}
