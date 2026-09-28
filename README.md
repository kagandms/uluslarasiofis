# Uluslararası Öğrenci Ofisi Portalı

The repository contains the public student portal foundation, a separate staff application, same-origin server APIs, and the YKN Chrome extension.

## Routes

- `/` is the public portal landing page.
- `/basvuru/` and `/basvurum/` are public placeholders for later phases.
- `/yetkili/` serves the staff application and requires a server-verified session before initializing its tools.
- `/api/*` contains server-side endpoints. Staff APIs require the `staff_session` HttpOnly cookie.

The YKN, Kapak Hazırla, Tebliğ Bul, and document workflows remain in the staff application. Student application workflows, uploads, and application data storage are not part of this session.

## Local development

1. Install the locked dependencies with `npm ci`.
2. Copy `.env.example` to `.env` and configure the required server values in the local runtime.
3. Run `npm run dev` for the Vite development server.
4. Run `npm test` for the test suite. `pretest` packages the extension first.
5. Run `npm run build` for the production build.

A plain Vite dev or preview server does not emulate Vercel's `/api/*` functions. Staff sign-in, OCR, and cloud tebligat operations require a serverless runtime or the deployed environment; the client keeps the staff tools closed when that API is unavailable.

The extension bridge accepts the staff route on `localhost` ports 4173 and 5173. It only forwards portal messages while `/api/session` confirms a valid staff session.

## Server configuration

Set these values in the serverless deployment environment; do not put credentials in frontend code or commit them:

- `SITE_PASSWORD`: temporary shared password for `/yetkili/` in Session 1 only. This is not the final authentication model and must be removed in Session 2. The public `/`, `/basvuru/`, and `/basvurum/` routes do not require it.
- `JWT_SECRET`: random signing secret of at least 32 characters.
- `APPS_SCRIPT_URL`: the deployed Google Apps Script web app URL.
- `APPS_SCRIPT_API_KEY`: the server-to-server key stored in the Apps Script project's Script Properties as `API_KEY`.
- `AZURE_VISION_ENDPOINT` and `AZURE_VISION_KEY`: preferred OCR provider.
- `GOOGLE_VISION_API_KEY`: OCR fallback provider.
- `PORTAL_PRODUCTION_ORIGIN`: the exact HTTPS origin of the production portal, such as `https://portal.example.edu`.

The extension packaging step fails on Vercel unless `PORTAL_PRODUCTION_ORIGIN` is configured. Local packages include only the supported loopback staff origins. Never add preview-domain or university-subdomain wildcards to the extension manifest.

The tebligat APIs have a 60-second Vercel function limit and abort their Apps Script request after 50 seconds so they can return a controlled timeout response. The browser keeps its existing 90-second wait and falls back to cached data when a cloud request fails.

## Apps Script redeployment

The repository source now rejects every GET request and accepts only allowlisted JSON POST actions with a key from Script Properties. The server proxy sends `action`, request parameters, and `key` as JSON in a POST body; the Apps Script source reads the key from Script Properties under `API_KEY`. Supported actions are `getAll`, `search`, `add`, `update`, `unmark`, and `remove`. The live Apps Script deployment has not been updated or tested as part of Session 1. The owner must complete these manual deployment tasks after this session:

1. Generate a new random API key and update `APPS_SCRIPT_API_KEY` in the server environment.
2. Set the same value as the Apps Script project's `API_KEY` Script Property.
3. Deploy the updated `apps_script.txt` source as a web app, then set the deployed URL in `APPS_SCRIPT_URL`.
4. Verify the server proxy and staff session against the deployed environment, including all read and mutation actions.

These live deployment, verification, and key rotation tasks are intentionally manual and do not block the Session 1 code closeout. The repository cannot update deployment settings or rotate values already stored in external services. Treat any previously exposed credentials as compromised until rotated.

## Session 2 authentication and backend handoff

Session 1 keeps the shared `SITE_PASSWORD` login only as an interim staff gate for `/yetkili/`. Remove this shared password in Session 2. The public `/`, `/basvuru/`, and `/basvurum/` routes must remain public and must never request the shared staff password.

The Session 2 staff authentication source is individual username/password accounts stored in Cloudflare D1, with `admin` and `reviewer` roles. The current HttpOnly, Secure session-cookie pattern may be retained if it fits that implementation, but the cookie must represent a D1-backed staff account rather than the shared `SITE_PASSWORD`. The owner-selected backend direction is Cloudflare Workers, D1, and private R2. No staff-account migration or backend migration is implemented in Session 1.

## Architecture boundaries

- Staff session state is an HttpOnly, Secure, SameSite=Strict cookie; JavaScript does not receive a bearer token.
- The current cookie is backed by the interim shared-password login; Session 2 must replace that authentication source with D1-backed individual staff accounts and role checks.
- Staff APIs validate the cookie, and state-changing requests validate the request origin.
- Apps Script credentials stay in server environment variables and are sent only in the POST body from the server proxy.
- The Chrome extension has exact Apply and YÖKSİS origins. Production portal access is injected into the generated package from `PORTAL_PRODUCTION_ORIGIN`.
- Public UI strings are stored in parallel Turkish, English, Russian, Turkmen, and Arabic dictionaries. Arabic sets RTL document direction.
