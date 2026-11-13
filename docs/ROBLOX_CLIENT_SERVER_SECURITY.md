# BLACKMAMER V4 — Roblox client vs server security

## What this change fixes

Roblox **LocalScripts** and client-replicated ModuleScripts are inspectable by the client.
A standalone V4 chunk necessarily includes its decoding material; neither nested
VMs nor randomized opcode palettes make those bytes confidential. Sensitive
business logic must run in **Script** or ModuleScript on the Roblox server.

The API and one-click website now pass a distinct `executionContext` value.
These are trust boundaries, **not** new Luau language targets.

| Runtime choice | `executionContext` | `runtimeMode` | Key security |
| --- | --- | --- | --- |
| LocalScript / client ModuleScript | `client` | `standalone` | Decryption data recoverable by client; no external keys allowed |
| Server Script / server ModuleScript | `server` | `standalone` | Works offline, but standalone key reconstructible from output |
| Server Script / server ModuleScript | `server` | `server-vault` | Remote key via Roblox Secrets Store; license, database and HTTP required |
| Lua51 / LuaJIT (non-Roblox) | `portable` | `standalone` | Existing CLI/provider modes unchanged |

### API examples

**Client**: `POST /api/obfuscate`

```json
{
  "script": "print('client')",
  "preset": "NativeV4",
  "target": "LuaU",
  "oneClick": true,
  "executionContext": "client",
  "runtimeMode": "standalone"
}
```

**Server Vault**: same request with `executionContext: "server"` and
`runtimeMode: "server-vault"` plus an active `X-License-Key` request header.
Use this output only in a server Script/ModuleScript. Configure
`BLACKMAMER_LICENSE` through Roblox's Secrets Store as documented in
[`V4_SERVER_RUNTIME_KEY_VAULT.md`](V4_SERVER_RUNTIME_KEY_VAULT.md).

`securityModel` in the response records `executionContext`, `runtimeMode`,
`keyLocation`, and applicable `warnings`. Treat this as descriptive
metadata: it is not a remote attestation that code was deployed in the declared
location.

### Fail-closed behavior

- `client` and `server` require `LuaU`.
- A `client` request cannot use `paranoid`, automatic `external` /
  `external-full` encryption, or supplied `functionKeys`.
- If a client script uses the `BM_ENCFUNC` intrinsic to request a key,
  compilation may run for validation but the API **does not return**
  the compiled script or generated keys.
- `server-vault` rejects a client context and fails closed when its
  authenticated server backend is not configured.
- Existing requests without `executionContext` remain compatible and
  receive `unspecified` (Luau) or `portable` (Lua51/LuaJIT) metadata.

For local builds use:

```sh
node cli.js --preset=balanced --target=LuaU --context=client --out=client.luau input.luau
node cli.js --preset=paranoid --target=LuaU --context=server --keys-out=server.keys.json --out=server.luau input.luau
```

Keep `server.keys.json` out of Git and all client-replicated locations.

### Limits and Roblox architecture

- VM complexity raises reverse-engineering cost; it does not guarantee
  confidentiality on a device controlled by the attacker.
- In server code, never trust client-provided RemoteEvent or RemoteFunction
  data without validation, rate limits, and authority checks.
- Do **not** send decryption keys, admin credentials, purchase secrets,
  or licensing credentials through ReplicatedStorage, client Lua, or public APIs.
- `X-BM-Universe` is a caller-supplied ID and **not independently verified
  Roblox instance identity** by this key vault; it is an additional filter
  only, not a strong proof of execution origin.
- A privileged operator of an authorized Roblox server can still inspect
  decrypted bytecode or retain keys in memory.

### Tests

```sh
node tests/runtime-security-policy.js
node tests/vm4-only-api.js
node tests/frontend-smoke.js
```

The API smoke test needs dependencies; the GitHub Actions workflow installs
them in CI. Never claim success on deployed Roblox until testing there.
