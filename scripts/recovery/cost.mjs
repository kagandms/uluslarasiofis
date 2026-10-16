// Public Standard R2 prices checked 2026-10-15. Not a quote or an account invoice.
// https://developers.cloudflare.com/r2/pricing/
export function recoveryCost({ sqlBytes, documentBytes, objects, printBytes, printObjects, remainingFree = { gb: 0, a: 0, b: 0 } }) {
    for (const value of [sqlBytes, documentBytes, objects, printBytes, printObjects, ...Object.values(remainingFree)]) {
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('COST_MEASUREMENTS_REQUIRED');
    }
    const pages = Math.max(1, Math.ceil(objects / 1000)) + Math.max(1, Math.ceil(printObjects / 1000));
    const allObjects = objects + printObjects;
    const gb = 30 * (sqlBytes + documentBytes + printBytes) / 1e9;
    const a = 30 * (allObjects + pages + 2) + allObjects;
    const b = 30 * (2 * allObjects + 2) + 2 * allObjects;
    const storage = Math.ceil(Math.max(0, gb - remainingFree.gb)) * 0.015;
    const operations = Math.ceil(Math.max(0, a - remainingFree.a) / 1e6) * 4.5 + Math.ceil(Math.max(0, b - remainingFree.b) / 1e6) * 0.36;
    return { model: '30-full-daily-copies-and-one-restore', storage_gb_month: gb, class_a: a, class_b: b,
        r2_usd: Number((storage + operations).toFixed(3)),
        assumptions: ['steady state, decimal GB', 'Standard class, no compression or multipart', 'provided remaining free tier only'],
        excluded: ['D1 import/read/write and restore storage', 'GitHub runner minutes', 'tax/FX', 'additional provider/key fees'] };
}

export function estimateInventoryCost(inventory, sqlExpansionFactor, remainingFree) {
    const docs = inventory.buckets?.find(bucket => bucket.binding === 'DOCUMENTS');
    const prints = inventory.buckets?.find(bucket => bucket.binding === 'PRINT_FILES');
    if (inventory.d1?.state !== 'verified' || docs?.metrics?.state !== 'verified'
        || prints?.metrics?.state !== 'verified'
        || !Number.isFinite(sqlExpansionFactor) || sqlExpansionFactor <= 0) throw new Error('COST_INVENTORY_OR_SQL_ASSUMPTION_REQUIRED');
    const sqlBytes = Math.ceil(inventory.d1.value.bytes * sqlExpansionFactor);
    const result = recoveryCost({ sqlBytes, documentBytes: docs.metrics.value.bytes + docs.metrics.value.metadata_bytes,
        objects: docs.metrics.value.objects, printBytes: prints.metrics.value.bytes + prints.metrics.value.metadata_bytes,
        printObjects: prints.metrics.value.objects, ...(remainingFree ? { remainingFree } : {}) });
    return { ...result, sql_expansion_factor_assumed: sqlExpansionFactor,
        warning: 'Metadata-based estimate only; bucket totals include excluded backups; SQL expansion, change rate, multipart and shared free-tier use are not measured.' };
}
