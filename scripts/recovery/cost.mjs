// Public Standard R2 prices checked 2026-10-15. Not a quote or an account invoice.
// https://developers.cloudflare.com/r2/pricing/
export function recoveryCost({ sqlBytes, documentBytes, objects, remainingFree = { gb: 0, a: 0, b: 0 } }) {
    for (const value of [sqlBytes, documentBytes, objects, ...Object.values(remainingFree)]) {
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('COST_MEASUREMENTS_REQUIRED');
    }
    const pages = Math.ceil(objects / 1000);
    const gb = 30 * (sqlBytes + documentBytes) / 1e9;
    const a = 30 * (objects + pages + 2) + objects;
    const b = 30 * (2 * objects + 2) + 2 * objects;
    const storage = Math.ceil(Math.max(0, gb - remainingFree.gb)) * 0.015;
    const operations = Math.ceil(Math.max(0, a - remainingFree.a) / 1e6) * 4.5 + Math.ceil(Math.max(0, b - remainingFree.b) / 1e6) * 0.36;
    return { model: '30-full-daily-copies-and-one-restore', storage_gb_month: gb, class_a: a, class_b: b,
        r2_usd: Number((storage + operations).toFixed(3)),
        assumptions: ['steady state, decimal GB', 'Standard class, no compression or multipart', 'provided remaining free tier only'],
        excluded: ['D1 import/read/write and restore storage', 'GitHub runner minutes', 'tax/FX', 'additional provider/key fees'] };
}

export function estimateInventoryCost(inventory, sqlExpansionFactor, remainingFree) {
    const docs = inventory.buckets?.find(bucket => bucket.binding === 'DOCUMENTS');
    if (inventory.d1?.state !== 'verified' || docs?.metrics?.state !== 'verified'
        || !Number.isFinite(sqlExpansionFactor) || sqlExpansionFactor <= 0) throw new Error('COST_INVENTORY_OR_SQL_ASSUMPTION_REQUIRED');
    const sqlBytes = Math.ceil(inventory.d1.value.bytes * sqlExpansionFactor);
    const result = recoveryCost({ sqlBytes, documentBytes: docs.metrics.value.bytes + docs.metrics.value.metadata_bytes,
        objects: docs.metrics.value.objects, ...(remainingFree ? { remainingFree } : {}) });
    return { ...result, sql_expansion_factor_assumed: sqlExpansionFactor,
        warning: 'Metadata-based estimate only; SQL expansion, change rate, multipart and shared free-tier use are not measured.' };
}
