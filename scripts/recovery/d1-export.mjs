import assert from 'node:assert/strict';
import { approveOperation } from './operations.mjs';

// Future approved backup adapter. Never called by the inventory or synthetic paths.
// request/download are injected to keep account auth away from signed download URLs.
export async function exportFullD1Sql(policy, source, request, download) {
    approveOperation(policy, source, 'backup');
    let bookmark;
    for (let attempt = 0; attempt < 90; attempt++) {
        const result = await request(`/accounts/${source.account_id}/d1/database/${source.database_id}/export`, {
            method: 'POST', body: { output_format: 'polling', dump_options: { no_data: false, no_schema: false },
                ...(bookmark ? { current_bookmark: bookmark } : {}) }
        });
        assert.equal(result.success, true, 'SQL export unavailable.');
        if (result.status === 'complete') {
            const url = new URL(result.result?.signed_url);
            assert.equal(url.protocol, 'https:'); assert.equal(url.port, '');
            assert.ok(url.hostname.endsWith('.r2.cloudflarestorage.com') && !url.username && !url.password, 'Unreviewed SQL download host.');
            // No API Authorization header, URL log, redirect following or public artifact.
            return download(url, { method: 'GET', redirect: 'error', headers: {} });
        }
        assert.notEqual(result.status, 'error'); assert.ok(result.at_bookmark);
        bookmark = result.at_bookmark;
        // The transport supplies bounded polling delay; no tight-loop or secret-bearing errors.
        await request.wait(2000);
    }
    throw new Error('SQL export timed out.');
}
