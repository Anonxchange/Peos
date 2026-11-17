# Release the wallet-origin fix

Deploy `index.ts` to the **existing** `link-wallet` function in the original
Supabase project. Do not replace the database, change its tables or RPCs, remove
signature checks, or expose any service-role key to the frontend.

## Required Supabase function setting

In the original Supabase project's **Edge Functions → Secrets**, add the exact
preview origin below to `SIWE_ALLOWED_ORIGINS`. This is a backend setting, not a
Replit frontend variable. If the setting already contains origins, preserve them
and append this one, separated by a comma:

```text
https://8acac50b-120e-47e8-9ce1-7eb65cd6cbe5-00-3vmg27xmcjypl.archer.replit.dev
```

Only trust origins you control. Do not allow all `*.replit.dev` hosts or disable
origin validation. The current Pexly domains remain in the default allowlist.
Add a new exact preview origin if the preview address changes.

## What changed

The uploaded authentication implementation is preserved. The CORS header list
now also permits Supabase JS's platform/runtime metadata headers. The existing
`SIWE_ALLOWED_ORIGINS` setting already supports the missing preview origin.

Keep the existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` in Supabase. Keep the current gateway authentication
settings; this patch does not require changing them.

## Verification

Local tests exercise the actual handler with a mocked Supabase transport and
real synthetic wallet signatures. They do not link a real user's wallet or
change the live Supabase project.

After releasing, a preflight request from the exact configured preview origin
must succeed and include the Supabase metadata headers. Linking still requires
a signed-in Pexly session, an unexpired single-use nonce and a valid wallet
signature matching the trusted origin.
