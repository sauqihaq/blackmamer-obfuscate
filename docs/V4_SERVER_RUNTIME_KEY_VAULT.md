# BLACKMAMER Native V4 — Server Remote Key Vault

The one-click obfuscator now has two execution modes behind the same Obfuscate button:

- **Standalone** (default): works in Script, LocalScript and ModuleScript. No setup. All materials necessary to decrypt the client-side payload remain reconstructible from output.
- **Server Remote Vault** (opt-in): works only in Script or ModuleScript **running on the Roblox server**. Encrypts the entire V4 VM bytecode including entry. The generated file contains only a UUID and HTTPS endpoint. A 256-bit random key remains encrypted in BLACKMAMER's persistent PostgreSQL database. No extra Lua ModuleScript is required.

## Configure the Render backend

These environment variables are required on the real backend service, not the static Netlify site:

| Variable | Value |
| --- | --- |
| DATABASE_URL | Persistent PostgreSQL URL (shared with the commercial license database) |
| ADMIN_USERNAME | Administrator username |
| ADMIN_PASSWORD | Strong password at least 12 characters |
| ADMIN_SESSION_SECRET | Random signing secret at least 32 characters |
| LICENSE_ENFORCED | true |
| BLACKMAMER_VAULT_MASTER_KEY | **64 random hexadecimal characters (32 bytes)** |
| BLACKMAMER_RUNTIME_PUBLIC_ORIGIN | Optional HTTPS origin of the deployed key service |

Generate BLACKMAMER_VAULT_MASTER_KEY with a cryptographically secure RNG such as Node.js crypto.randomBytes(32).toString('hex'). Never commit this value or share it with the frontend. Back up the database and retain your master key: **rotating the key without migration makes previous vault records undecryptable**.

Without PostgreSQL, the master key and enabled licensing, the runtime service returns enabled:false at /api/runtime/config and remote compilation **fails closed (HTTP 503)**. Standalone stays functional. This pull request does not create a database or charge for cloud infrastructure.

## One-time experience setup (not per-script)

1. Admin issues a BLACKMAMER license to a user through the existing admin panel.
2. User activates the same license on the BLACKMAMER website.
3. User chooses **Script server / ModuleScript server — Remote Vault** and clicks Obfuscate. The generated output has no external decryption key.
4. Roblox experience owner enables **Allow HTTP Requests** in Experience Settings > Security.
5. In Roblox Creator Hub **Secrets Store**, create a secret named **BLACKMAMER_LICENSE** containing the license key. To test in Studio, set the corresponding local secret. See the official Roblox documentation.
6. Paste the output into a server Script or server-required ModuleScript. At startup, the generated runtime calls HttpService:GetSecret("BLACKMAMER_LICENSE"), then HttpService:RequestAsync with its credential in X-BM-License header and the public artifact UUID. It retrieves its key automatically and caches it in server memory.
7. Do not place server-vault output in a LocalScript or client ModuleScript: that will fail closed.

### Authentication and key storage

Runtime keys are encrypted at rest using AES-256-GCM with a unique nonce and associated artifact/owner IDs. The backend only releases keys if the request contains a valid, non-revoked and unexpired customer license, and that license owns the requested artifact. The authorization header is not embedded in the generated script. The artifact ID is public but insufficient to obtain the key. The response uses Cache-Control: no-store.

A license can be revoked, preventing **new** key requests. Already-running servers may retain decrypted keys until they restart. The vault has a basic in-process rate limiter; add edge-level limits in larger deployments.

### Honest security constraints

A server with the right to decrypt bytecode can still be observed or instrumented by a sufficiently privileged operator. This is not an unbreakable or Luraph-equivalent defense. Roblox SecretStore and HTTP requests operate on **game servers**; they do not make client-side secrets hidden in LocalScripts. Standalone mode is unchanged, and its key remains extractable.

Official Roblox documentation:
https://create.roblox.com/docs/cloud-services/secrets
https://create.roblox.com/docs/cloud-services/http-service

## Tests

- node tests/runtime-key-vault.js (AES-GCM record authenticity)
- node tests/vm4-only-api.js (fail closed without a configured database)
- LUAU_BIN=luau node tests/vm4-remote-luau.js (server Script, server ModuleScript, key retrieval mock, wrong/missing-key tests)
- Existing V4 Lua51/LuaJIT, C++ sealer, commercial-access and frontend suites.
