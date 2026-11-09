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
