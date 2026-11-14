import test from 'node:test';
import assert from 'node:assert/strict';
import { assetContentTypes } from '../scripts/ci/worker-upload.mjs';

test('worker asset upload content types include .xml and preserve existing entries', () => {
    assert.equal(assetContentTypes['.xml'], 'application/xml');
    assert.equal(assetContentTypes['.html'], 'text/html');
    assert.equal(assetContentTypes['.json'], 'application/json');
    assert.equal(assetContentTypes['.txt'], 'text/plain');
    assert.equal(assetContentTypes['.js'], 'application/javascript');
    assert.equal(assetContentTypes['.svg'], 'image/svg+xml');
    assert.equal(assetContentTypes['.wasm'], 'application/wasm');
});
