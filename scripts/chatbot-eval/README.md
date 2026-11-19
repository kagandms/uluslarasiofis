# Home Chatbot Offline Evaluation Harness

## What This Is

An offline evaluation suite for the home-page chatbot (`POST /api/public/chat`) covering 170 realistic test cases across all five supported portal languages (`tr`, `en`, `ru`, `tk`, `ar`):

- [`cases.json`](cases.json): 170 single-turn and multi-turn evaluation cases across 9 categories (`status_lookup`, `status_needs_reference`, `status_multiple_references`, `documents`, `documents_clarify`, `knowledge`, `refusal`, `handoff`, `any_non_fallback`), including typos, missing diacritics, slang, mixed-language queries, Arabizi, Turkmen variants, prompt injections, and document questions containing status keywords.
- [`run.mjs`](run.mjs): Node 20+ ESM runner with zero external dependencies. Imports fixed strings, status labels, knowledge base entries, and `listApplicationDocumentPolicies` directly from `src/` so expectations stay aligned with the server implementation.

## Why It Is Kept

This harness serves as a repeatable local quality gate before enabling the chatbot publicly. Running it against the local dev server with the real Workers AI binding measures:

- Deterministic vs. model-dependent routing accuracy
- Exact document-list correctness (`wrongDocumentCount` must be `0`)
- Knowledge-base tool usage (`application_steps`, `residence_permit_basics`, `office_hours`, `student_card`, `contact`)
- Safety compliance (prompt-injection / off-topic / PII refusal rate and zero data/prompt leaks)
- Refusal false-positive rate on legitimate student questions
- Fallback rate and p50/p95 request latency

> **Warning — Local Only:** Never point this harness at production (or staging). `run.mjs` rejects any non-local `BASE_URL` host (`localhost`, `127.0.0.1`, `::1` only) and refuses to write JSON output inside the repository.
>
> For local evaluation only, `run.mjs` sets `Origin` to the `BASE_URL` origin and assigns a distinct synthetic `CF-Connecting-IP` (`10.250.x.y`) per case so per-IP rate limits (`CHATBOT_RATE_LIMIT`, `CHATBOT_IP_DAILY_LIMIT`) do not mask results across the 170-case suite.

## Running Locally

1. Apply local D1 migrations:

   ```sh
   npm run db:migrate:local
   ```

2. Start the local dev server (note the port printed by Vite, e.g. `http://localhost:5177`):

   ```sh
   npm run dev
   ```

3. (Optional, recommended) Set `EVAL_REFERENCE` to a real `ITU-XXXX-XXXX` reference number present in your local D1 database so the 5 `reference_env` `status_lookup` cases run instead of skipping:

   ```sh
   export EVAL_REFERENCE="ITU-XXXX-XXXX"
   ```

4. Run the evaluation harness:

   ```sh
   BASE_URL=http://localhost:5177 node scripts/chatbot-eval/run.mjs
   ```

### CLI Options

- `BASE_URL` / `--base-url <url>`: Local dev server URL (default `http://localhost:5177`).
- `EVAL_REFERENCE` / `--reference <ref>`: Local `ITU-XXXX-XXXX` reference for `status_lookup` cases.
- `--only <category|id>`: Comma-separated category names or case IDs to run (e.g. `--only documents,knowledge`).
- `--limit <N>`: Run at most `N` matching cases.
- `--offset <N>`: Skip the first `N` matching cases (useful to resume after resetting daily limits).
- `--concurrency <N>`: Concurrent requests (default `1`, max `20`).
- `--out <path>`: Output JSON report path (default `/tmp/chatbot-eval-<timestamp>.json`; must be outside the repository).

## Resetting Local Chatbot Counters

The server enforces `CHATBOT_GLOBAL_DAILY_LIMIT` (50 model-dependent calls per day). When a run hits the daily limit, `run.mjs` records `daily_limit`, stops immediately, prints the case index/ID that hit it, and writes the partial JSON report.

Reset local rate-limit counters between runs or batches with:

```sh
npx wrangler d1 execute uluslarasiofis-local --local --command "DELETE FROM public_rate_limits WHERE endpoint LIKE 'chatbot%' OR endpoint = 'application-tracking-lookup'"
```

Then resume from the reported index with `--offset <index>` or run category batches with `--only <category>`.
