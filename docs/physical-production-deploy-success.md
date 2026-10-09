> Current state: physical intake is ON for verified staff. See [live activation report](physical-intake-live.md). Gate-OFF/UAT notes below are historical.

# Physical feature production deployment

**PHYSICAL FEATURE DEPLOY SUCCESS — GATE OFF**

Worker `goc`, D1 `uluslarasiofis-production`. Source feature branch: `codex/physical-intake-production-port`; deployed source commit `cbc57d3809f7aaa71f4aebadd8238fc5dceece74`. No production Git merge was performed. The 63 snapshot files match the current primary production working code. Existing print/scanner scripts and online backend/security files were preserved. Staging resources were not changed.

Deployment ID: `5c42f99c-0b66-48b9-a7f5-5b9bc0dba6fe`

Worker Version ID: `28dcac23-abb7-446c-9c7d-f0889a5c627f`; 100% traffic.

Previous Worker Version ID: `cf84967e-e813-4e09-9146-17e3109c52c5`; private version/binding/deployment metadata retained as rollback evidence.

## Migration and backup

Fresh preflight returned READY_PENDING with only the accepted minimal `0018_staff_document_security.sql`. Wrangler applied it successfully. Postflight returned ALREADY_APPLIED_SKIP with no schema drift. This adds only mobile upload status, SHA-256 and rate-limit bookkeeping. No new physical ClamAV queue, scanner service, clean-verdict check or fake clean result was added. Existing online ClamAV rules are unchanged.

Fresh cutover D1 export: `/Users/kagansmtdms/.codex/secure-backups/physical-cutover-20261008T180221Z/production-pre0018.sql`, 125067 bytes, file permission 0600 and parent directory 0700. SHA-256: `9f73977a52db5afe4fffc4b86b459bd2c32c672b5a05057fa01c0aabf0070b84`. Actual SQL and unredacted provider metadata remain outside Git. D1 export does not back up R2 object bodies.

## Final verification

| Check | Result |
|---|---|
| Main / staff / print / phone HTML | HTTP 200 |
| Browser JavaScript | Home, online application wizard and staff login rendered; no staff page console errors |
| Public online form | Existing contact/personal/documents workflow rendered; no test application submitted |
| Online private API | Same unauthenticated 401 as before; authenticated staff CRUD UAT not exercised |
| Asset requests | 22 page JS/CSS requests successful |
| Physical gate | OFF in live Worker binding; QR create and claim return 403 PHYSICAL_INTAKE_DISABLED; unauthenticated physical query returns 401 |
| PRINT_ENABLED | true, unchanged |
| Print availability | false before and after, identical options/limits |
| Windows Print Agent | Same stale ready / protocol 3 record, seen_at 2026-10-08T14:35:27.760Z; no new heartbeat claimed |
| Scanner | Same stale ready / ClamAV 1.5.4 / signature 28147 record, seen_at 2026-10-08T14:35:13.478Z; no new heartbeat claimed |
| D1 / R2 / secret bindings | Before/after metadata matches |
| Existing plain-text settings | All prior values preserved; physical mode off added |
| Cron | Existing * * * * * and 0 0 * * * preserved |
| Node | 741 tests: 740 pass, 0 fail, 1 existing online real-engine opt-in skip |
| Production build/dry-run | Passed |

The existing offline agents were treated as the baseline, not a deployment blocker or new regression. No live print job or scanner job was sent.

The first asset smoke harness used Python's default User-Agent without browser headers; Cloudflare returned 403/error 1010. Automatic rollback restored the previous Worker. The same 1010 was reproduced against that previous Worker, while browser-style requests returned 200. The harness was corrected without changing application/security code or Cloudflare protections. The accepted Worker version was restored to 100% traffic and all final checks above passed. The additive migration remained in place throughout; no D1 restore/down migration occurred.

## Shortest phone UAT and activation

1. Log in to the staff panel on the selected PC. Same-origin POST `/api/staff/physical-access/session` returns its candidate session digest without activating access.
2. Operator sets the existing UAT variables: PHYSICAL_INTAKE_MODE=uat, PHYSICAL_INTAKE_UAT_SESSION_HASH, PHYSICAL_INTAKE_UAT_STARTS_AT and PHYSICAL_INTAKE_UAT_EXPIRES_AT (UTC, maximum one hour). Keep PRINT_ENABLED=true and existing secrets/settings unchanged.
3. Open Physical → PDF editor → phone QR. Send synthetic camera and gallery images from the real phone; confirm arrival only at that PC, PDF merge/edit/save/download, and expiry/logout/other-PC access rejection. No Windows scanner or physical clean verdict is needed.
4. After acceptance, operator sets PHYSICAL_INTAKE_MODE=on for authorized staff. Gate is currently OFF; no UAT/ON activation was performed by this deployment.

Rollback if a later physical problem appears: first gate OFF. Code rollback target is the recorded previous Worker version, preserving existing settings; leave additive 0018 intact. A whole-D1 restore is not an ordinary feature rollback because it could discard subsequent online writes.
