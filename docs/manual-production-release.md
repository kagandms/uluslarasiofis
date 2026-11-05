# Manual production release

Only `.github/workflows/production-release.yml` publishes. Dispatch it on `production` with the
full reviewed SHA; the workflow rejects a SHA that differs from current `origin/production`.
`operation=preflight` is the first step and does not publish. `operation=publish` requires a
separate, explicit user request for that exact SHA and operation, followed by the configured
Production environment review. Never dispatch automatically. The workflow does not merge branches;
an unmerged candidate SHA cannot pass its `production` HEAD checks. This candidate sets the reviewed
code-only baseline in `config/production-publication.json` to
`b1590deca163e6aeb30038722e02d74fd4933646`, which contains production schema migrations
`0034_yoksis_document_audit.sql`, `0035_yoksis_audit_glob_limit.sql`,
`0036_application_spreadsheet_records.sql`, `0037_application_gocnet_attempts.sql`, and
`0038_final_application_documents.sql`. The 5 November 2026 read-only review confirmed the 0038
ledger entry, both added column definitions, and all eight expected catalog rows against the exact
migration source. Aggregate policy/status counts were consistent with the intended submitted-policy
snapshot and draft upgrade, but do not prove historical migration effects or live code identity. This
baseline records the reviewed source boundary only; it does not prove live artifact equality or rollback
safety, and it does not apply a migration. Earlier release and rollback evidence remains under
`docs/production-only-evidence/`; the R2 recovery copy is in the same Cloudflare account.

## Release procedure

1. Start from a clean candidate and use the exact full SHA at current `production` HEAD. Run
   **Production release (manual)** on `production` with `operation=preflight`, then approve the GitHub
   **Production** environment review.
   CI validates that SHA; the protected job checks the artifact, Cloudflare metadata, D1 ledger and
   exact-artifact dry-run. `preflight` does not publish or apply migrations.
2. Review all preflight evidence and the remaining recovery limits. A deployment requires a separate,
   explicit user request for that exact SHA and scope. Only then run the workflow with
   `operation=publish`; the Production environment review is still required. The workflow publishes
   the tested artifact and performs read-only post-deploy metadata and six fixed-route GET checks.
   HTTP success is availability evidence only; it does not prove application behavior.
3. Inspect the active Worker version, release annotation, manifest checksum and health results. A
   failed or uncertain result requires investigation before another attempt. There is no automatic
   retry, rollback, migration, restore, or print queue replay.

Production environment reviewer/branch restrictions and administrator bypass settings must remain
unchanged. Cloudflare credentials exist only in that environment. `production-release` concurrency
serializes runs of this workflow; it does not lock Dashboard deployments, direct Wrangler/CLI
commands, other automation, or other sessions. Those external writers must be paused and checked
before and during a release. HEAD is refreshed before activation and the live version must still
match preflight. The same SHA already active is rejected. `npm run deploy:production` is blocked
locally with instructions to use this workflow. Raw Wrangler commands are not technically blocked
by that package-script guard.

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

## Critical feature checks

The local suites below cover source behavior; post-release checks must not be described as end-to-end
acceptance. Six HTTP 200 responses alone are not a functional test.

| Area | Existing local coverage | Read-only post-release evidence | Requires separately authorized UAT for end-to-end behavior |
| --- | --- | --- | --- |
| New documents, accommodation/host conditions, age/application type, old policy snapshots | `test/finalDocumentPolicy.test.js`, `test/finalDocumentFlow.test.js`, `test/conditional-documents.test.js`, `test/submissionReadiness.test.js` | Active version SHA/annotation and release artifact identity; no applicant decision is proven | Synthetic application through each conditional branch, save/reload, upload/readiness, including an old submitted application |
| Draft persistence and submission readiness | `test/backendApiContract.test.js`, `test/applicationTracking.test.js`, `test/submissionReadiness.test.js` | Read-only version/config checks cannot prove a successful owner-session write or submit | Authorized synthetic owner-session save/reload and eligible/not-ready submission cases |
| Staff detail and PDF | `test/staffApplicationsUi.test.js`, `test/applicationDocumentPdf.test.js`, `test/backendApiContract.test.js` | Public GET checks do not prove authenticated staff rendering or PDF contents | Authorized staff test record, detail view, and generated PDF inspection |
| YKN/GöçNet and spreadsheet | `test/yoksisDocumentAudit.test.js`, `test/gocnetTransfer*.test.js`, `test/applicationSpreadsheet.test.js`, relevant cases in `test/staffApplicationsUi.test.js` | Worker identity/settings checks prove no application-level transfer | Authorized non-production/test records for YKN/GöçNet and Apps Script writes; no real student update without its own authorization |
| Scanner and Print Agent | `test/scanner/*.py`, `test/scannerApi.test.js`, `test/scannerQueue.test.js`, `scripts/print_agent/test_print_agent.py`, `test/print*.test.js`, `test/production-print-config.test.js` | Secret/binding/cron metadata and active-version checks prove configured metadata only | Authorized scanner sample and Print Agent v7 hardware/queue UAT; never infer physical output from HTTP status or unit tests |

Post-release read-only checks can establish the active Worker version and release SHA annotation,
artifact/config identity, declared bindings/secrets/cron metadata, migration-ledger names, and the
responses of fixed public GET routes. They cannot prove a student upload, policy decision, staff
workflow, spreadsheet mutation, scanner processing, or physical print. Such state-changing and
hardware checks require separately authorized UAT with synthetic records and controlled test files.

## 0038 baseline evidence and history requirement

The previous code-only baseline was `2f583e170fd929a0efc170df86656c0565f6ad58`. Its only
protected-path difference to the selected anchor `b1590deca163e6aeb30038722e02d74fd4933646` is
`migrations/0038_final_application_documents.sql`; the migration SHA-256 is
`626e7d5c9d445d4e81ba22f4a5abc3b7e743f0514ccec5dcc1d5192b3c9b6401`, matching the preserved
release source copy. From that anchor to this candidate, `migrations/`, `wrangler.jsonc`, and
`scripts/ci/runtime-secret-metadata.mjs` have no differences. The read-only production checks recorded
the ledger row, the `final_document_policy` and `host_is_turkish` column definitions, and all eight
catalog rows matching 0038. Aggregate policy/status counts were consistent with the intended snapshot
and draft-upgrade behavior; because later application operations can change those counts, they are not
proof of historical effects. No applicant content was selected. No migration, ledger, schema, or live
data was changed.

The baseline anchor commit must remain in production history because the code-only scope check requires
it to be an ancestor of each candidate. A squash merge removes that exact commit, and a rebase merge
rewrites its SHA; either can break the baseline ancestry check. Preserve the anchor with a merge method
that retains its exact commit ancestry. This baseline does not establish live code identity or rollback
safety.

The active Worker has not been bound to a source SHA/artifact manifest. This candidate preserves the
final-document feature only; it does not establish that every live behavior or out-of-band change is
represented in this branch. Before any future release, inventory and reconcile the active version's
available source/config metadata and all known live-only changes against production source and
release evidence.

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
