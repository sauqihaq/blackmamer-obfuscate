# BLACKMAMER V4 Roblox API anti-hook and backend key choices

## Overview

One-click **Roblox Luau** output enables `robloxApiGuard` by default in the backend. This is **best-effort anti-hook and environment validation**, not a trusted attestation. It does not hide observable gameplay behavior from a client capable of controlling its runtime.

The guard checks before executing user code:
- `game` and `script` are Roblox userdata whose `typeof` reports `Instance`;
- `game:IsA("DataModel")` and `script:IsA("LuaSourceContainer")` succeed;
- `typeof`, `task`, and `task.wait` are available, and known host bindings have not changed;
- `game`, `script`, `task`, and `typeof` are checked before VM global reads and at periodic VM integrity probes;
- VM writes to these protected host globals are rejected.

A proxy that was installed before startup could also fake type checks and API responses, and a privileged client can replace or patch the generated guard. There is no portable, fully reliable method for proving that a client runtime is not hooked. Avoid using false positives as license-enforcement evidence. Lua 5.1 and LuaJIT remain portable and do not run Roblox-only host checks. Calling a protected artifact inside an external `pcall` can catch a guard error, but cannot make the failing VM continue executing.

## Server-only backend key vault

The existing `runtimeMode:"server-vault"` is the only option in the public API which stores **the decrypting key outside the generated source**. It requires `target:"LuaU"`, `executionContext:"server"`, `oneClick:true`, persistent PostgreSQL, active license enforcement, and the backend vault master key. Generated code refers to a public artifact ID and backend HTTPS URL; the key remains encrypted in PostgreSQL at rest and is delivered only to an authenticated Roblox **server** runtime.

The server executes the protected code after retrieving its key with `HttpService:GetSecret("BLACKMAMER_LICENSE")` and `HttpService:RequestAsync`. Enable `Allow HTTP Requests` and configure Roblox Secrets Store. The secret license value must never be embedded into client code or uploaded with a repository.

**Important distinction:** after an authorized server obtains the key, the key is present in that server's memory. A privileged server operator could still inspect it. The current server vault uses BLACKMAMER Maximum V4 with server-key encryption and does **not** yet run the full 11-step Prometheus prepass. Do not claim it does. The standalone one-click mode still runs the 11 steps but necessarily includes reconstructible decryption material in its artifact.

LocalScripts and client-replicated ModuleScripts **cannot** keep their decryption key solely on the backend while also independently executing locally. This is a trust boundary, not a missing obfuscation checkbox. Keep truly sensitive logic on the server and send only necessary results to the client.

## Testing and operational status

- `node tests/frontend-smoke.js`: verifies mode selection, license header and no silent downgrade in response validation.
- `node tests/vm4-only-api.js`: verifies one-click guard metadata, vault configuration failure and client/server policy.
- `LUAU_BIN=luau node tests/vm4-roblox-host-guard.js`: asserts table-proxy and custom environments cannot execute the protected payload. This **does not** prove compatibility in genuine Roblox Studio.
- Existing V4/Prometheus and Lua51/LuaJIT suites must remain green.

The GitHub `netlify-frontend/index.html` is a static deployment asset; updating it in GitHub does not update an independently/manual deployed Netlify site. Publish the template separately after testing the backend and actual site licensing integration. Never expose a server vault option if the backend has no configured persistent store or licensing.
