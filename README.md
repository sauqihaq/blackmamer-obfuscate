# BLACKMAMER STUDIO — Native V4 Obfuscator

Independent Lua/Luau virtual-machine obfuscator. The **production backend is V4-only**; there is no Prometheus CLI/source checkout or Prometheus runtime dependency in the shipped Docker image.

## Supported runtime targets

| Target | Output runtime | Notes |
|---|---|---|
| `LuaU` | Roblox / Luau | Roblox `buffer` API; use server-side key provider for protected functions |
| `Lua51` / `Lua` | Vanilla Lua 5.1 | Pure Lua bit32 + string-backed bytecode reader; no native dependencies in output |
| `LuaJIT` | LuaJIT 2.x | Lua 5.1-compatible output, same portable runtime adapter |

These targets run the **supported BLACKMAMER parser subset**, not every Lua 5.1/Luau language feature. Luau-only constructs such as `+=`, `continue`, and `//` are rejected on Lua51/LuaJIT. For unsupported syntax, the API returns HTTP 422 rather than returning a falsely "protected" script.

## Five layered V4 presets

| Level | AST dead branches | VM bytecode CFG flatten | Nested VM | Fused ops |
|---|---|---|---|---|
| Minify | No | No | No | No |
| Light | Low | No | No | Yes |
| Medium | Medium | Yes | Yes | Yes |
| Strong | High | Yes | Yes | Yes |
| Maximum | Highest | Yes | Yes | Yes |

All levels use the BLACKMAMER V4 compiler, per-function opcode palettes, instruction-dependent operand layouts, lazy sealed constants and C++ backend sealer. "Minify" is the lowest-overhead **V4 VM profile**, not plain Lua minification. More transforms can increase code size, compilation time and execution overhead.

The independent AST transform injects unreachable side-effect-free branches, and a bytecode-IR basic-block pass relocates control-flow targets, adds explicit fallthrough jumps and shuffles block order while retaining the VM entry. This is BLACKMAMER's own transformation, **not Prometheus source code**.

## Example API request

```bash
curl -X POST https://blackmamer-obfuscate.onrender.com/api/obfuscate \
  -H "Content-Type: application/json" \
  -d '{"preset":"NativeV4","protectionLevel":"Strong","target":"Lua51","script":"local function f(x)return x*2 end;print(f(21))","autoFunctionEncryption":"off"}'
```

For a commercially licensed deployment, provide the `X-License-Key` header if `LICENSE_ENFORCED=true`. The existing admin/license endpoints remain supported.

Function encryption modes: `off`, `standalone`, `external`, `external-full`. **external-full encrypts the entry point as well**, and therefore needs a host-side key provider before the generated chunk starts executing. The standalone decrypt key is necessarily reconstructible from the output; **external** keeps keys out of the generated script and requires a trusted host provider. On Roblox, use a server-only `ServerScriptService/BlackmamerKeyProvider` ModuleScript. For vanilla Lua 5.1/LuaJIT, define `BLACKMAMER_KEY_PROVIDER(id)` in the host environment before running the obfuscated output. See [Auto Function Encryption](docs/AUTO_FUNCTION_ENCRYPTION.md).

## Named V4 presets and CLI (development branch)

These are additive to the legacy `NativeV4` API preset. Each selected preset has fixed protection options so callers cannot silently downgrade it.

| Preset | ISA dispatch families | Packed instruction layout | Key policy |
|---|---|---|---|
| `fast` | 1 | AoS; decoded into four execution columns | no automatic external key |
| `balanced` | 3 | per-prototype hybrid AoS/SoA | manual protected-function keys only |
| `paranoid` | 3 | SoA for every prototype | external key provider is **mandatory** (including the entry function) |

Every generated script gets a random build watermark and SHA-256/HMAC-derived per-build function keys. The watermark is public and **not** an encryption secret. The bytecode pipeline now has separate lazy stages: `parseStage` reads/unseals packed prototype blobs once into opcode/destination/operand columns, then `exec` runs those columns. For an outer micro-VM build, the outer VM runs during this first decode stage, not during every executed instruction. Memory overhead increases with decoded function count; benchmarks are needed before promising a speedup.

```sh
node cli.js --preset=balanced --target=Lua51 --out=protected.lua input.lua
node cli.js --preset=paranoid --target=LuaU --out=protected.lua --keys-out=protected.keys.json input.luau
npm run test:presets
npm run test:differential
```

The `paranoid` output requires `BLACKMAMER_KEY_PROVIDER(id)` in a trusted host environment before evaluating the script. Keep the separately generated keys **out of the output Lua file and public repositories**; never run this profile client-side with a public key and call it secret. The API also accepts `{"preset":"fast"|"balanced"|"paranoid"}`; `NativeV4` remains the compatible default. Note that the current compiler has **49** instruction types, not 48, so it validates against the actual opcode count.

The differential regression executes fifty input programs against official Lua 5.1 and compares stdout after V4 obfuscation (balanced and paranoid). The fixtures cover arithmetic, loops, closures, metatables, coroutines, and object-oriented method patterns. New code that intentionally segfaults debuggers or emits invalid Lua escapes is not used: neither reliably protects a runtime and both break normal execution or tooling.

## Run and test

```bash
npm install
node server.js
node tests/vm4-only-api.js
# Install official Lua 5.1 and LuaJIT runtimes:
node tests/vm4-lua51.js
# With official Luau CLI available:
LUAU_BIN=luau node tests/vm4-luau.js
LUAU_BIN=luau node tests/vm4-external-luau.js
```

The Docker deployment compiles a native C++17 sealer at build time and uses it on the backend. The generated scripts execute only Lua/Luau; they do **not** depend on C++ binaries.

## Independent implementation and attribution

This V4 implementation contains independent BLACKMAMER AST and bytecode passes, custom VM interpreter, and C++ sealer. It does not copy, import, bundle, wrap, or invoke the Prometheus software. Taking general compiler ideas such as dead-code injection or control-flow flattening is distinct from incorporating upstream licensed source code. **If Prometheus code is actually copied or used in a future release, its repository's custom license contains mandatory attribution conditions and those must be followed.**

Older compiler files are retained in Git history for migration/debugging, but the production Docker container serves only V4.

## Security reality

No standalone obfuscation can guarantee resistance against runtime instrumentation. Real keys for customer authorization and Roblox game economy logic belong server-side. Run differential tests and performance benchmarks against actual scripts before selling a protection guarantee. Do not promise Luraph-equivalent strength without independent evidence.


## Server Remote Key Vault (optional)

The BLACKMAMER one-click workflow now has two choices: default **Standalone** output for Script/LocalScript/ModuleScript, or optional **Server Remote Vault** for Script and server-required ModuleScript. Server Vault encrypts even the VM entry bytecode, persists the decryption key on the authenticated backend using PostgreSQL + AES-256-GCM, and automatically accesses it from Roblox server via HttpService:GetSecret and RequestAsync. The obfuscated code contains no decryption key and needs no separate BlackmamerKeyProvider ModuleScript.

Remote Vault **requires** a persistent PostgreSQL database, commercial licensing enabled, a BLACKMAMER_VAULT_MASTER_KEY backend secret, and a one-time Roblox Creator Hub Secret named BLACKMAMER_LICENSE containing the customer's valid license. The server only accepts a licensed artifact owner. The deployment fails closed if any prerequisite is missing. **LocalScripts cannot use Server Vault**; standalone client keys remain recoverable. See [Server Remote Key Vault setup](docs/V4_SERVER_RUNTIME_KEY_VAULT.md).

## Admin / commercial setup

See [Premium Commercial Setup](docs/PREMIUM_COMMERCIAL_SETUP.md) for Render PostgreSQL, environment variables, license quota, admin authentication, and manual Netlify deployment. The premium frontend is delivered as a manual-upload ZIP to preserve the existing Netlify site.
