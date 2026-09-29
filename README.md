# Uluslararası Öğrenci Ofisi Portalı

The repository contains the public student portal, staff workspaces, a YKN Chrome extension, and the foundation for student residence applications. The application wizard and document upload flow are planned for later sessions.

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

`npm run dev` remains available for front-end-only work. It does not emulate Worker APIs. `pretest` and `prebuild` package the YKN extension before their main command.

Local D1 and R2 emulation are isolated from staging. No production database or bucket is configured in this repository.

## Cloudflare staging

The `staging` Wrangler environment is bound to D1 database `uluslarasiofis-staging` (`8f034e90-17fc-43d7-aa5d-125571019612`) and the private bucket `uluslarasiofis-documents-staging`. The bucket has no public URL configuration. The default Wrangler environment uses local-only bindings.

Apply the staging migration and deploy the Worker with:

```sh
npm run db:migrate:staging
npm run deploy:staging
```

The staging build sets `CLOUDFLARE_ENV=staging` before Vite runs. Wrangler deploy uses the flattened staging config produced by that build; do not add `--env staging` to the deploy command.

Set server-only credentials with Wrangler secrets, never in frontend code, `.dev.vars.example`, or committed config. Configure only providers needed by the deployed staff tools:

```sh
npx wrangler secret put STAFF_BOOTSTRAP_TOKEN --env staging
npx wrangler secret put APPS_SCRIPT_URL --env staging
npx wrangler secret put APPS_SCRIPT_API_KEY --env staging
npx wrangler secret put AZURE_VISION_ENDPOINT --env staging
npx wrangler secret put AZURE_VISION_KEY --env staging
npx wrangler secret put GOOGLE_VISION_API_KEY --env staging
```

After deployment, create the first admin once over HTTPS using the exact Worker origin in the `Origin` header. Use a generated one-time bootstrap token and a unique password of at least 12 characters:

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
- `APPS_SCRIPT_URL` and `APPS_SCRIPT_API_KEY` for the existing tebligat proxy.
- `AZURE_VISION_ENDPOINT`, `AZURE_VISION_KEY`, and `GOOGLE_VISION_API_KEY` for the staff OCR endpoint.

`PORTAL_PRODUCTION_ORIGIN` is read by the extension packaging script from the shell environment. Set it to the exact HTTPS portal origin when packaging the production extension; it is not a Worker binding.

## Backend foundation

- D1 repositories isolate student, application, document, staff, session, assignment, audit, notification, and rate-limit persistence.
- The database enforces one active application per student and restricts application types to `initial` and `renewal`.
- Applicant drafts require a student number, email, and phone. Student sessions use hashed opaque tokens.
- Staff passwords use salted PBKDF2-HMAC-SHA-256 through Workers Web Crypto; D1 stores only the versioned hash. Staff sessions store a SHA-256 hash of a random token and use `HttpOnly`, `Secure`, `SameSite=Strict` cookies.
- The staff bootstrap token is one-time. Login attempts are rate limited. Admin-only user management is enforced by the Worker.
- R2 object keys are random UUIDs in the private quarantine namespace. Binary content is accessed only through an authorized Worker endpoint; public object URLs are not generated.
- API errors use `{ error: { code, message, retryable }, requestId }` and an `X-Request-Id` header. Provider and database details stay server-side.
- Worker CPU usage for the selected password KDF must be verified in the target Cloudflare plan before staff authentication is considered live-ready. The local test suite does not certify Cloudflare CPU budget or a deployed staging flow.

## Apps Script integration

The server proxy accepts only `getAll`, `search`, `add`, `update`, `unmark`, and `remove`, and sends the key in the server-side JSON POST body. The Apps Script source reads the key from Script Properties under `API_KEY`; its live deployment must be updated and checked separately.

## Extension packaging

The extension package includes exact Apply and YÖKSİS origins. `PORTAL_PRODUCTION_ORIGIN` adds one HTTPS portal origin to the generated package. Do not add preview-domain or university-subdomain wildcards.
