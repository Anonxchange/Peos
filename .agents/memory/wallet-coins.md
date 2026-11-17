---
name: Wallet coin visibility
description: User's standing requirement for the wallet coin list.
---

Show all supported coins whether a wallet is connected or not, and keep them visible when connected with zero balances. Leave the design unchanged for now.

**Why:** The user explicitly requested persistent coin visibility and deferred the HTML design conversion.

**How to apply:** Coin metadata must not depend on connection or successful balance reads. Display confirmed zero separately from disconnected, loading, or unavailable balances; do not bypass wallet verification to show the list.

Wallet linking is enforced by the external `link-wallet` function, which requires a trusted application origin.

**Why:** Its deployed handler rejected the Replit preview's preflight and request with HTTP 403 and an origin-not-allowed error.

**How to apply:** When linking fails in a new preview or domain, check that exact origin against the backend allowlist. Preserve origin and signature verification rather than disabling them.
