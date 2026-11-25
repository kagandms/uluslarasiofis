import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplicationRepository } from '../src/server/repositories/d1/applicationRepository.js';

function createRecordingDatabase(pageRows, total) {
    const sql = [];
    const texts = [];
    const bindings = [];
    return {
        sql, texts, bindings,
        prepare(text) {
            texts.push(text);
            sql.push(text.includes('COUNT(*)') ? 'count' : 'page');
            const statement = {
                bind: (...args) => {
                    bindings.push(args);
                    return statement;
                },
                all: async () => ({ results: pageRows }),
                first: async () => ({ total_items: total })
            };
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

test('COUNT skips the students join unless a search term needs it', async () => {
    const plain = createRecordingDatabase([{ id: 'a' }, { id: 'b' }], 7);
    await createApplicationRepository(plain).queryStaffApplications(query);
    const plainCount = plain.texts.find((text) => text.includes('COUNT(*)'));
    assert.ok(plainCount && !/JOIN students/.test(plainCount));

    const searched = createRecordingDatabase([{ id: 'a' }, { id: 'b' }], 7);
    await createApplicationRepository(searched).queryStaffApplications({ ...query, searchPattern: '%ada%' });
    const searchedCount = searched.texts.find((text) => text.includes('COUNT(*)'));
    assert.ok(searchedCount && /JOIN students/.test(searchedCount));
});

test('tolerant search uses folded name SQL, keeps code columns literal, and stays well below D1 parameter limits', async () => {
    const singleTokenDb = createRecordingDatabase([{ id: 'a' }, { id: 'b' }], 7);
    await createApplicationRepository(singleTokenDb).queryStaffApplications({
        ...query,
        searchPattern: '%Şahin%',
        searchNameTokens: ['sahin']
    });
    const singlePageSql = singleTokenDb.texts.find((text) => !text.includes('COUNT(*)'));
    assert.match(singlePageSql, /REPLACE\(/);
    assert.match(singlePageSql, /LOWER\(COALESCE\(applications\.first_name, ''\)\)/);
    assert.match(singlePageSql, /COALESCE\(applications\.reference_number, ''\) LIKE \? ESCAPE '\\'/);
    assert.match(singlePageSql, /students\.student_number LIKE \? ESCAPE '\\'/);
    assert.match(singlePageSql, /COALESCE\(applications\.passport_number, ''\) LIKE \? ESCAPE '\\'/);
    // 3 literal code bindings + 4 single-token name bindings + 2 pagination bindings = 9
    assert.equal(singleTokenDb.bindings[0].length, 9);
    assert.deepEqual(singleTokenDb.bindings[0].slice(0, 7), [
        '%Şahin%', '%Şahin%', '%Şahin%', '%sahin%', '%sahin%', '%sahin%', '%sahin%'
    ]);
    // COUNT query binds the 7 search bindings without LIMIT/OFFSET
    assert.equal(singleTokenDb.bindings[1].length, 7);

    const multiTokenDb = createRecordingDatabase([{ id: 'a' }, { id: 'b' }], 7);
    await createApplicationRepository(multiTokenDb).queryStaffApplications({
        ...query,
        searchPattern: '%Çağlar Şahin%',
        searchNameTokens: ['caglar', 'sahin']
    });
    const multiPageSql = multiTokenDb.texts.find((text) => !text.includes('COUNT(*)'));
    assert.match(multiPageSql, /LIKE \? ESCAPE '\\' AND /);
    // 3 literal code bindings + 2 token bindings + 2 pagination bindings = 7
    assert.equal(multiTokenDb.bindings[0].length, 7);
    assert.deepEqual(multiTokenDb.bindings[0].slice(0, 5), [
        '%Çağlar Şahin%', '%Çağlar Şahin%', '%Çağlar Şahin%', '%caglar%', '%sahin%'
    ]);
    assert.equal(multiTokenDb.bindings[1].length, 5);

    const cappedTokenDb = createRecordingDatabase([{ id: 'a' }], 1);
    await createApplicationRepository(cappedTokenDb).queryStaffApplications({
        ...query,
        searchPattern: '%a b c d e f g h%',
        searchNameTokens: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    });
    // 3 literal code bindings + max 6 token bindings + 2 pagination bindings = 11 (<< 100 D1 limit)
    assert.equal(cappedTokenDb.bindings[0].length, 11);
});
