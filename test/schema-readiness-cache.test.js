import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasPhysicalReceiptSchema } from '../src/server/config/physical-receipt-config.js';
import { hasPhysicalTransferSchema } from '../src/server/config/physical-intake-gate.js';

function createDatabase(readFirst) {
    let queryCount = 0;
    return {
        get queryCount() { return queryCount; },
        prepare(sql) {
            return {
                first: async () => {
                    queryCount += 1;
                    return readFirst(sql);
                }
            };
        }
    };
}

test('physical transfer schema readiness is cached after a successful check', async () => {
    const database = createDatabase(() => ({ name: 'mobile_transfer_rate_limits' }));

    const firstResult = await hasPhysicalTransferSchema({ DB: database });
    const secondResult = await hasPhysicalTransferSchema({ DB: database });

    assert.equal(firstResult, true);
    assert.equal(secondResult, true);
    assert.equal(database.queryCount, 1);
});

test('missing physical transfer schema is checked again after migration', async () => {
    let isReady = false;
    const database = createDatabase(() => isReady ? { name: 'mobile_transfer_rate_limits' } : null);

    const beforeMigration = await hasPhysicalTransferSchema({ DB: database });
    isReady = true;
    const afterMigration = await hasPhysicalTransferSchema({ DB: database });

    assert.equal(beforeMigration, false);
    assert.equal(afterMigration, true);
    assert.equal(database.queryCount, 2);
});

test('physical receipt marker and version are cached after a successful check', async () => {
    const database = createDatabase((sql) => sql.includes('sqlite_master')
        ? { name: 'physical_receipt_schema' }
        : { version: 1 });

    const firstResult = await hasPhysicalReceiptSchema({ DB: database });
    const secondResult = await hasPhysicalReceiptSchema({ DB: database });

    assert.equal(firstResult, true);
    assert.equal(secondResult, true);
    assert.equal(database.queryCount, 2);
});
