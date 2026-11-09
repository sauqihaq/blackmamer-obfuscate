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
