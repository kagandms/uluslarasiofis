// Free-plan limits shown on the staff usage card. Re-verify before changing any value.
export const LIMITS_VERIFIED_ON = '2026-11-08';

const WORKERS_LIMITS_URL = 'https://developers.cloudflare.com/workers/platform/limits/';
const D1_LIMITS_URL = 'https://developers.cloudflare.com/d1/platform/limits/';
const D1_PRICING_URL = 'https://developers.cloudflare.com/d1/platform/pricing/';
const R2_PRICING_URL = 'https://developers.cloudflare.com/r2/pricing/';

/** Metrics in the order the card displays them. */
export const USAGE_METRICS = Object.freeze([
    { key: 'workers_requests', label: 'Workers istekleri', period: 'day', limit: 100_000, unit: 'count', sourceUrl: WORKERS_LIMITS_URL,
        note: 'Statik varlık isteklerinin sayılıp sayılmadığı dokümanda belirtilmemiştir.' },
    { key: 'd1_rows_read', label: 'D1 okunan satır', period: 'day', limit: 5_000_000, unit: 'count', sourceUrl: D1_PRICING_URL },
    { key: 'd1_rows_written', label: 'D1 yazılan satır', period: 'day', limit: 100_000, unit: 'count', sourceUrl: D1_PRICING_URL },
    { key: 'd1_largest_db_bytes', label: 'D1 en büyük veritabanı', period: 'now', limit: 524_288_000, unit: 'bytes', sourceUrl: D1_LIMITS_URL },
    { key: 'd1_total_bytes', label: 'D1 toplam depolama', period: 'now', limit: 5_368_709_120, unit: 'bytes', sourceUrl: D1_LIMITS_URL },
    { key: 'r2_class_a', label: 'R2 yazma/listeleme (A)', period: 'month', limit: 1_000_000, unit: 'count', sourceUrl: R2_PRICING_URL },
    { key: 'r2_class_b', label: 'R2 okuma (B)', period: 'month', limit: 10_000_000, unit: 'count', sourceUrl: R2_PRICING_URL },
    { key: 'r2_storage_bytes', label: 'R2 depolama', period: 'now', limit: 10_737_418_240, unit: 'bytes', sourceUrl: R2_PRICING_URL }
].map((metric) => Object.freeze(metric)));

// Operation names from the R2 pricing page (verified 2026-11-08); analytics actionType values are assumed to match.
export const R2_CLASS_A_ACTIONS = Object.freeze([
    'ListBuckets', 'PutBucket', 'ListObjects', 'PutObject', 'CopyObject', 'CompleteMultipartUpload',
    'CreateMultipartUpload', 'LifecycleStorageTierTransition', 'ListMultipartUploads', 'UploadPart',
    'UploadPartCopy', 'ListParts', 'PutBucketEncryption', 'PutBucketCors', 'PutBucketLifecycleConfiguration'
]);
export const R2_CLASS_B_ACTIONS = Object.freeze([
    'HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary', 'GetBucketEncryption', 'GetBucketLocation',
    'GetBucketCors', 'GetBucketLifecycleConfiguration'
]);
