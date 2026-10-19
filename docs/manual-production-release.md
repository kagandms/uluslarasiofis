# Manual code/assets release from a tablet

Only `.github/workflows/production-release.yml` publishes. The code-only release baseline is
production `dec9891adb78f8d0c0cae0de1077431687c2d455`, which already contains migrations `0024` and
`0025`; PR #6 recovery maintenance remains separate.
Merging this PR does not deploy. No backup/restore result is asserted by this release workflow.

## First use, after separate merge approval

1. Obtain the current full production HEAD SHA after merging. Run **Production release (manual)**
   on `production`, with that exact SHA and `operation=preflight`. Approve the GitHub **Production**
   environment. This runs the same exact-SHA CI and authenticated read-only checks, without publication.
2. Review the result and recovery limitations below. Obtain separate explicit approval for the first
   real deployment. Run the same workflow with the then-current SHA and `operation=publish`.
   CI builds/tests once without credentials; environment approval gates the credentialed job.
3. Review the active immutable Worker version, `release:<SHA>` annotation, manifest checksum and six
   public GET health checks in the run. A failed or uncertain result requires inspection before another
   attempt. There is no automatic retry, rollback, migration, restore, or print queue replay.

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
activation; the token also needs its existing D1 ledger-query access. Read-only preflight alone does not
prove write permission. No permission was expanded, and no live write permission was exercised in PR CI.
New version/settings metadata reads will be checked at the first approved authenticated preflight.
If denied, stop and report the endpoint, HTTP status and numeric error code without provider payloads.

The existing daily D1 JSON backup in DOCUMENTS is not a full schema/ledger SQL backup or an independent
R2 document/print backup. Its current success and retention have not been verified here. The reported
7-day D1 Time Travel is limited to D1; it does not protect R2 or prove a restore drill. Real SQL and R2
backup plus isolated restore remain separate, unperformed maintenance requiring explicit export/resource/
cost approval. No new paid resource or controller is required by daily code releases.
There is currently no demonstrated end-to-end production recovery or rollback drill. Publication may
proceed only with this residual risk understood; the workflow does not label missing evidence as passed.

## 10057 compatibility correction

The failed release run 38860053033 reached version creation and received HTTP 400 / 10057 before
activation. No candidate-staged message or activation was reached. Static assets may have been staged;
this is not an active Worker deployment. The former explicit UUID inheritance was incompatible with
the account's API; UUIDs must not be sent as binding `version_id`. An SDK type accepting UUIDs was
insufficient evidence of server support. Regression tests now model the actual latest-only contract.
The current active UUID still needs an authenticated read; historical logs alone do not establish
current state. The existing workflow's `operation=preflight` now records active/latest UUIDs and last
deployment time in Actions logs/summary using only GET requests for this report. Differences stop the
preflight. No Dashboard sharing, new token, or new workflow is needed. Because Production environment
credentials allow only the production branch, this new diagnostic cannot run with those credentials
before the fix has been separately approved and merged. This PR does not change that restriction.
