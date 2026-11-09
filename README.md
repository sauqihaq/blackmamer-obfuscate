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
