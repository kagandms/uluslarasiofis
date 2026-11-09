import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplicationRepository } from '../src/server/repositories/d1/applicationRepository.js';

function createRecordingDatabase(pageRows, total) {
    const sql = [];
    return {
        sql,
        prepare(text) {
            sql.push(text.includes('COUNT(*)') ? 'count' : 'page');
            const statement = { bind: () => statement,
                all: async () => ({ results: pageRows }), first: async () => ({ total_items: total }) };
            return statement;
        }
    };
}
const query = { statuses: null, pageSize: 2, offset: 0 };

test('a short first page reports its own length and skips the COUNT scan', async () => {
    const database = createRecordingDatabase([{ id: 'a' }], 99);
    const result = await createApplicationRepository(database).queryStaffApplications(query);
    assert.equal(result.totalItems, 1);
    assert.deepEqual(database.sql, ['page']);
});

test('a full page runs COUNT once and reuses it for the same filter within the cache window', async () => {
    const database = createRecordingDatabase([{ id: 'a' }, { id: 'b' }], 7);
    const repository = createApplicationRepository(database);
    assert.equal((await repository.queryStaffApplications(query)).totalItems, 7);
    assert.equal((await repository.queryStaffApplications(query)).totalItems, 7);
    assert.deepEqual(database.sql, ['page', 'count', 'page']);
    assert.equal((await repository.queryStaffApplications({ ...query, offset: 2 })).totalItems, 7);
    assert.equal(database.sql.filter((entry) => entry === 'count').length, 1);
});
