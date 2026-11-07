import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotificationFixture } from './helpers/notification-fixtures.js';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import { recordDraftUpdateAudit } from '../src/server/routes/applicationRoutes.js';

test('draft update audit is written once per window and again after the window', async () => {
    const fixture = await createNotificationFixture();
    const repositories = createD1Repositories(fixture.database);
    const applicationId = fixture.applicationId;
    const count = () => fixture.database.prepare(
        "SELECT COUNT(*) AS n FROM audit_events WHERE application_id = ? AND event_type = 'application.draft_updated'"
    ).bind(applicationId).first().n;
    const input = { applicationId, requestId: 'req_coalesce_a', changedFields: 'phone' };

    assert.equal(await recordDraftUpdateAudit(repositories, input), true);
    assert.equal(await recordDraftUpdateAudit(repositories, input), false);
    assert.equal(await recordDraftUpdateAudit(repositories, input), false);
    assert.equal(count(), 1);

    fixture.database.prepare(
        "UPDATE audit_events SET created_at = datetime('now', '-11 minutes') WHERE application_id = ? AND event_type = 'application.draft_updated'"
    ).bind(applicationId).run();
    assert.equal(await recordDraftUpdateAudit(repositories, input), true);
    assert.equal(count(), 2);
});
