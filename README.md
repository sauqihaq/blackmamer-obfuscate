# BLACKMAMER STUDIO Obfuscator Backend

Backend obfuscator Lua/Luau dengan Prometheus dan lapisan tambahan **BLACKMAMER VM V1**. Target deploy: Render (Docker), frontend: Netlify.

## Endpoint

- `GET /`: health check.
- `POST /api/obfuscate`: JSON `{ "script": "print('hello')", "preset": "Medium" }`.
- Preset: `Weak`, `Medium`, `Strong`.
- BLACKMAMER VM **aktif secara default** agar frontend lama tetap bisa dipakai. Kirim `"blackmamerVM": false` untuk mematikannya.
- Respons mempertahankan field `obfuscated`, serta metadata `blackmamerVM` (`applied`, `fallback`, `protectedLiterals`, `protectedBytes`).
- Kalau preprocessing VM membuat proses Prometheus gagal, backend mencoba lagi memakai script asli dengan Prometheus dan mencatat `fallback: true`.

## Catatan

BLACKMAMER VM V1 baru memvirtualisasi string literal yang memenuhi syarat dengan instruction loop dan opcode acak per build; **belum** memvirtualisasi seluruh kode Luau, dan tidak ada obfuscation yang sepenuhnya anti-deobfuscate. Performa dan kompatibilitas harus diuji di Roblox Studio sebelum dipakai luas. String tipe Luau, string bracket panjang, dan string interpolasi tidak diproses oleh lapisan ini.

## Lisensi dan atribusi

Based on Prometheus by Elias Oelschner, https://github.com/prometheus-lua/Prometheus

BLACKMAMER STUDIO tetap menggunakan Prometheus. Lisensi upstream mewajibkan atribusi jelas pada website publik SaaS (contoh: footer atau halaman About). README backend saja tidak menggantikan kewajiban itu.

Lisensi: https://github.com/wcrddn/Prometheus/blob/master/LICENSE

## BLACKMAMER VM V2 (experimental)

- Default remains V1. For V2, send `vmMode: "hybrid-v2"` in the POST JSON.
- V2 compiles **selected untyped, single-line `local x = expression` initializers** with numeric operations, comparisons, variables, and Luau `if ... then ... else ...` expressions into a custom **register VM**.
- Its instruction dispatcher uses randomized opcodes, randomized register starts, and explicit conditional jumps. This is real execution of supported expressions, **not whole-program virtualization**.
- Strings and other source syntax are still handled by V1 / Prometheus. Unsupported constructs are left unchanged.
- Compatibility with all Roblox/Luau types and engine APIs is not yet proven. Test in Roblox Studio before merging the PR; do not claim Luraph-level resistance.
- When `vmMode` is experimental, the response includes `blackmamerVM.virtualizedExpressions`, `blackmamerVM.vmInstructions`, and `blackmamerVM.mode`.

## Target Roblox / Luau

- **Luau is the default target on the V2 branch:** the backend passes `--LuaU` to Prometheus to enable its Luau parser/output mode. Set `"target": "Lua51"` only for ordinary Lua 5.1 clients.
- `"preset": "Strong"` uses Prometheus's **two Vmify passes**, so it is already a whole-script VM layer *from Prometheus*, not a custom BLACKMAMER full-program compiler.
- The BLACKMAMER V2 register VM is **additional** and currently covers a narrow subset of Luau initializer expressions only. It does not yet emulate all Roblox functions/events/closures.
- `npm test` verifies selected register-VM expressions with Lua. `npm run test:luau` checks example programs against the official Luau command-line runtime after Prometheus obfuscation. GitHub Actions runs both checks. Passing Luau CLI tests is **not** the same as passing Roblox Studio tests.
- Proposed V2 mode: `{"script":"local x=2+3\\nprint(x)", "preset":"RobloxStrong", "target":"LuaU", "vmMode":"hybrid-v2", "blackmamerVM":true}`.
- Compatibility requirement before production: Studio tests covering LocalScript/Script, `game:GetService`, events, callbacks, closures, tables, Luau syntax (types, `continue`, interpolation), plus script behavior and startup performance.
- A successful response includes `blackmamerVM.applied`; inspect it before claiming that the custom layer ran. Errors may cause a fallback to plain Prometheus.
- Luraph-grade resistance has **not** been established. Obfuscation raises reversing effort but cannot guarantee that client-executed Roblox source remains confidential.

## RobloxStrong preset (experimental)

The new `RobloxStrong` preset is implemented in `roblox-strong.lua`. It uses **one full-program Prometheus Vmify pass** plus constant arrays and number expression mutation. The upstream anti-tamper and string encryption steps are intentionally **disabled** here because randomized builds produced errors or corrupted strings in Luau CLI tests. This is a compatibility-focused baseline, not a claim of maximum resistance. This is intended to reduce runtime instability seen with the upstream `Strong` preset's *two* nested Vmify passes on some Luau programs. It is **not an independent BLACKMAMER full-program VM**.

Usage: `{"script": "print('Hello World')", "preset": "RobloxStrong", "target": "LuaU", "vmMode": "hybrid-v2", "blackmamerVM": true}`.

GitHub CI runs `npm run test:luau` with 18 repeated Luau runtime checks across 6 sample programs (3 randomized builds each) through the custom preprocessor and Prometheus. Green CI only verifies these examples; it does not validate Roblox Studio behavior. Do not merge into `main` or use publicly before this workflow passes; Roblox Studio validation is still required.

## BLACKMAMER Native VM V3 — experimental, independent of Prometheus

V3 has its **own** Lua/Luau subset lexer, parser, bytecode compiler, and register interpreter. V3 does **not** call Prometheus or its `Vmify` step. Older presets (`Weak`, `Medium`, `Strong`, `RobloxStrong`) continue to use Prometheus unchanged.

Example POST `/api/obfuscate`:

```json
{
  "script": "local total=0\nfor i=1,5 do total=total+i end\nprint(total)",
  "preset": "NativeV3",
  "target": "LuaU",
  "vmMode": "native-v3",
  "blackmamerVM": true,
  "antiTamper": true,
  "antiDebug": true
}
```

Native V3 provides randomized opcode identifiers and operands per build, encrypted string/number constants, and a **basic bytecode integrity checksum** that aborts if its protected data is changed. The anti-debug toggle currently performs lightweight runtime-hook checks and sanity checks on `debug.info` (if available), not reliable detection or prevention of Roblox Studio debugging. Neither guard is unbreakable, and neither is a substitute for server-side security.

Supported **subset**: strings, numeric/boolean/nil literals, Lua arithmetic/comparisons, concatenation, logical short-circuit operations, calls and colon methods, table constructors/indexing, locals, assignments, functions, lexical closures, recursion, `if`/ `elseif`/ `else`, Luau `if` expressions, `while`, `repeat until`, numeric `for`, `break`, single-expression `return`, and `do` blocks. Main restrictions include Luau type annotations, generic `for`, `continue`, varargs, multi-return and multi-assignment semantics, compound assignment, and typed Roblox-specific syntax. Unsupported syntax yields **HTTP 422** with code `V3_UNSUPPORTED_SYNTAX` and **never silently falls back** to Prometheus. Limit: 128 KB source and 12,000 instructions per function.

Run the official Luau CLI test suite with `LUAU_BIN=./path/to/luau node tests/vm3-luau.js`; run the API integration test with `node tests/vm3-api.js` after `npm install`.

Before enabling for production Roblox games, test actual Script/LocalScript/ModuleScript behaviors and measure overhead in Roblox Studio. Luau CLI compatibility tests do **not** prove complete Roblox Studio compatibility, or resistance matching Luraph. If V3 rejects a script, use an older preset as an explicit user choice rather than automatic fallback.

The Netlify frontend source (`netlify-frontend/index.html`) now has a Native V3 option and toggles. For manually uploaded Netlify sites, download and replace the `index.html` in the existing site's deploy; changes in GitHub alone do not update a manual Netlify deployment.

## BLACKMAMER Native VM V3.1 — opaque bytecode packaging (experimental)

The V3.1 compiler keeps the **independent** V3 bytecode VM and removes the easily-readable `O.GET`, `O.CALL`, `O.RET` opcode map from generated code. Its opcode identifiers are randomized per build **and the handler layout is independently permuted**. Full-program instructions are serialized into packed binary streams instead of openly displayed `P[1] = {{opcode, a, b, c}, ...}` tables. The constant pool uses separately seeded, feedback-based byte transforms rather than the previous linear `XKEY + j*17 + k*13` expression.

The integrity check covers the **sealed bytecode**, sealed constants, and argument-register lists. These transforms add work for casual static inspection; **they are not cryptographic encryption or tamper-proof authentication**. The runtime decoder and all parameters remain client-side, can be captured or emulated, and checks can be patched out. A four-instruction `print("Hello World")` example still has trivial underlying logic; bytecode packaging cannot make such a program secret. For Roblox secrets and authoritative decisions, use server-side scripts, not a client obfuscator.

The V3.1 regression suite runs the full 20-case Luau sample corpus under the official Luau CLI, three randomized builds per case. An additional test edits a byte of the sealed bytecode and asserts failure. Roblox Studio runtime still needs its own test.

This change does **not** alter the API contract: choose `"preset":"NativeV3"`, `"target":"LuaU"`, `"vmMode":"native-v3"`. Legacy Prometheus presets are unaffected.

## BLACKMAMER Native VM V3.2 — per-function opcode polymorphism (experimental)

The V3.2 runtime is an original extension of BLACKMAMER V3.1. Each compiled function now has its own opcode masking seed, and the encoded opcode depends on the **instruction position**. The runtime unmasks it using the current function's seed and program counter, rather than using one bytecode-wide opcode formula. The dispatcher is also split into 5–7 randomized branches whose opcode buckets and handler ordering change on each build.

These changes reduce obvious static signatures and make one universal opcode lookup less convenient. **They do not make bytecode confidential**: all masks, seeds and the interpreter are shipped to the Luau client, so a determined analyst can emulate it or instrument its runtime. Input as small as `print("Hello World")` remains trivial in underlying semantics regardless of output size. The obfuscated Luraph-style sample supplied for comparison was inspected **statically** (not executed) and is not copied into this repository.

The Luau CLI CI suite verifies 20 example programs across 3 randomized builds each (60 total), with API checks and bytecode-integrity tamper testing. Actual Roblox Studio compatibility, performance, and independent deobfuscation effort are still unmeasured. Do not claim parity with Luraph, and do not store real Roblox secrets in a client script.


## BLACKMAMER VM V3.3 — buffer-backed prototype VM

This opt-in NativeV3 engine has an independent Luau subset compiler, **not** a copied Luraph interpreter or a Prometheus Vmify pass. V3.3 shifts the runtime from eagerly reconstructing Lua arrays for every instruction to:

- Sealed binary function prototypes, each with its own parameters, bytecode and opcode mask.
- **Lazy prototype loading:** decode a function only when invoked and cache its Luau buffer.
- **Direct buffer.readu32 instruction fetches:** 16 bytes per instruction, rather than building an open array of decoded instruction rows.
- Per-build shuffled function prototype ordering and relocation of closure operands; the root function need not be prototype #1.
- Existing PC-dependent opcode masks, nondegenerate handler shards, checksum and best-effort runtime sanity checks remain.

### Reference and threat-model caveats

The user supplied a Luraph-style 284 KB Loader(2).luau and a 4-stage deobfuscation pipeline. Both were **inspected statically only**; unknown code was never executed. The supplied pipeline explicitly warns that its Luraph v15 prototype lifter is incomplete for some newer formats. That limitation does NOT demonstrate resistance of BLACKMAMER.

Similarity of architecture is not equivalent resistance against reversing. All decryption parameters and interpreter code must travel with Roblox client code, so runtime instrumentation can still extract bytecode and values. A checksum is bypassable. Never embed API keys, server-side authority or secrets in a LocalScript.

V3.3 supports a Luau syntax subset. It explicitly returns HTTP 422 for unsupported code rather than silently falling back. It requires Roblox Luau buffer; it is not supported in ordinary Lua 5.1. Compatibility CI uses official Luau CLI, not Roblox Studio. Test native execution, performance and resistance separately before calling this production ready.


## BLACKMAMER Native VM V3.4 — instruction fusion experiment

V3.4 adds a compiler pass that lowers selected adjacent VM operations into new **superinstructions**: GETK, KGET, KK and KDECL. Each compound operation executes the same work as two native instructions; the compiler updates branch destinations to preserve Luau control flow. The decision to fuse eligible pairs is randomized on each build.

For example, the simplest `print("Hello World")` program may compile `GET print + K string` as one GETK operation. This prevents a universal naive 1:1 lift of every runtime operation, but the semantics are still observable and reversible. Merely merging two opcodes is not Luraph-level security.

API stays `preset: NativeV3`, `vmMode: native-v3`. To compare debugging output, pass `superInstructions: false`; default is enabled. Results include `blackmamerVM.fusedInstructions` and per-opcode fusion counts. Existing RobloxStrong/Prometheus modes remain unchanged.

CI exercises 630 randomized compiler builds, 63 native Luau runtime comparisons and compatibility checks. These tests establish behavioral correctness for selected examples, **not** full Roblox Studio compatibility or resistance against reverse engineering.

## BLACKMAMER NativeV3 dispatcher polymorphism and Roblox Luau support

NativeV3 generates one of two dispatcher layouts on each build: a fully populated affine-bucket dispatcher or a sorted opcode decision tree. All opcode handlers share **one** invalid-opcode fallback after dispatch, replacing repeated `else nativeError("BLACKMAMER V3 invalid opcode")` blocks. Invalid opcodes still fail closed; anti-tamper and existing backend API flags are preserved. This diversifies the generated VM's visible control-flow layout but does not make it unrecoverable.

The VM also handles Luau generalized table iteration such as `for _, value in aTable do`. Plain tables iterate via `next`, and a table with a callable `__iter` metamethod uses the returned iterator triple. Existing `ipairs`, `pairs` and numeric loops remain supported. The parser now treats `type` and `export` contextually so builtin calls such as `type(decoded)` are not misclassified as declarations. Luau type declarations/annotations remain unsupported (HTTP 422).

Three user-supplied Roblox scripts were inspected and **compiled privately** as compatibility checks: `BM SAWERIA.luau`, `AntiTCS.luau`, and `BLACKMAMERVISUAL.luau`. The source files are not copied into this repository. BLACKMAMERVISUAL was supplied in a Windows single-byte encoding (not UTF-8); save it as UTF-8 before pasting/uploading if the browser displays replacement characters. Successful compilation is not proof of correct behavior in Roblox Studio.

CI runs 224 randomized dispatcher checks, 66 native Luau comparisons derived from the three scripts' publicly safe syntax patterns, and the existing NativeV3/API/Donation Cinematic regressions. No Luraph-equivalent security claim is made: the interpreter and all decode parameters remain client-side.


## NativeV3 threat model: embedded keys, offline decoding and lazy constants

The generated LuaU VM is self-contained. It must include all the information needed to decrypt and execute itself, including opcode-derived salts, per-entry seeds, the shuffled payload alphabet and decoding logic. A reverse engineer who can read and execute the client output can reconstruct these values. **It is not possible to keep a cryptographic secret secret from an attacker while shipping both the protected data and everything required to decrypt it to the same attacker.**

NativeV3 now **decodes each constant on first access**, caching used values with a sentinel to distinguish `nil` from not-yet-decoded entries. Previously all Q constants were unsealed at startup. This reduces immediately available plaintext in the VM and avoids work on unused functions. It does **not** remove static keys, guarantee anti-dump protection, or prevent a reverse engineer from implementing the same decoder offline.

To protect actual private logic, make server decisions in `ServerScriptService`/`ServerStorage` and expose narrow validated `RemoteEvent`/`RemoteFunction` APIs. In client LocalScripts, retain only the non-secret UI/animation logic. An online server-issued decryption key can make a static file alone insufficient to decode, but once the key reaches an attacker-controlled client it can be extracted; it needs a real backend/authentication and may reduce reliability when offline. Do not use variable `os.time()`/`os.clock()` as standalone decryption keys, or assume `game.PlaceId`/`game.JobId` are secrets.

Integrity checks (anti-tamper) protect against some unauthorized modifications during execution. Debug-hook checks detect only a narrow subset of runtime changes. Neither is a defense against reading the file, reconstructing its decoder externally or observing plaintext during execution. Any claim of Luraph-equivalent resistance requires independent reverse-engineering benchmarks.


## NativeV3 Hybrid VM: S-Box and prototype-specific bytecode (2026-11)

The NativeV3 interpreter remains **self-contained Roblox Luau**: no `loadstring()` or special server flag. The new output keeps the existing VM, per-build randomized opcode IDs, two dispatcher topologies, lazy constants, integrity checks, and client-compatible `buffer` reads.

- **Per-build S-Box substitution:** generated sealed byte strings pass through an independently shuffled 256-entry substitution before the existing chaining/stream transform. The inverse S-Box is masked, encoded with the other payload segments, and reconstructed inside the VM. The verification checksum covers the sealed payload, inverse S-Box, salt and unmasking parameter.
- **Masked per-entry seeds:** each prototype/constant entry stores a masked seed; the VM derives its usable seed from the entry index, kind, and build salt. This hides obvious raw seed literals but does **not** provide a cryptographic secret.
- **Prototype-specific instruction layout:** instructions use **12 bytes (four 24-bit fields)** or **16 bytes (four 32-bit fields)**, selected independently per prototype. The four logical fields are independently permuted for each prototype, so a fixed `(op,a,b,c)` offset pattern no longer applies to every VM function. This is **not** a variable-length encoding for every individual instruction.
- **Test controls:** compiler options `bytecodeWidth: 'compact'` and `bytecodeWidth: 'wide'` force the layout for regression testing. Default randomly mixes layouts; `dispatchMode: 'tree'|'shard'` remains available to tests.
- **API observability:** `blackmamerVM.bytecodeLayout` and aggregate `bytecodeWidths` show which mode the backend emitted. These are not security-sensitive secrets.

**Security boundaries:** the S-Box inverse, salt, masks and reconstruction logic still travel with the output. Someone who controls a client can reconstruct the encoder/decoder or observe its runtime. No guarantee of key secrecy, resistance comparable to Luraph, or protection of server-side secrets is implied. Keep secrets and critical decisions on the Roblox server.

**Compatibility and performance:** compact operands trade additional byte reads for smaller sealed prototypes. Both width modes, both dispatchers, nil/multi-return, and the user-derived Roblox Luau patterns are covered by CI. Benchmark game scripts in Roblox Studio before relying on new VM layouts for time-sensitive code such as RenderStepped.
