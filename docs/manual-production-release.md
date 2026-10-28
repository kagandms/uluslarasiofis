# Manual code/assets release from a tablet

Only `.github/workflows/production-release.yml` publishes. The reviewed code-only baseline in
`config/production-publication.json` points to commit `741856b30bcf64292faef38fef2e9fe17a5b6ed4`,
which includes the source for production migration `0033_d1_rows_read_indexes_and_scan_counts.sql`.
The production D1 ledger recorded migration 0033 as
applied at `2026-10-28 07:54:41 UTC`; its table and trigger definitions matched the recovered source.
This baseline update records that existing schema state and does not apply a migration. The earlier
release and rollback evidence remains under `docs/production-only-evidence/`; the R2 copy is in the
same Cloudflare account.

## Release procedure

1. Use the exact full SHA at the current `production` HEAD. Run **Production release (manual)** on
   `production` with `operation=preflight`, then approve the GitHub **Production** environment review.
   CI validates that SHA; the protected job checks the artifact, Cloudflare metadata, D1 ledger and
   exact-artifact dry-run. `preflight` does not publish or apply migrations.
2. Review all preflight evidence and the remaining recovery limits. A deployment requires a separate,
   explicit user request for that exact SHA and scope. Only then run the workflow with
   `operation=publish`; the Production environment review is still required. The workflow publishes
   the tested artifact and performs read-only post-deploy metadata and six-route health checks.
3. Inspect the active Worker version, release annotation, manifest checksum and health results. A
   failed or uncertain result requires investigation before another attempt. There is no automatic
   retry, rollback, migration, restore, or print queue replay.

Production environment reviewer/branch restrictions and administrator bypass settings must remain
unchanged. Cloudflare credentials exist only in that environment. Concurrency serializes the complete
workflow; HEAD is refreshed before activation and the live version must still match preflight.
The same SHA already active is rejected. Dashboard/manual deployments outside this workflow must be
paused during a release: an external writer cannot be locked by GitHub concurrency.

## Exact artifact and preserved settings

CI uploads then downloads its manifest-bound artifact, verifies file list/length/SHA-256/source SHA,
then prepares and verifies the upload package without credentials or rebuilding. Only the two reviewed
hidden build paths are allowed by the existing manifest guard. Package/config checksums remain checked.
Wrangler `--no-bundle --dry-run --outfile` is used **locally only**, never for remote deployment.
Code modules must match the artifact byte for byte. Wrangler normalizes source-map paths during
serialization; the uploader explicitly restores the original tested source-map bytes before hashing.
Static assets use the existing pinned Wrangler BLAKE3 hash protocol and exact manifest bytes.

The publisher stages static assets and a Worker version, then issues exactly one 100% deployment POST.
All requests stop on failure without SDK retries. Staging failure leaves the active version unchanged;
unused staged assets/versions may remain. No production D1/R2 object API is used. This assets upload
is Cloudflare's Worker static-assets storage, not the application's DOCUMENTS/PRINT_FILES buckets.
Bindings, including all runtime secrets, inherit by name using the API-supported `version_id: latest`; values are never fetched or supplied.
The latest uploaded version must equal the approved active version before staging and again immediately
before the strict version upload. After staging, latest must be our candidate before activation. Any
mismatch stops without retry, deletion, rollback or promotion. Existing external writers must remain
paused; these reads cannot provide a server-side atomic lock against Dashboard uploads.
Live compatibility settings must match the reviewed configuration. Placement/limits/cache options
are copied unchanged; no routes/subdomain/cron/settings PATCH is issued. Metadata is compared after
activation and read-only binding/secret/cron preflight runs again. Application crons continue normally.

Normal releases reject any difference in `wrangler.jsonc`, `migrations/`, or the runtime secret metadata
allowlist against the pinned reviewed baseline. Such changes need a separate explicit configuration/data
approval and reviewed baseline update. This protects declared configuration/schema changes; application
code still needs human review for new data-mutating behavior. There is no automatic data migration.

## Permissions and remaining recovery risk

Existing account-scoped **Workers Scripts Edit** must permit Worker assets upload, version creation and
activation; the token also needs its D1 ledger-query access. Exact-SHA run #34 completed authenticated
read-only metadata and ledger checks, but did not exercise publish permission. If a future preflight or
publish check is denied, stop and report the endpoint, HTTP status and numeric error code without provider
payloads.

The 23 October recovery evidence includes a D1 SQL export, Time Travel bookmark, isolated SQLite restore
and `0028` rehearsal, plus a hash-verified R2 recovery copy and restore probe. The R2 copy is in the
existing print bucket in the same Cloudflare account, so it is not an independent-account backup. The
rollback check applies only to the current production schema; reassess it after `0028` and before any
transition-route record is accepted. A new production migration or data restore remains a separate
approved operation; this release workflow never applies migrations or restores data.

## 10057 compatibility correction

The historical failed run 38860053033 reached version creation and received HTTP 400 / 10057 before
activation. Static assets may have been staged; this was not an active Worker deployment. The former
explicit UUID inheritance was incompatible with the account API; binding `version_id` uses the
API-supported `latest` value. Regression tests and the protected release workflow enforce that
contract. The latest recorded active Worker is `c0a250d6-4ef8-4eff-bd27-b40246b5a5f9` (23 October
2026); run #34 also completed the exact-SHA preflight checks. A later publish still requires explicit
authorization and a fresh preflight against the then-current `production` SHA.
