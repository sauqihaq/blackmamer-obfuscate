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

## Maximum One-Click: polymorphic table/state-machine output

The single-button `NativeV4` profile with `oneClick:true` keeps the same API and frontend runtime choices: `LuaU` (Roblox Script/LocalScript/ModuleScript), `Lua51` (vanilla Lua 5.1) and `LuaJIT` (LuaJIT 2.x). The compiler still rejects unsupported syntax instead of emitting a broken script.

Maximum V4 output now uses an independently implemented two-phase `setmetatable` entrypoint. Its seven independent language VM engines each resolve per-prototype randomized opcodes using a lazily cached opcode route table with direct indexed lookups and randomized control-flow state labels rather than a fixed opcode `elseif` chain. The engine selector is a different encoded function table in each build. The runtime local register, program-counter, opcode and prototype identifiers are polymorphically renamed using mixed short/long collision-checked names.

This architecture is conceptually similar to generic table/state-machine VM obfuscation; it **does not copy code from Loader.luau or Luraph**. Greater static complexity and size are **not** a guarantee of cryptographic strength or protection against runtime tracing. Generated standalone decryption material remains recoverable; external key providers are reserved for trusted host environments. Additional dispatcher transitions add execution overhead; benchmark scripts on Roblox devices and both Lua runtimes before production use.

Validate topology with `node tests/vm4-loader-topology.js`; the CI suite also checks Luau execution, Lua 5.1/LuaJIT compatibility, anti-tamper behavior and 50-program differential parity.

## Output layout: one physical line

BLACKMAMER V4 produces a **single, dense physical Lua/Luau line** for every standalone runtime (`LuaU`, `Lua51`, `LuaJIT`). The compiler's token-preserving minifier and per-build runtime symbol polymorphism remain active, but optional whitespace chaos only inserts spaces, never line breaks. The API folds the branded ASCII-art block comment into the same physical line, so the entire downloaded `obfuscated` string has no `CR` or `LF` characters. This is a **presentation preference, not a security mechanism**. An editor may still visually soft-wrap long text without changing the file's actual line count.

## VM execution hot-path optimisation

Maximum one-click mode retains all **seven independently shuffled interpreters**, their per-function opcode palettes, state-machine handler families, bytecode encryption, lazy constant decoding, startup/periodic checks, integrity validation, and optional external key providers. This optimization deliberately does **not** replace the virtual interpreter with unprotected native Lua, turn off anti-tamper, or relax any license checks.

- **Opcode router caching:** Previously, every invocation rebuilt a 49-entry `setmetatable` table keyed by the executing function's opcode palette. Now it is constructed once per decrypted prototype and saved to a per-build-randomized private cache slot on that prototype. A repeatedly invoked function reuses its own router; different prototypes still have independent palettes and engine assignments.
- **Direct lookup:** The interpreter reads the precomputed route table with `route[op]` rather than invoking `__call` on each VM instruction. A `__index` fallback still returns an invalid state for unknown opcodes, which the original state-machine invalid-opcode guard rejects.
- **Instruction column locals:** The four pre-decoded instruction arrays are loaded into randomized local aliases at function entry and indexed directly on each VM tick. The `parseStage(fid,spec)` decoding cache remains unchanged.
- **Trade-off:** The cache consumes approximately one 49-entry route table per executed prototype instead of allocating one per call. This saves route constructions on hot functions while retaining all VM state transitions; high-frequency virtualized loops still pay a substantial VM dispatch cost.

Run `node tests/vm4-lua51.js` with Lua 5.1 and LuaJIT installed: the suite instruments Lua's `setmetatable` to verify that 400 calls to a virtualized function do not create 400 opcode maps. For actual frame-time measurement use representative Roblox `RenderStepped` workloads; code-level changes alone do not establish a guaranteed speed-up or prove an identical attack cost against advanced dynamic instrumentation.

## Performance and production integrity hardening

- **Adaptive runtime guard:** V4 runs the initial integrity/debug sanity check at load, then in each executing prototype scales its periodic guard interval by `1 + min(7, floor(instructionCount/64))`. Short functions retain the original per-build jitter; larger functions check less frequently (up to 8× spacing). This avoids repeated expensive `debug.info` probes in larger hot paths, but does **not** eliminate their overhead or guarantee a slowdown-free frame loop. The fixed 1,000,000 VM-instruction safety ceiling is unchanged.
- **Decode caching:** each `prototype(fid)` reads and unseals the function body once per output chunk into `P[fid]`; `parseStage(fid,spec)` separately caches the four execution columns in `programCache[fid]`. Engine call paths consult `prototype(fid)` and the parse cache. Constants and the optional outer VM have their own separate decode paths; those are not repeated per call.
- **C++ sealer scope:** `native-sealer.js` accelerates compilation/sealing on the backend only. Generated Lua runs on Lua/Luau and does not execute C++; native sealing **does not speed up Lua runtime instruction dispatch**.
- **Fail-closed tamper reaction:** the VM keeps a generic error on detected tampering, rather than silently corrupting opcodes or user data. Silent corruption can create difficult-to-diagnose failures and is not a secure substitute for server-side authorization.
- **Distributed Vault limiter:** the remote key endpoint atomically counts up to 120 requests per license hash in each database-clock minute using PostgreSQL. Multiple Render processes share this limit **only when connected to the same database**. For separate services using different databases, place a shared edge/gateway rate limiter in front of them. Expired counter rows are opportunistically purged after one day.
- **Strict license shape:** current keys are exactly `BM-` followed by six uppercase 6-hex-character groups (44 characters including hyphens), matching every key already issued by this project's commercial generator.
- **Actual seven-VM diversity:** the test-only `auditVmTopology:true` mode computes SHA-256 fingerprints of real handler membership and order in each VM's dispatch families, ignoring random labels. `tests/vm4-guard-vm-diversity.js` checks 70 unique handler topologies across 10 builds. These hashes are not included in the generated Lua or normal API responses.

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
