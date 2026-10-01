import assert from 'node:assert/strict';
import { test } from 'node:test';
import { putStudentDocumentDirect } from '../src/public/applicationApi.js';

class FakeXmlHttpRequest {
    constructor({ status = 200, outcome = 'load' } = {}) {
        this.status = status;
        this.outcome = outcome;
        this.listeners = new Map();
        this.headers = {};
        this.upload = { addEventListener: (name, callback) => this.listeners.set(`upload:${name}`, callback) };
    }

    addEventListener(name, callback) { this.listeners.set(name, callback); }
    open(method, url, isAsync) { this.method = method; this.url = url; this.isAsync = isAsync; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) {
        this.body = body;
        this.listeners.get('upload:progress')?.({ lengthComputable: true, loaded: 3, total: 4 });
        if (this.outcome === 'load') this.listeners.get('load')?.();
        if (this.outcome === 'error') this.listeners.get('error')?.();
        if (this.outcome === 'timeout') this.listeners.get('timeout')?.();
    }
    abort() { this.listeners.get('abort')?.(); }
}

function createFactory(options) {
    const instances = [];
    return class extends FakeXmlHttpRequest {
        constructor() { super(options); instances.push(this); }
        static get instances() { return instances; }
    };
}

test('direct R2 upload uses signed headers including write-once conditions and reports progress', async () => {
    const progress = [];
    const file = { name: 'passport.pdf', size: 4 };
    const requestClass = createFactory({ status: 200 });

    await putStudentDocumentDirect({ method: 'PUT', url: 'https://signed-capability.invalid', required_headers: {
        'content-type': 'application/pdf', 'if-none-match': '*'
    } }, file, {
        XMLHttpRequestClass: requestClass, onProgress: (value) => progress.push(value)
    });
    const request = requestClass.instances.at(-1);

    assert.equal(request.method, 'PUT');
    assert.equal(request.isAsync, true);
    assert.equal(request.headers['content-type'], 'application/pdf');
    assert.equal(request.headers['if-none-match'], '*');
    assert.equal(request.withCredentials, false);
    assert.equal(request.body, file);
    assert.deepEqual(progress, [75, 100]);
});

test('direct upload maps capability expiry, network failure, timeout and cancellation to safe codes', async () => {
    const base = { method: 'PUT', url: 'https://signed-capability.invalid', required_headers: {} };
    const file = { size: 1 };

    await assert.rejects(putStudentDocumentDirect(base, file, { XMLHttpRequestClass: createFactory({ status: 403 }) }), { code: 'UPLOAD_CAPABILITY_EXPIRED' });
    await assert.rejects(putStudentDocumentDirect(base, file, { XMLHttpRequestClass: createFactory({ outcome: 'error' }) }), { code: 'UPLOAD_NETWORK_ERROR' });
    await assert.rejects(putStudentDocumentDirect(base, file, { XMLHttpRequestClass: createFactory({ outcome: 'timeout' }) }), { code: 'UPLOAD_TIMEOUT' });
    const controller = new AbortController();
    const pending = putStudentDocumentDirect(base, file, { XMLHttpRequestClass: createFactory({ outcome: 'pending' }), signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { code: 'UPLOAD_CANCELLED' });
});
