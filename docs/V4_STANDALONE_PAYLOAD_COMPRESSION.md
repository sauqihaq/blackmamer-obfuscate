# BLACKMAMER V4 — Standalone Sealed Bytecode Compression

**Purpose:** Reduce protected output size without removing VM instructions,
Prometheus Full 11 steps, per-build bytecode encryption, seven independent VM
engines, anti-tamper, Environment Preflight or Protected API Boundary.

## Packing boundary

The Maximum/hardened V4 compiler now optionally compresses each VM *raw
prototype byte stream* **before** per-function encryption and the existing
native S-Box sealer. Runtime decoding runs only after unsealing and, for
protected functions, after the existing keyed function decrypt.

The portable format is a versioned one-byte mode:
- `0`: raw bytes with one-byte codec header.
- `1`: four-byte uncompressed size and bounded LZ literal/back-reference
  token stream (1–128 byte literals, 4–131 byte matches, 16-bit distance).
- `2`: four-byte uncompressed size and zero-suppressed occupancy bitmap:
  each block of eight original bytes has one mask byte followed by only
  the nonzero bytes. This helps with high-order zero bytes in four-byte
  encrypted-operand transport.

The encoder chooses whichever packed representation actually saves the
most bytes, falling back to raw mode when savings are too small.

A per-prototype encoder **keeps the original payload** if compression would
save fewer than 16 bytes. Decoding uses only Lua tables and arithmetic,
supported by Luau, Lua 5.1 and LuaJIT. It uses no `loadstring`, Roblox-only
APIs, network access or native decompressor dependency. Malformed streams,
excessive output lengths, invalid offsets and wrong decoded sizes error out.
The existing integrity checksum already covers the resulting sealed bytes.

## Preserved protections

- Complete Prometheus Full 11-step source prepass.
- Full BLACKMAMER Maximum V4 VM bytecode and all seven interpreter engines.
- Randomized opcode palettes, registers, per-prototype schemas, encrypted
  instruction cells, chained encoding and code-integrity digest.
- AntiTamper, API Boundary, Environment Preflight and metamethod traps.
- Standalone execution, including Roblox LocalScripts, ModuleScripts and
  server Scripts, plus ordinary Lua 5.1 and LuaJIT.

Only the transport representation **inside** the encrypted payload changes;
no VM instruction or anti-tamper feature is dropped.

## Limits

Arbitrary-length source cannot be guaranteed to fit 100,000–150,000
characters while preserving full standalone functionality. Incompressible
data and the substantial seven-engine runtime impose a real lower bound.
Any reduction percentage must be measured on the exact regenerated output
and is not guaranteed by the codec.

API metadata: `blackmamerVM.vmPayloadCompression`,
`vmPayloadCodec`, `vmPayloadBytesBefore`, `vmPayloadBytesAfter`,
and `vmPayloadCompressedFunctions`.

The compile-only diagnostic `vmPayloadCompression:false` is used for
cross-runtime parity checks. Internal `vmPayloadForcePacked` forces the
decoder through a compressed stream so tests cover even a random-looking
bytecode prototype; `vmPayloadTestCodec:'zero-map'` additionally tests the
bitmap codec directly. None of these diagnostic controls is exposed to
one-click browser users.

## Tests

`tests/vm4-payload-compression.js` exercises malformed data rejection,
random and repetitive byte round-trips, and default/forced/legacy Maximum
VM execution on Lua 5.1, LuaJIT and official Luau CLI. Existing 11-step
full-stack/VM, randomized output and performance tests remain mandatory.
