# Cloudflare usage card

The staff home (`yetkili/`) shows a small card at the top left. Opening it requests `GET /api/staff/admin/usage` (staff session required) and draws one bar per metric. Nothing is requested while the card is closed. The open/closed preference is kept in `localStorage` (`cloudflare-usage-card-open`).

## Metrics and limits (verified 2026-11-08)

| Metric | Period | Free limit | Source |
|---|---|---|---|
| Workers requests | day (UTC) | 100,000 | https://developers.cloudflare.com/workers/platform/limits/ |
| D1 rows read | day (UTC) | 5,000,000 | https://developers.cloudflare.com/d1/platform/pricing/ |
| D1 rows written | day (UTC) | 100,000 | https://developers.cloudflare.com/d1/platform/pricing/ |
| D1 largest database | now | 500 MB | https://developers.cloudflare.com/d1/platform/limits/ |
| D1 total storage | now | 5 GB | https://developers.cloudflare.com/d1/platform/limits/ |
| R2 Class A operations | month | 1,000,000 | https://developers.cloudflare.com/r2/pricing/ |
| R2 Class B operations | month | 10,000,000 | https://developers.cloudflare.com/r2/pricing/ |
| R2 storage | now | 10 GB | https://developers.cloudflare.com/r2/pricing/ |

Constants live in `src/server/services/cloudflare-usage-limits.js`. Daily limits reset at 00:00 UTC (03:00 in Türkiye); R2 operations are counted from the first of the month.

## Behaviour

- `src/server/services/cloudflare-usage-metrics.js` queries the Cloudflare GraphQL Analytics API (five separate dataset queries). A failing dataset marks only its metrics `unavailable`; the card shows "alınamıyor", never zero.
- The result is cached at the Worker edge for five minutes per UTC date. The card never reads or writes D1.
- Values above 100% keep the real percentage while the bar is clamped. Warning colour from 70%, danger from 90%.
- Analytics can lag; the card is an operational indicator, not a real-time guarantee. Without the token every row shows "alınamıyor".

## Credentials

Reuses the Worker secret `D1_ANALYTICS_API_TOKEN` (Account Analytics:Read) and `D1_ANALYTICS_ACCOUNT_ID`; see [the runtime secret baseline](deployment/runtime-secret-baseline.md). If the token cannot read some datasets, those rows show "alınamıyor"; create a token with only Account Analytics:Read and store it under the same secret name.

## Unverified assumptions (check on staging before relying on them)

- Field names `rowsRead`/`rowsWritten` under `sum`, and the D1 storage dataset (`d1StorageAdaptiveGroups`, `max { databaseSizeBytes }`, `date` filter) are not shown with examples in the Cloudflare docs.
- R2 `actionType` values are assumed to equal the operation names on the R2 pricing page.
- The Workers docs do not state whether static asset requests count toward the 100,000/day figure.
