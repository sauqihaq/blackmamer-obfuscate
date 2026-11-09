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
