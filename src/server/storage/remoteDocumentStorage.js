import { AwsClient } from 'aws4fetch';
import { assertStorageKey, createQuarantineKey } from './r2DocumentStorage.js';
import { decryptObject, encryptObject, ENCRYPTION_OVERHEAD_BYTES } from './encryptedObject.js';

const CONTENT_TYPE_METADATA = 'x-amz-meta-goc-content-type';
const STORED_CONTENT_TYPE = 'application/octet-stream';

function createStorageError(message, code) {
    const error = new Error(message);
    error.name = 'DocumentStorageError';
    error.code = code;
    return error;
}

function normalizeEtag(value) {
    return typeof value === 'string' ? value.replace(/^W\//, '').replace(/^"|"$/g, '') : '';
}

async function readBytes(body) {
    if (body instanceof Uint8Array) return body;
    return new Uint8Array(await new Response(body).arrayBuffer());
}

function failFromStatus(status, s3Code) {
    if (status === 401 || status === 403) {
        const error = createStorageError('Document store rejected the credentials.', 'STORAGE_CONFIGURATION_ERROR');
        // The S3 error code (for example SignatureDoesNotMatch) is not secret and tells operators why the request was refused.
        if (s3Code) error.s3Code = s3Code;
        throw error;
    }
    throw createStorageError('Document store is unavailable.', 'STORAGE_UNAVAILABLE');
}

async function readS3Code(response) {
    const text = await response.text().catch(() => '');
    return /<Code>([A-Za-z]{3,64})<\/Code>/.exec(text)?.[1];
}

/**
 * Creates a document storage adapter that keeps AES-256-GCM encrypted objects on an S3-compatible host.
 * The host (for example SeaweedFS on an office PC behind a tunnel) never receives the encryption key or plaintext.
 * It exposes the same object operations as the R2 adapter. Browser-signed uploads are not supported:
 * uploads must pass through the Worker, which encrypts before writing.
 * @param {object} configuration Endpoint, bucket, S3 credentials, keyring and optional fetcher for tests or a Worker binding.
 * @returns {object} Provider-neutral private storage operations.
 */
export function createRemoteDocumentStorage(configuration = {}) {
    const { endpoint, bucketName, accessKeyId, secretAccessKey, keyring } = configuration;
    const fetcher = configuration.fetcher || ((request) => fetch(request));
    const region = configuration.region || 'us-east-1';
    const createId = configuration.createId || (() => crypto.randomUUID());
    if (typeof endpoint !== 'string' || !/^https?:\/\/[^/\s]+$/.test(endpoint) || typeof bucketName !== 'string' || !bucketName
        || ![accessKeyId, secretAccessKey].every((value) => typeof value === 'string' && value.trim()) || !keyring?.keys) {
        throw createStorageError('Remote document storage configuration is unavailable.', 'STORAGE_CONFIGURATION_ERROR');
    }
    const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region });

    async function send(method, key, { headers = {}, body } = {}) {
        assertStorageKey(key);
        try {
            const signed = await client.sign(`${endpoint}/${bucketName}/${key}`, { method, headers, body });
            return await fetcher(signed);
        } catch {
            throw createStorageError('Document store is unreachable.', 'STORAGE_UNAVAILABLE');
        }
    }

    async function failFrom(response, key, method) {
        let s3Code;
        if (response.status === 401 || response.status === 403) {
            try {
                // A HEAD response has no body, so the reason is read from a one-byte GET issued only on failure.
                const source = method === 'HEAD' ? await send('GET', key, { headers: { range: 'bytes=0-0' } }) : response;
                s3Code = await readS3Code(source);
            } catch {
                s3Code = undefined;
            }
        }
        failFromStatus(response.status, s3Code);
    }

    async function write(key, body, contentType, conditional) {
        const plaintext = await readBytes(body);
        const sealed = await encryptObject({ keyring, storageKey: key, plaintext });
        const response = await send('PUT', key, {
            headers: {
                'content-type': STORED_CONTENT_TYPE,
                [CONTENT_TYPE_METADATA]: contentType,
                ...(conditional ? { 'if-none-match': '*' } : {})
            },
            body: sealed
        });
        if (response.status === 412 && conditional) return null;
        if (!response.ok) await failFrom(response, key, 'PUT');
        return { key, size: plaintext.byteLength, etag: normalizeEtag(response.headers.get('etag')) };
    }

    function describe(key, response) {
        const stored = Number(response.headers.get('content-length'));
        if (!Number.isSafeInteger(stored) || stored < ENCRYPTION_OVERHEAD_BYTES) {
            throw createStorageError('Stored object has an invalid size.', 'STORAGE_OBJECT_INVALID');
        }
        return {
            key,
            size: stored - ENCRYPTION_OVERHEAD_BYTES,
            etag: normalizeEtag(response.headers.get('etag')),
            httpMetadata: { contentType: response.headers.get(CONTENT_TYPE_METADATA) || undefined }
        };
    }

    return Object.freeze({
        createQuarantineKey: () => createQuarantineKey(createId),
        async put(key, body, contentType) {
            return write(key, body, contentType, false);
        },
        async putIfAbsent(key, body, contentType) {
            // The host may ignore If-None-Match, so an existing object is also checked first.
            const existing = await send('HEAD', key);
            if (existing.ok) return null;
            if (existing.status !== 404) await failFrom(existing, key, 'HEAD');
            return write(key, body, contentType, true);
        },
        async head(key) {
            const response = await send('HEAD', key);
            if (response.status === 404) return null;
            if (!response.ok) await failFrom(response, key, 'HEAD');
            return describe(key, response);
        },
        async get(key, options = {}) {
            const response = await send('GET', key, {
                headers: options.etagMatches ? { 'if-match': `"${normalizeEtag(options.etagMatches)}"` } : {}
            });
            if (response.status === 404 || response.status === 412) return null;
            if (!response.ok) await failFrom(response, key, 'GET');
            const description = describe(key, { headers: new Headers({
                'content-length': String(Number(response.headers.get('content-length')) || 0),
                etag: response.headers.get('etag') || '',
                [CONTENT_TYPE_METADATA]: response.headers.get(CONTENT_TYPE_METADATA) || ''
            }) });
            const plaintext = await decryptObject({
                keyring, storageKey: key, data: new Uint8Array(await response.arrayBuffer())
            });
            return {
                ...description,
                size: plaintext.byteLength,
                body: new Response(plaintext).body,
                arrayBuffer: async () => plaintext.slice().buffer,
                text: async () => new TextDecoder().decode(plaintext)
            };
        },
        async delete(key) {
            const response = await send('DELETE', key);
            if (!response.ok && response.status !== 404) await failFrom(response, key, 'DELETE');
        },
        async deleteMany(keys) {
            for (const key of keys) {
                const response = await send('DELETE', key);
                if (!response.ok && response.status !== 404) await failFrom(response, key, 'DELETE');
            }
        },
        async createUploadCapability() {
            throw createStorageError('Remote storage does not issue browser upload URLs; upload through the Worker.', 'UNSUPPORTED_CAPABILITY');
        },
        async createWriteOnceUploadCapability() {
            throw createStorageError('Remote storage does not issue browser upload URLs; upload through the Worker.', 'UNSUPPORTED_CAPABILITY');
        },
        async createReadCapability() {
            throw createStorageError('Remote storage does not issue read URLs; read through the Worker.', 'UNSUPPORTED_CAPABILITY');
        }
    });
}
