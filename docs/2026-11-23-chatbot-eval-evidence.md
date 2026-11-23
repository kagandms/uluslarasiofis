# Topi public chatbot — real Workers AI evaluation evidence (2026-11-23)

- **Date:** 2026-11-23 (evening, Istanbul). **Scope:** public home chatbot `POST /api/public/chat` only (the staff assistant has no eval pack; it is covered by fake-model tests). **Status:** historical evidence for the plan in [2026-11-23-topi-yetkili-ykn-otomasyon-excel-plani.md](2026-11-23-topi-yetkili-ykn-otomasyon-excel-plani.md) section 12.4; not a release approval.
- **Source:** local dev server (`npm run dev`, port 5180) from branch `test/combined-2026-11-23` with the real remote Workers AI binding (default `CHATBOT_MODEL`), local D1 copy migrated to 0047. Runner `scripts/chatbot-eval/run.mjs`, concurrency 2. Run with the owner's approval of the cost. The local `chatbot-global-daily` counter in the local test D1 was cleared before each pack (local copy only; no code or production data changed). Reports were written outside the repository and are not kept.
- **Round 1** (code before `task/chatbot-quality-fixes`): full set 216/222 (97.3%), safety 2; old blind set 113/123 (91.9%), safety 1; blind pack 2 ≈131/145, safety 5; red-team 95/100, safety 5. Wrong document lists 0 everywhere; no data or prompt leak in any case. All 13 "safety failures" were non-refusal safe texts (office handoff or off-topic text) for third-party status, guarantee/legal and appended-injection messages.
- **Fix:** `task/chatbot-quality-fixes` (5faa7c5, da84392): deterministic fixed refusals for third-party status, guarantee/legal requests and appended injections; wider quote-verified fact vocabulary; routing fixes. Facts are still taken only from quote-verified model extraction.
- **Round 2** (after the fix):

| Pack | Passed | Safety failures | Wrong documents | Fallback |
|---|---|---|---|---|
| `cases.json` (229, 7 skipped without `EVAL_REFERENCE`) | 218/222 (98.2%) | 0 | 0 | 0.5% |
| `blind-cases.json` (130, 7 skipped) | 116/123 (94.3%) | 0 | 0 | 0% |
| `blind-cases-2.json` (150, 5 skipped) | 140/145 (96.6%) | 0 | 0 | 0% |
| `redteam-cases.json` (100) | 100/100 (100%) | 0 | 0 | 0% |

- **Gate 12.4 item 2:** safety failures 0, wrong documents 0, leaks 0, blind sets ≥90%, fallback ≤5% — **met**. Remaining misses: 9 conservative answers (clarifying question or fingerprint info instead of a list), 1 knowledge-topic mismatch, 1 fallback, 3 transient HTTP 503 from the remote AI (passed on retry in round 1).
- **Caveat (12.5):** both blind packs were used for diagnosis in round 1, so they are no longer blind; the next gate run needs a new blind pack written by another model family.
