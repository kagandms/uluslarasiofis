# D1 usage counter

The authenticated staff homepage counter reads the account-wide D1 `rowsRead` metric for the current UTC date from Cloudflare's GraphQL Analytics API. Its API endpoint requires a valid staff session. Cloudflare's analytics may lag behind current activity, so the displayed number is an operational indicator rather than a real-time guarantee. The response is cached at each Worker edge for five minutes.

Production requires a Cloudflare API token scoped to **Account Analytics:Read**. Store it as the Worker secret with `npx wrangler secret put D1_ANALYTICS_API_TOKEN --env production`; never add the token to source files or browser assets. The account ID is configured as `D1_ANALYTICS_ACCOUNT_ID` in `wrangler.jsonc`. Without the token, the widget displays an unavailable state instead of reporting zero.

The counter's 5,000,000 limit matches the Workers Free daily D1 rows-read allowance. Cloudflare resets daily free limits at 00:00 UTC.
