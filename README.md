# BLACKMAMER STUDIO — Native V4 Obfuscator

Independent Lua/Luau virtual-machine obfuscator. The **production backend is V4-only**; there is no Prometheus CLI/source checkout or Prometheus runtime dependency in the shipped Docker image.

## Supported runtime targets

| Target | Output runtime | Notes |
|---|---|---|
| `LuaU` | Roblox / Luau | Roblox `buffer` API; use server-side key provider for protected functions |
| `Lua51` / `Lua` | Vanilla Lua 5.1 | Pure Lua bit32 + string-backed bytecode reader; no native dependencies in output |
| `LuaJIT` | LuaJIT 2.x | Lua 5.1-compatible output, same portable runtime adapter |

These targets run the **supported BLACKMAMER parser subset**, not every Lua 5.1/Luau language feature. Luau-only constructs such as `+=`, `continue`, and `//` are rejected on Lua51/LuaJIT. For unsupported syntax, the API returns HTTP 422 rather than returning a falsely "protected" script.

## One-click website: Maximum V4 for Roblox Script / LocalScript / ModuleScript

Paste or upload a source file and press **Obfuscate Script**. The default
`LuaU` output is a standalone single-file chunk that can be pasted into a
Roblox **Script**, **LocalScript**, or **ModuleScript**. The one-click compiler
automatically enables Maximum V4, seven independent VM engines, AST string
protection, integrity checks, and standalone function encryption. No user
selection for client/server placement, license, or key provider is required.
The output's *actual execution permissions and runtime behavior* still depend
on its original Roblox placement and API calls; obfuscation does not turn a
client script into a server script or guarantee arbitrary Lua syntax support.

The **optional, collapsed advanced runtime selector** provides Lua 5.1
and LuaJIT output for users who need those interpreters. It cannot produce
one universal LuaU/Lua51/LuaJIT file: the interpreters require separate VM
adapters. The existing advanced API and server vault remain available to
integrators, but are intentionally not part of the single-click website.

**Security limit:** a client who can execute a LocalScript can recover its
standalone decrypt material. Maximum V4 raises the cost of static analysis
but is not unbreakable; put sensitive secrets and authoritative game logic
on the Roblox server and validate RemoteEvent arguments server-side.

For advanced API users, `executionContext: "client" | "server" | "portable"`
is still supported. Explicit `client` contexts reject external function
keys. Server code may opt into the separate server Remote Vault after
configuring licensing, PostgreSQL and Roblox Secrets Store.

See [Roblox client/server security and configuration](docs/ROBLOX_CLIENT_SERVER_SECURITY.md).

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

## Excluding performance-critical functions from virtualization

Native V4 Maximum supports **explicit per-function virtualization opt-out** with BLACKMAMER's own `BM_NO_VIRTUALIZE` compile-time marker, similar in purpose (not implementation) to Luraph's `LPH_NO_VIRTUALIZE`. No frontend setting, runtime function, or additional network/backend dependency is needed:

```lua
local RunService = game:GetService("RunService")
local total = 0

local update = BM_NO_VIRTUALIZE(function(dt)
    total = total + dt
    -- This function runs as native Luau, not the BLACKMAMER VM.
end)

RunService.RenderStepped:Connect(update)

-- All unmarked functions remain encrypted and VM-virtualized.
local function protectedLogic()
    return total * 100
end
```

The marker syntax is `BM_NO_VIRTUALIZE(function(args) ... end)`. It accepts **one anonymous function literal**, including direct callback arguments such as `RunService.Heartbeat:Connect(BM_NO_VIRTUALIZE(function(dt) ... end))`; other forms and nested markers fail compilation rather than silently disabling protection. Captures of surrounding virtualized locals are bridged through the original VM lexical environment, including mutable upvalues, so excluded callbacks can update variables that unmarked protected functions later read.

**Security limitation:** exempted function bodies intentionally remain plain native Lua/Luau in the generated output. They are **not encrypted or virtualized**. The rest of the VM, its seven variants, anti-tamper verification of sealed VM bytecode, function encryption and key handling remain active, but **the native function's own source is visible and not covered by the VM bytecode checksum**. Do not exclude licensing checks, secrets or sensitive game logic. Actual speedups depend on workload and extra bridging costs for captured variables; benchmark on Roblox devices.

Works for `LuaU`, `Lua51` and `LuaJIT` targets if their runtimes expose Lua 5.1-compatible `setfenv`. The compiler emits a fail-closed error rather than attempting to run an incorrectly scoped native callback if this compatibility API is missing. `blackmamerVM.nativeExemptFunctions` reports how many exemptions were applied, and every remaining function stays in the selected VM protection mode.

## Maximum V4: Per-prototype standalone format polymorphism

The old static extractor for sample #3 assumed a fixed 61-byte, seven-engine prototype header and one global per-PC operand decoding formula. Maximum now appends **five encrypted header bytes per prototype** and varies each prototype's pre-decoded instruction field encoding using a random seed, two coefficients and one of four reversible formulas. Two further randomly generated coefficients are compiled into that build's decoder. Because all instructions are converted to `parseStage` columns once per prototype, this adds first-call decoding work **without adding operations to each VM instruction dispatch**.

This changes the on-disk schema for Maximum standalone and Maximum external/remote modes. The new compiler and generated loader are version-compatible with each other. Lower protection profiles and archived V3 remain unchanged. Tests cover all three runtimes and check 15 independent builds for per-prototype variation. Existing differential and tamper suites verify the changed encoding still runs identical code.

**Security boundary:** A standalone output must still carry enough logic and data to compute every required decryption value. Random schemas and formula variants invalidate simple old-format extractors, but can still be reverse-engineered. Neither per-build randomization nor client-side key splitting makes the standalone master key secret. Real secrecy requires moving sensitive computation or key usage to a trusted server.

## Maximum V4 dead-code mosaic and IR optimizer

Maximum One-Click now includes a **two-stage compiler pipeline** that adds more structural decoy code without executing it on normal VM control-flow paths:

1. **CFG optimizer first:** after superinstruction fusion and AST/VM control-flow flattening, a conservative instruction-reachability pass removes unreachable *original* IR and relocates valid `JUMP`, `JF` and `JT` targets. It never reorders user operations or changes the semantics of reachable instructions.
2. **VM dead-code mosaic second:** the compiler inserts a randomized mix of genuine but unreachable virtual instructions (`K`, `GET`, arithmetic, `TABLE`, `MOV`, branching and return opcodes) behind unconditional VM control-flow barriers. It relocates all real jump targets, and the decoy blocks can link to one another. These instructions are indistinguishable from ordinary VM instruction types in the encrypted payload, but they remain removable by complete CFG reachability analysis.
3. **Bounded density:** Maximum targets about 2.7 dead instructions per optimized core instruction, capped at 1,024 per prototype and 8,192 across a compilation, with a hard 12,000-instruction per-prototype ceiling. Runtime paths execute **zero dead-code instructions**, although bytecode size, verification, unpacking and first-call decoding costs increase. No unbounded quadratic junk explosion.
4. **Security and portability unchanged:** independent seven-VM handler layouts, per-prototype opcode permutations, superinstruction fusion, bytecode sealing, native-function exclusions, remote vault, anti-debug and `__tostring` integrity checks remain active. Generated output is still a single physical line for Luau, Lua 5.1 and LuaJIT.

Telemetry fields include `optimizerEnabled`, `irOptimizerRemoved`, `vmCoreInstructions`, `deadCodeInstructions`, `deadCodeBlocks` and `deadCodeStrategy`. To compare benchmark baselines, `compile(...,{irOptimizer:false})` disables this new optimizer-and-mosaic stage (not other existing protections); the production Maximum One-Click default enables it. `tests/vm4-deadcode-optimizer.js` verifies that all decoy rows remain unreachable and that real CFG destinations remain correct.

This is **not** a guarantee of Luraph-level protection: dead code is noise, not encryption. It makes static inspection longer but a capable control-flow deobfuscator can discard it. The density is deliberately limited to balance protection appearance, artifact size and Roblox cold-start latency. Benchmark actual scripts before deciding whether a higher density would be worthwhile.

## Private metamethod `__tostring` anti-tamper trap

Native V4 hardened builds with `antiTamper:true` now create a **per-build isolated table sentinel** with its own locked `__metatable` and a `__tostring` function. The compiler generates a fresh challenge value for each output, then verifies that the real `tostring(sentinel)` invokes that exact metamethod, returns the correct value, and increments its invocation counter once. It also checks the sentinel's metamethod identity and the integrity of the `tostring`, `setmetatable`, `getmetatable` and `rawget` global functions.

- **Startup:** the `__tostring` probe runs once after existing VM bytecode verification and before executing the script.
- **Periodic:** when periodic anti-debug checks are enabled, the metamethod probe runs every third adaptive `runtimeGuard()` invocation rather than on every virtual instruction. Disabling `antiTamper` disables the metamethod trap; disabling only `antiDebug` retains the initial metamethod integrity probe.
- **Safe failure:** tampering terminates the protected script with a generic V4 error. It does **not** deliberately crash the Roblox process, hijack another object's metatable, damage user data, or corrupt the user's program state.
- **Scope:** this is a best-effort metamethod tamper detector, **not equivalent to Luraph's proprietary techniques** and not a guarantee against instrumentation or rewriting the exposed standalone runtime. The existing seven-VM topology, bytecode sealing, function-key policy, anti-debug guard, native-function opt-outs and single-line output remain unchanged.

Validate with `node tests/vm4-metamethod-trap.js`: test normal table metamethods, startup hook injection, suppressed metamethod calls, corrupted `__tostring` callbacks and periodic metatable modification under Lua 5.1, LuaJIT and the official Luau CLI. A randomized sentinel only adds tamper evidence; it cannot make client-side keys secret.

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
