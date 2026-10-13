# Phase 8H — private document scanner design

**Status:** Design draft only — no application code, migration, secret, queue, VM, deployment, or live resource was changed or created in this pass.

**Goal:** Add a fail-closed malware-scanning path for finalized private R2 documents, with a Cloudflare-hosted control plane and an outbound-polling Oracle VM running ClamAV.

**Architecture:** The two existing finalize transactions will atomically create a durable D1 scan-job/outbox record while leaving the file `pending`. A Cloudflare Queue carries only an opaque job identifier; an Oracle VM pulls over outbound HTTPS, obtains a short-lived capability for exactly that file, scans it locally, and returns an authenticated result that the Worker applies with a revision- and object-bound compare-and-swap.

**Scope:** Phase 8H scanner design and its future implementation/verification plan. Phase 8I is not started. Production access and real university records are out of scope.

## Repository state verified first

- Checkout: `/Users/kagansmtdms/Downloads/Проекты/uluslarasiofis-phase8h-live-staging-uat`
- Branch/upstream: `codex/phase8h-live-staging-uat` / `origin/codex/phase8h-live-staging-uat`
- Expected starting HEAD was `a38ec60e98e8e3405e9c1241610b23d617dbf805`; actual HEAD is the newer `97c8c510729b4bddcc01259f8bc7ec3a108a8ee2`, and upstream resolves to the same SHA. The newer commit finalized the browser-UAT report.
- Worktree was clean before this document was created. The existing [Phase 8H browser-UAT report](phase8h-live-staging-uat.md) is committed and will remain unchanged.
- Phase 8H remains **NOT COMPLETE**. This document does not authorize implementation, staging setup, deployment, or Phase 8I work.

## 1. Current source findings

| Path | Current behavior and evidence |
|---|---|
| Initial upload finalize | `src/server/routes/applicationDocumentRoutes.js:114-179` creates an opaque `quarantine/<UUID>` key, issues an R2 PUT capability for 300 seconds, and creates the upload intent. `:202-258` checks the R2 object’s existence, size, and media type before finalization. `src/server/repositories/d1/documentRepository.js:222-263` batches the revision/current-file/record/intent updates; the file is set to `upload_status='finalized', scan_status='pending'` at `:248-252`. There is no scan job/outbox insert in this batch. |
| Replacement finalize | `src/server/routes/resubmissionUploadRoutes.js:212-259` verifies owner, replacement eligibility, and the R2 object before calling `finalizeReplacement`. `src/server/repositories/d1/resubmissionUploadRepository.js:107-197,362-370` batches the current-revision swap, file state, record/application state, completed intent, and audit. The replacement file becomes finalized and `pending` at `:155-161`; there is no scan job/outbox insert in that batch. |
| Persisted scan states | `migrations/0001_backend_foundation.sql:91-109` permits `pending`, `clean`, `unsafe`, and `failed`. Current finalize code writes `pending`; source search found no application path that records an actual scanner verdict. The `clean`/`unsafe`/`failed` values are modeled but are not produced by an implemented scan-result route or worker. |
| Existing private-access and review gates | `src/server/repositories/d1/documentRepository.js:330-368` resolves private files only when finalized and scan-clean; the current-file selector also requires no pending cleanup and a completed upload intent. `src/server/routes/staffReviewRoutes.js:41-64` repeats clean/finalized/completed/current-state checks before document review. Final application approval separately requires all required documents approved and clean (`src/server/routes/staffReviewRoutes.js:146-163`). Preserve all of these gates. |
| Upload object mutability — blocking integrity issue | Initial upload uses `createUploadCapability` (`src/server/routes/applicationDocumentRoutes.js:141-144`), which signs PUT without `If-None-Match: *`. Replacement upload uses `createWriteOnceUploadCapability` (`src/server/routes/resubmissionUploadRoutes.js:156-165`; signer at `src/server/storage/r2DocumentStorage.js:127-167,188-190`). A still-valid initial PUT URL can overwrite the same object after finalize or even after a scan. A matching job/revision and scan-time hash do not prevent a later overwrite. Before trusting `clean`, make initial uploads immutable (recommended: write-once conditional PUT, covered by browser/CORS tests) or adopt a separately verified immutable-object promotion design. A post-scan HEAD alone does not close the race. |

Cloudflare D1 `batch()` is documented as a SQL transaction that aborts/rolls back the sequence on statement failure. This fits the required finalize-plus-outbox atomicity; sending a Cloudflare Queue message cannot join that D1 transaction, so delivery must use the outbox pattern ([D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/)).

## 2. Proposed system boundary and delivery choice

```mermaid
sequenceDiagram
    participant Student
    participant Worker as Cloudflare Worker
    participant D1 as D1 (file state + scan outbox)
    participant Queue as Cloudflare Queue
    participant VM as Oracle VM (scanner service)
    participant R2 as Private R2
    participant AV as ClamAV (local socket)

    Student->>R2: PUT upload capability (write-once)
    Student->>Worker: finalize intent
    Worker->>R2: HEAD and validate object
    Worker->>D1: Atomic finalize + pending scan job/outbox
    Worker->>Queue: Outbox dispatcher sends {job_id, generation}
    VM->>Queue: Pull over outbound HTTPS; lease job
    VM->>Worker: Authenticated claim; D1 CAS lease epoch
    VM->>Worker: Authenticated request for job-scoped GET capability
    Worker->>D1: Verify lease, current revision, pending file, object identity
    Worker-->>VM: Short-lived GET capability for one R2 object
    VM->>R2: GET exact private object over HTTPS
    VM->>AV: Scan bounded local temporary file via Unix socket
    AV-->>VM: Clean / malware / error result
    VM->>Worker: Authenticated, signed job/file/revision/object-bound result
    Worker->>D1: CAS result and audit; stale result cannot alter file state
    VM->>Queue: Ack only after durable result or stale-job disposition
```

### Cloudflare Queue plus HTTP pull

- **Use HTTP pull from the VM.** Oracle initiates outbound HTTPS to the Cloudflare Queues REST API; no inbound scanner callback, public VM application port, or public ClamAV port is needed. This works with a VM behind ordinary outbound internet access and avoids exposing an HTTP-push endpoint on an unverified server.
- Queue messages contain only a stable `job_id` and a monotonically increasing dispatch `generation`. They contain no student data, filename, R2 key, file bytes, credentials, or presigned URL. A stale generation is acknowledged without scanning.
- The VM needs a dedicated Cloudflare API token for the Queues pull/ack API. Cloudflare’s current pull-consumer guide documents Account → Queues → Edit (read/write) and account scoping. That is a meaningful credential: verify whether the account UI can narrow it to the scanner queue. If not, isolate the scanner queue in a dedicated Cloudflare account or explicitly accept/account for the broader account-level permission before provisioning. Store it only in an owner-managed secret facility on the VM; never in source, D1, logs, or this document.
- Use a batch size of one initially. Configure the Queue visibility lease longer than the scanner’s hard timeout plus result persistence/ack margin (initial proposal: 10 minutes Queue lease, 120-second scan hard timeout); a shorter D1 lease is heartbeated and remains authoritative if a Queue lease expires or delivery overlaps. Pull consumers must ack or retry messages; an expired Queue lease causes redelivery. Empty polling also consumes a Queue read operation, so use long polling/backoff and stop polling when the service is disabled. See [HTTP pull consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/) and [retry/delay behavior](https://developers.cloudflare.com/queues/configuration/batching-retries/).
- A Queue message is at-least-once, not a unique scan guarantee. Stable job identity, dispatch generation, D1 compare-and-swap claims, and idempotent result handling make redelivery safe.

### Private R2 access and authenticated scanner service

1. After pulling a message, the VM posts its `job_id` and generation to an authenticated Worker claim endpoint. The Worker uses D1 compare-and-swap to create a monotonically fenced lease epoch and expiry; a second active claimant is rejected. The scanner renews the D1 lease only while healthy and within the hard timeout. It then asks for content access using that lease epoch. The Worker reloads the authoritative job and checks the exact job/generation/epoch, file ID, revision ID, current-revision flag, `upload_status='finalized'`, `scan_status='pending'`, cleanup state, and persisted R2 object identity before issuing access.
2. Return a presigned **GET** only for that object key, with a proposed 60–120 second lifetime (the existing signer accepts 30–300 seconds). Never put this bearer capability in the Queue, D1, logs, crash reports, command arguments, or a durable VM file. Keep it in process memory and redact URLs/query strings from HTTP/client logs. The VM must reject redirects and unexpected hosts. The Worker endpoint refuses to mint another capability after the lease expires or the job/revision is stale.
3. R2 documents presigned URLs as bearer capabilities: one method on one object, reusable until expiry. This gives least-privilege object access, but not one-time access or early revocation. Keep the expiry short and protect the URL as a secret. If that residual exposure is unacceptable, choose a Worker-streamed content endpoint with equivalent machine authentication and benchmark its operational cost before implementation. No public bucket or custom-domain fallback is allowed. See [R2 presigned URL semantics](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).
4. The machine-to-Worker content/result endpoints use TLS and a separate service credential, preferably an HMAC over method, canonical path, timestamp, nonce, and body hash. Verify timestamp skew, key ID, constant-time MAC, nonce uniqueness/replay, request size, and rate. Keep credentials outside the queue token and rotate them through an owner-approved secret process. The browser and student API never choose a scan state or submit a verdict.

### Result identity, idempotency, and stale revisions

- The D1 scan-job row binds `job_id`, `file_id`, `revision_id`, opaque `storage_key`, expected byte size, R2 ETag/last-modified captured at finalize, dispatch generation, lease epoch, and timestamps. The scanner downloads only that key, enforces the expected byte count, and computes SHA-256 over the bytes it scanned. Do not treat R2 ETag as a cryptographic content hash.
- The authenticated result allowlist carries job/file/revision identity, lease epoch, object ETag/size, scanner engine version, signature database version/age, SHA-256, outcome (`clean`, `unsafe`, or `error`), and bounded safe diagnostic code. HMAC authenticates the source; D1 checks every identity against the job and file rows. Never accept caller-provided storage keys, application IDs, scan status, or verdict without those checks.
- Apply a result only in one D1 batch/CAS when the job lease epoch matches, file/revision/object identity still matches, the revision is still current, the file is finalized and pending, upload intent is completed, and cleanup is not pending. Store the scan hash and engine/signature metadata with the state/audit. If a replacement made the scanned revision non-current, mark the job `stale`; do not mutate either the replacement or old file’s scan status to `clean`.
- Repeating an identical already-applied result is idempotent. A conflicting result, expired lease, mismatched digest/object, replayed nonce, or older generation is rejected/audited safely. Ack a Queue message only after the result or stale disposition is durable; if the Worker write or Queue ack fails, redelivery must be harmless.

## 3. Outbox, retry, status, and failure behavior

### Atomic finalize and outbox

- Extend **both** existing D1 finalize batches: `finalizeStudentUpload()` and `finalizeReplacement()`. Their batch must set the current revision/file/intent state and insert the durable `document_scan_jobs` (outbox/ledger) row together. If any SQL statement fails, D1 rolls back the state and outbox as one transaction. The outbox insert is conditional on that exact file being finalized, current, pending, and linked to a completed upload intent. Use a unique constraint on `(file_id, revision_id)`; finalize retries must not create another logical scan job.
- Keep Queue send outside D1. A dispatcher reads due outbox rows, sends the stable job ID/generation, then marks dispatch success. A crash after Queue send but before the D1 mark causes a duplicate send, which the consumer safely deduplicates. A D1 row still due after a failed Queue send remains durable and retryable.
- Use a scheduled Worker dispatcher/reconciler with a small indexed batch. It repairs outbox rows not dispatched, expired leases, delayed retry jobs, and files still `pending` without an active matching scan job. It must not scan or mutate files whose revision/object/cleanup state no longer matches. Increment dispatch generation when deliberately re-enqueuing; old Queue messages then become harmless stale deliveries.
- Configure bounded exponential retry for transport/service/temporary scanner failures, e.g. 30 seconds, 2 minutes, 10 minutes, and 30 minutes; set a finite attempt and elapsed-time ceiling (proposal: five attempts or 24 hours, whichever comes first). After exhaustion, persist a safe failure reason, set current file `failed` with a CAS, keep access/review blocked, route to a DLQ/operational alert, and stop automatic hot-loop retries. Manual rescan must be an explicit authenticated and audited operation that returns the same current file to `pending`; it cannot assert `clean`.
- D1 is the durable source of truth; Queues is a delivery mechanism. On reconciliation, resend only jobs whose indexed state says due and whose generation/current file still match. A Queue message that expires or reaches DLQ does not erase the D1 job. Alert on oldest pending age, due outbox backlog, DLQ count, repeated scanner failures, and signature age.

### Scan-state contract

| File `scan_status` | Meaning | Allowed transition / effect |
|---|---|---|
| `pending` | No authoritative clean/unsafe verdict has been persisted. Includes queued, leased, and retry-wait states. | Finalize → `pending`; retry remains `pending`. Private document access, document approval, and final application approval remain blocked by their existing `clean` gates. |
| `clean` | The exact current immutable object was fully scanned within all configured limits using an acceptably fresh signature database and returned a successful clean result. | Only a matching, authenticated, current lease result can set it. Never infer clean from timeout, skipped/unsupported content, scan limit, missing signatures, VM unavailability, or missing job. |
| `unsafe` | ClamAV positively detected a threat (including the EICAR test signature) or a separately approved deterministic malicious-content policy fired. | Matching scan result only. Keep inaccessible/unapprovable; student replacement follows the existing owner-session workflow. It is not a transient scanner error. |
| `failed` | The system could not establish a verdict: exhausted temporary errors, stale signatures, timeout/limit, corrupt/incomplete transfer, unsupported/encrypted content policy, or prolonged scanner outage. This does **not** mean malware was detected and never means clean. | Persist after retry/SLA exhaustion; stay inaccessible/unapprovable. Only an explicit audited retry moves `failed → pending`, or a new replacement creates its own `pending` revision. |

The state machine for file scan status is therefore `pending → clean | unsafe | failed`, with `failed → pending` only through an explicit audited rescan and replacement files starting independently at `pending`. No transition bypasses revision/object binding. Keep application review state separate: `submitted → under_review` remains an application-level transition, while private file access, document approval, and final application approval each retain their separate safety gates.

## 4. ClamAV runtime, limits, and VM network posture

- Run the scanner service as a dedicated unprivileged OS account on an ARM64 Linux image only after actual Oracle shape/image are confirmed. Run `clamd` on a local Unix socket with file/command permissions restricted to the scanner service. Do not bind or expose ClamAV TCP port 3310 to the internet or VCN. No public VM scanner callback is required; the service initiates HTTPS polling/result traffic.
- Open only the network paths the selected deployment needs: outbound HTTPS to Cloudflare Queue API, the Worker staging host, R2 S3 endpoint, and ClamAV signature distribution; DNS and OS security updates as required. If the VM has a public IP for outbound access, deny inbound scanner/service ports and restrict SSH to the owner’s source IP. A private subnet/NAT alternative and any Oracle networking charge must be checked separately; do not assume zero cost.
- The application accepts at most 10 MiB per document (`src/server/domain/documentPolicy.js:1-2,66-68`). Enforce that cap again on download and on the VM. Set ClamAV’s single-file scan ceiling above the accepted raw limit (proposed 12 MiB) so a maximum-size allowed file cannot be silently skipped. Initial provisional scanner budgets for staging are: one active scan at a time on a 2-OCPU candidate VM; raw file maximum 10 MiB; expanded/container scan budget 100 MiB; maximum 1,000 extracted entries and depth 20; hard wall-clock scan timeout 120 seconds. These are starting values for ARM64 benchmark and adversarial archive tests, not guarantees. Adjust only with recorded capacity/security evidence.
- Set ClamAV per-file/container/recursion/time limits explicitly and treat **any** skipped content, exceeded limit, timeout, corrupt input, encrypted content where policy disallows it, or incomplete scan as `failed`, never `clean`. ClamAV documents that `--max-filesize` can skip oversized files and assume them clean; verify actual `clamd`/client exit/status semantics so that this default cannot silently create a clean verdict ([ClamAV scanning](https://docs.clamav.net/manual/Usage/Scanning.html)).
- Use official ClamAV signature databases via `freshclam` as a supervised daemon or the documented periodic updater. Record the database version/time with each result and require a proposed maximum signature age of 24 hours. If updates fail past that threshold, stop issuing clean verdicts and retry/mark failed. Alert on update errors. Official docs identify `freshclam` as the updater and recommend official signatures before running `clamd` ([configuration and freshclam](https://docs.clamav.net/manual/Usage/Configuration.html)).
- Download into a per-job random filename under a private `0700` directory; file mode `0600`; never use student filename as a path. Bound concurrent disk/memory use. Scan the exact downloaded file, verify bytes and SHA-256, do not execute or extract it manually, do not retain/quarantine a second malware copy, and delete temporary data in a `finally`/process cleanup path. A boot-time janitor deletes stale job temp files after crashes; persistent logs contain only job ID, safe codes, timings, versions, and hashes—not content, personal names, capabilities, or raw scanner output. Restrict ClamAV’s own temp directory and ensure its temp cleanup behavior is enabled.
- An Oracle VM outage, capacity rejection, stale signatures, full disk, or update failure must not open files or unblock approval. Jobs remain `pending` during the bounded retry window, then become operational `failed` and stay closed until audited retry/replacement. When the VM returns, D1 reconciliation republishes eligible work. Never depend on VM uptime for access-gate correctness.

## 5. Current official free-tier limits (checked 2026-10-02)

These are published plan limits, **not** a promise that the current account is on that plan, that regional capacity exists, or that an always-on scanner is free. Check actual account billing/quotas and the chosen OCI home region before provisioning or deployment.

| Service | Published free allowance / limit relevant here | Design impact |
|---|---|---|
| Cloudflare Workers | Free plan: 100,000 requests/day and 10 ms CPU per HTTP invocation; current limits page lists 10 ms per Cron invocation and at most five Cron Triggers per account. | Keep finalize/result/outbox handlers small; ClamAV runs on OCI, not Worker CPU. Batch a bounded number of outbox rows per cron. Exceeding free limits can make scanner control paths unavailable. |
| Cloudflare Queues | Workers Free: 10,000 operations/day across reads/writes/deletes; 24-hour non-configurable retention. A typical delivered message uses write/read/delete; retries add reads; empty HTTP pulls also incur reads. | Small `{job_id,generation}` messages, bounded retries, backoff, no tight empty polling. Reconciliation must be able to reconstruct delivery from D1 after Queue expiry. A prolonged outage can outlast Queue retention. |
| Cloudflare D1 | Workers Free: 5 million rows read/day, 100,000 rows written/day, 5 GB total storage. Current docs say free-limit overruns fail queries (enforcement began Sep 1, 2026; [changelog](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)). | Index due-job/current-file lookups, keep bounded reconciliation and result transactions, monitor row metrics. A D1 quota failure must leave documents closed and outbox state recoverable. |
| Cloudflare R2 Standard | Free tier: 10 GB-month storage, 1 million Class A and 10 million Class B operations/month; internet egress is listed free. Infrequent Access is not covered by that free tier. | Each scan reads the object and adds operations; estimate volume and storage, watch usage. R2 egress allowance does not make OCI, Worker, or account-wide costs zero. |
| Oracle Cloud Always Free Ampere A1 | Current Oracle Always Free page says 1,500 OCPU-hours and 9,000 GB-hours/month, equivalent for Always Free tenancies to 2 OCPUs and 12 GB RAM; 200 GB block storage is shared for boot volumes. Instances must be in the home region. Oracle may reclaim idle Always Free instances; its stated 7-day idleness criteria include CPU/network below 20% and A1 memory below 20%. | 2 OCPU/12 GB is only the published quota ceiling, not a guarantee of host capacity or this user’s allocation. Oracle documents “out of host capacity” and possible reclamation. This architecture must tolerate the scanner being offline; no uninterrupted free compute is assumed. |

Official sources: [Workers pricing and D1 quotas](https://developers.cloudflare.com/workers/platform/pricing/), [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/), [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/), [Queues pull consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm). Oracle capacity and continuous availability are not guaranteed by the published free allocation.

## 6. UI copy correction in the later implementation

`src/staff/applicationsManager.js:268-273` currently maps every non-clean `scan_status` to `Belge güvenlik kontrolünden geçmedi.` This incorrectly labels `pending` as a completed security failure and conflates pending, unsafe, and failed. Keep this as an unresolved UI-copy defect in this design pass; do not change source here. Later UI work must give each state accurate, translated copy, for example:

- `pending`: “Belge güvenlik kontrolü bekliyor.”
- `unsafe`: “Belge güvenlik kontrolünden geçemedi; güvenli erişime kapalı.”
- `failed`: “Belge güvenlik kontrolü tamamlanamadı; yeniden denenecek.”
- `clean`: show the existing safe/available behavior only after authoritative result persistence.

Do not imply document approval or application approval from `clean` alone.

## 7. Small implementation sequence (future authorization required)

1. **Resolve prerequisites and final decisions.** Confirm OCI account eligibility, home-region A1 capacity, actual ARM64 image, SSH reachability, outbound HTTPS, disk, Cloudflare plan/quotas, queue-token scope, data-processing region approval, retry/SLA, signature freshness threshold, and immutable-object approach. Do not share SSH private keys or credentials.
2. **Write focused tests and an additive D1 migration.** Add the durable scan job/outbox ledger with unique `(file_id, revision_id)`, dispatch generation, lease epoch/expiry, retry scheduling, safe failure code, and due/stale indexes. Add a short-lived, unique request-nonce table (store a hash, not the HMAC secret) so HMAC replay prevention is atomic with claim/capability/result requests; periodically delete expired nonce rows. Keep scanner result/audit metadata bounded and avoid personal data. Migration is future work (next additive migration after current `0001`–`0005`); do not edit old migrations.
3. **Make initial R2 uploads immutable.** Use signed write-once conditional PUT for the initial upload path or a reviewed immutable promotion strategy. Verify browser PUT headers/CORS and retries; do not assume a post-scan HEAD fixes a capability that can still overwrite the key.
4. **Add both finalize outbox writes atomically.** Extend initial and replacement D1 batches, with conditional inserts tied to the exact finalized current file and completed intent. Tests must prove rollback leaves neither a finalized file without a job nor an outbox job without a finalized file.
5. **Implement Worker outbox dispatch/reconciliation and Queue lifecycle.** Use a minimal message, bounded cron batch, generation fencing, pull retry/DLQ handling, and observable stale/pending age. Create the Queue and configure plan/permissions only after a separately authorized staging setup.
6. **Implement authenticated Worker scanner endpoints and result CAS.** Add machine-authenticated claim/capability/result routes, narrow R2 GET capabilities, nonce/replay protection, object identity checks, audit, stale-revision rejection, and idempotent result handling. Keep the existing private access/document approval/application approval gates unchanged.
7. **Provision the OCI service only after server readiness.** Install an ARM64 ClamAV release, updater, local Unix socket, unprivileged pull service, systemd hardening, secret delivery, egress-only worker traffic, resource limits, alerting, and temporary-file janitor. Port 3310 remains local-only/unexposed.
8. **Correct UI copy and operational state reporting.** Render pending/unsafe/failed distinctly, with safe retry guidance; do not make pending or failed look clean. Add only the monitoring needed to resolve backlog, DLQ, stale signatures, and VM outages.
9. **Run local and staging validation, then separate review gates.** Apply migration and configure queue/secrets only in staging after explicit approval; execute the scenarios below with synthetic files. Complete manual browser UAT and review logs/metrics. Production remains untouched unless separately authorized. Phase 8H must not be marked complete until scanner, fail-closed access, replacement/review, and operational recovery evidence all pass.

## 8. Meaningful verification scenarios (planned, not run)

| Scenario | Setup and expected result |
|---|---|
| Finalize/outbox atomicity — initial and replacement | Finalize each accepted synthetic object. Each produces exactly one pending file and one matching durable job. Inject a D1 statement failure/constraint conflict; transaction leaves no partial finalization/job. Repeating the same finalize does not duplicate the logical job. |
| Clean synthetic document | Upload a harmless valid synthetic PDF within the 10 MiB limit. Confirm one job, one exact-object GET, successful scan with current database metadata, and only then `pending → clean`. Protected preview/download succeeds only after the existing clean gate; audit does not expose filename or capability. |
| Standard EICAR sample | Use the official EICAR test file only in staging. Expect a positive ClamAV detection and `pending → unsafe`; verify private access and document approval remain denied, application final approval remains blocked, and owner-session replacement is available under existing policy. EICAR is a harmless test signature sample, not real malware ([EICAR test file](https://www.eicar.org/download-anti-malware-testfile/)). |
| Scan/transport failure | Simulate VM offline, R2 timeout, bad signature age, scanner exit error, exceeded decompression/time limit, disk full, and malformed result. Expect retries with backoff while pending, then operational `failed`; never `clean`, never private access/review approval. Recovery must be visible and bounded, not a hot loop. |
| Duplicate and out-of-order delivery | Deliver a job twice, expire a Queue lease, crash after Queue send before outbox mark, fail Queue ack after D1 result, replay the same result, and submit a conflicting result. Expect one persisted verdict; retries are harmless; conflicting/replayed/stale attempts cannot change file state. |
| Stale revision race | Delay scan of revision N, finalize replacement N+1, then return N’s clean result. Expect N’s job marked stale and no `clean` update to N or N+1. Scan N+1 independently before it can become clean. |
| Replacement and second-review chain | In staging synthetic data, scan an initial file clean, exercise staff resubmission-required through authorized test workflow, owner uploads/finalizes a replacement, verify it returns to pending, scan replacement clean, resume staff review, approve the replacement document, and separately test the final application approval gate. No scan state is edited manually. |
| Limits, transfer identity, and cleanup | Test exact maximum-size accepted file, file above app limit rejected before scan, object changed/mismatched ETag or SHA rejected, R2 redirect/host mismatch rejected, compressed expansion/file-count/depth/time caps fail closed, and temp files removed after success/error/process restart. |
| Oracle unavailable/recovery | Keep the VM stopped or deliberately deny host capacity. Files remain pending and inaccessible during retries, then failed after the configured ceiling; no manual clean. Restore VM and use audited retry/reconciliation to resume, with no lost job or duplicate verdict. |
| Network exposure | From an external host, confirm no scanner HTTP or ClamAV TCP port is reachable; verify scanner pull/content/result use outbound TLS only and SSH access is limited to the owner’s approved source. |

These scenarios are a plan only. None was run in this pass; no real student/university records or production resources are involved.

## 9. Open decisions and server-ready checklist

| Decision / information | Needed before implementation |
|---|---|
| OCI capacity and access | Actual account’s Always Free eligibility after trial, selected home region, successful A1 host allocation, ARM64 OS/image, allocated OCPU/RAM, boot-volume allocation/free disk, public/private IP and outbound route, DNS/HTTPS egress, and owner-confirmed SSH access. Do not provide a private key. |
| Cloudflare plan and quota | Current Workers Free/Paid status; D1, R2, Queue usage already consumed account-wide; whether the 10,000 Queue operations/day and 24-hour retention meet the scanner’s outage/recovery SLA; whether a paid plan or separate account is acceptable if not. |
| Queue API token scope | Confirm whether Account → Queues Edit can be restricted to the one scanner Queue. If not, approve an isolated Cloudflare account or accept broader permission with a rotation/revocation plan. |
| Immutable upload identity | Approve conditional write-once initial PUT versus an immutable-object promotion process. Confirm browser CORS/header compatibility and any in-flight upload-capability behavior. This blocks trusting a successful scan result. |
| Scan policy | Confirm hard wall-time, expanded archive size/count/depth, encrypted/unsupported document handling, 24-hour proposed signature freshness, retry/elapsed-time ceiling, and whether scanner outage should surface as `failed` after the proposed 24-hour window. Tune provisional limits against actual ARM64 performance. |
| Privacy and operations | Approve OCI region/data processing for the documents, log retention, operator alert destination, maintenance/update owner, temporary-storage policy, and who can request an audited rescan. |
| Staging authorization | Later explicit approval for the additive migration, staging Queue, secrets, VM/service setup, staging deployment, and synthetic-only end-to-end tests. None is authorized by this design-only pass. |
