# Uluslararası Öğrenci Ofisi Portalı

The repository contains the public student portal, staff workspaces, a YKN Chrome extension, and the backend foundation for student residence applications. The application wizard and complete document upload lifecycle belong to later sessions.

## Routes

- `/`, `/basvuru/`, and `/basvurum/` are public.
- `/yetkili/` serves the staff application. Staff APIs require an individual D1 account and an opaque `staff_session` cookie.
- `/api/*` is handled by the Cloudflare Worker.

## Local development

1. Run `npm ci`.
2. Copy `.dev.vars.example` to `.dev.vars` and fill only the local service values you use.
3. Run `npm run db:migrate:local` to apply versioned migrations to the local D1 database.
4. Run `npm run dev:worker` to use the Vite Cloudflare runtime with local D1 and R2 bindings.
5. Run `npm test` for the full regression suite or `npm run build` for the production build.

`npm run dev` remains available for front-end-only work. It does not emulate Worker APIs. `pretest` and `prebuild` package the YKN extension before their main command. Local D1 and R2 emulation use the local bindings in `wrangler.jsonc` and are separate from staging.

## Cloudflare staging

The `staging` Wrangler environment is bound to D1 database `uluslarasiofis-staging` (`8f034e90-17fc-43d7-aa5d-125571019612`) and bucket `uluslarasiofis-documents-staging`. Wrangler config does not declare a public R2 domain, and the application creates no public object URLs. Before deployment, an owner must verify that public `r2.dev` and custom-domain access are disabled on the actual Cloudflare bucket; that dashboard state is not part of a local dry-run. The default Wrangler environment resolves the local Worker name, local D1 placeholder, and local bucket; staging commands explicitly select `--env staging`.

Inspect the staging deployment without publishing it with:

```sh
npm run deploy:dry-run:staging
```

Only an owner-authorized staging operation should apply the remote migration and deploy:

```sh
npm run db:migrate:staging
npm run deploy:staging
```

Both deploy scripts select the `staging` environment explicitly. A dry-run does not apply migrations, publish a Worker, create secrets, or bootstrap an administrator.

### Manual staging setup

Before a staging deployment, an owner must create a bucket-scoped R2 API token with object read/write permissions, then configure the Worker secrets. Presigning uses the S3 endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`; Cloudflare's presigned URL includes signature and credential-identification query parameters, so treat the complete URL as a bearer capability. The Secret Access Key itself stays in Worker secrets and is never returned by the storage adapter. Never log or persist signed URLs.

Configure only providers needed by the deployed Worker:

```sh
npx wrangler secret put STAFF_BOOTSTRAP_TOKEN --env staging
npx wrangler secret put R2_ACCOUNT_ID --env staging
npx wrangler secret put R2_ACCESS_KEY_ID --env staging
npx wrangler secret put R2_SECRET_ACCESS_KEY --env staging
npx wrangler secret put APPS_SCRIPT_URL --env staging
npx wrangler secret put APPS_SCRIPT_API_KEY --env staging
npx wrangler secret put AZURE_VISION_ENDPOINT --env staging
npx wrangler secret put AZURE_VISION_KEY --env staging
npx wrangler secret put GOOGLE_VISION_API_KEY --env staging
```

After an owner-authorized deployment, create the first admin once over HTTPS using the exact Worker origin in the `Origin` header. Use a generated one-time bootstrap token and a unique password of at least 12 characters:

```sh
curl -X POST 'https://<staging-worker-origin>/api/staff/auth/bootstrap' \
  -H 'Origin: https://<staging-worker-origin>' \
  -H 'X-Staff-Bootstrap-Token: <one-time-token>' \
  -H 'Content-Type: application/json' \
  --data '{"username":"<admin-username>","password":"<unique-password>","display_name":"<admin-name>"}'
npx wrangler secret delete STAFF_BOOTSTRAP_TOKEN --env staging
```

Bootstrap closes in D1 after the first admin is created, even if the secret is later restored. No default account or password is created.

## Worker bindings and secrets

Local `.dev.vars` can contain:

- `STAFF_BOOTSTRAP_TOKEN` for local first-admin bootstrap.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` for server-side local R2 signing. Leave them empty when capability signing is not needed.
- `APPS_SCRIPT_URL` and `APPS_SCRIPT_API_KEY` for the existing tebligat proxy.
- `AZURE_VISION_ENDPOINT`, `AZURE_VISION_KEY`, and `GOOGLE_VISION_API_KEY` for the staff OCR endpoint.

`R2_BUCKET_NAME` is selected by the local or staging Wrangler environment. It is a resource name, not a secret. `PORTAL_PRODUCTION_ORIGIN` is read by the extension packaging script from the shell environment. Set it to the exact HTTPS portal origin when packaging the production extension; it is not a Worker binding.

## Backend foundation

- D1 repositories isolate student, application, document, staff, session, assignment, audit, notification, and rate-limit persistence. Application creation batches the student/application/session/audit writes. The database enforces normalized student number uniqueness, one active application per student, and the `initial`/`renewal` application types.
- Applicant drafts require a student number, email, and phone. Their sessions use hashed opaque tokens. `GET /api/public/applications/current/status` returns a student-safe status using only the valid owner session. It does not implement recovery on another device; `student_number` is an identifier and grants no authorization.
- `POST /api/public/applications/current/submit` is an owner-session and same-origin contract. It currently returns `SUBMISSION_NOT_READY` because the required-document readiness provider is not implemented. It cannot move a draft to `submitted`; Phase 7 must supply complete server-side readiness before the atomic transition and audit can run. Session 2 does not claim end-to-end submission readiness.
- Staff roles are `admin` and `reviewer`. Staff passwords use versioned PBKDF2-HMAC-SHA-256 hashes with 600,000 iterations through Workers Web Crypto. Sessions are opaque, store only SHA-256 token hashes in D1, use `HttpOnly`, `Secure`, `SameSite=Strict` cookies, expire absolutely, and are rejected after 30 minutes idle. `last_seen_at` is touched at most every five minutes during active use. The 30-minute idle limit and touch interval live in `src/server/config/sessionPolicy.js`. Password reset and deactivation revoke prior sessions.
- R2 remains private. The storage provider adapter creates opaque UUID keys under `quarantine/`, performs Worker-mediated object operations, and can create method/object-bound S3 presigned PUT and GET capabilities with 30–300 second expiry. Upload content type is included in the signed request. The adapter never creates public object URLs. No route currently issues these capabilities; Phase 5 owns upload intent, finalize, browser CORS, and UI orchestration. Configure bucket CORS for the exact portal origins before enabling browser uploads. Presigned URLs must be treated as bearer tokens and never stored in D1 or logs.
- API errors use `{ error: { code, message, retryable }, requestId }` and an `X-Request-Id` header. Provider and database details stay server-side.
- Deployed Worker CPU use for the selected password KDF must be measured in staging before staff authentication is live-ready. Local tests do not certify deployed Cloudflare CPU budget.

## Apps Script integration

The server proxy accepts only `getAll`, `search`, `add`, `update`, `unmark`, and `remove`, and sends the key in the server-side JSON POST body. The Apps Script source reads the key from Script Properties under `API_KEY`; its live deployment must be updated and checked separately.

## Extension packaging

The extension package includes exact Apply and YÖKSİS origins. `PORTAL_PRODUCTION_ORIGIN` adds one HTTPS portal origin to the generated package. Do not add preview-domain or university-subdomain wildcards.
