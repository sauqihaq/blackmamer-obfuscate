# BLACKMAMER STUDIO — Premium Commercial Setup

This project now has a **PostgreSQL-backed license and administrator API**. The premium static frontend is distributed as a **manual Netlify ZIP** because the current Netlify site is deployed manually and does not auto-pull GitHub.

## Features
- Server-validated license access for `POST /api/obfuscate` when `LICENSE_ENFORCED=true`
- Separate admin authentication with 8-hour HMAC-signed bearer sessions
- Issue random 144-bit license keys (shown only once), assign customer, plan, UTC expiration, and daily quota
- Revoke/restore licenses, track daily usage and recent events in PostgreSQL
- No user script contents are stored by this license module

## Required Render Environment Variables

Set these in the **BLACKMAMER obfuscator backend service**, not Netlify.

```
DATABASE_URL=postgresql://...  # Obtain from your PostgreSQL provider
ADMIN_USERNAME=admin
ADMIN_PASSWORD=...            # Strong unique password, minimum 12 characters
ADMIN_SESSION_SECRET=...      # Random secret, minimum 32 characters
LICENSE_ENFORCED=true
```

Optional: `DATABASE_SSL=true` if your provider requires verified TLS. Never commit your passwords, connection string, or signing secret to GitHub or the frontend ZIP.

**Use a persistent PostgreSQL database** (you can start with a provider's free tier if eligible). Do not use filesystem JSON on Render Free as a customer license database, because local state is ephemeral. The backend automatically creates the `bms_licenses`, `bms_usage` and `bms_events` tables when an authorized database user first accesses an admin route.

Without all three required variables and `DATABASE_URL`, admin routes return 503 and will not pretend to log in. If `LICENSE_ENFORCED=true` and configuration is missing, obfuscation is **fail-closed (503)**. Until `LICENSE_ENFORCED` is set to true, legacy public obfuscation remains available for preview/testing. **Do not sell access until enforcement, persistence, and admin access are verified.**

## Deploy manual Netlify ZIP

1. Extract the provided `BLACKMAMER_PREMIUM_NETLIFY.zip`.
2. Open your existing Netlify site's **Deploys** and manually deploy the extracted folder (with `index.html`, `app.html`, `admin.html` and `assets/` at the root).
3. The frontend calls the Render backend configured in `assets/config.js`. This file is **public**. It must contain only the API base URL.
4. Pages:
   - `/`: premium marketing landing
   - `/app.html`: member workspace, Luau editor, native VM presets, external function key provider downloads, license activation
   - `/admin.html`: private admin console (database-backed; not a public mock)
5. Sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`, then create your first customer license.

Manual payments only: this release does **not** implement payment collection, card processing, invoices, refunds, recurring subscriptions, or email delivery. Admin should verify payment off-platform before issuing a key. No fictional prices or customer statistics are displayed.

## License endpoints

- Public: `GET /api/access/config`, `POST /api/access/check`.
- Obfuscation: `POST /api/obfuscate` with header `X-License-Key: BM-...`. The server validates status, expiry, and remaining UTC-day quota in a transaction before compiling the script.
- Admin login: `POST /api/admin/login` with `username`, `password`.
- Admin (Bearer session token): `GET /api/admin/summary`, `GET /api/admin/licenses`, `POST /api/admin/licenses`, `PATCH /api/admin/licenses/:id`.

Tokens are held in browser sessionStorage for the duration of the active browser tab, never embedded in the deployed HTML. Admin keys are not written to the frontend or git. Issued license keys are stored **only as SHA-256 hashes** in PostgreSQL; the cleartext key appears once in the create response.

## Production checks before selling
- Configure SSL/TLS database connection correctly.
- Set `LICENSE_ENFORCED=true`, verify requests without a license return 401, expired/revoked return 403, and quota exhaustion returns 429.
- Verify admin login and license creation on the deployed backend. Rotate any leaked secrets.
- Apply appropriate rate limits at the hosting/firewall edge for your customer volume. Current in-process login limiter is not distributed across instances.
- The first release is a manual license and quota system, **not yet a complete billing or customer-account platform**.
- Obfuscation (including VM or runtime decryption) is not a substitute for Roblox server-side authorization. Keep sensitive logic on the server.
