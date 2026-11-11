# Native V4 — Dispatcher diversity and runtime diagnostics

The BLACKMAMER V4 compiler previously emitted one large runtime `elseif op == ...` chain, repeated across every function, and internal errors containing explicit `BLACKMAMER V3` and `BLACKMAMER V4` diagnostic messages. This makes static signatures obvious and gives a deobfuscator a stable dispatcher shape.

## Changes

- **Multiple instruction-handler families:** the V4 runtime now builds independently shuffled dispatch chains and selects one at each VM program counter using the current function's `opSeed`. Strong/Medium profiles use two families; Maximum uses three. The runtime still has **one outer execution loop**. These are duplicated handler structures, not a distributed native interpreter and not a third virtual-machine layer.
- **Current-function opcode palette:** every comparison continues using the executing prototype's independently sealed palette (`spec[8]`), and the existing encrypted inner/outer VM structure remains.
- **Diagnostic hygiene:** internal `nativeError("BLACKMAMER...")` messages in **generated V4 runtime** are rewritten into short, independently randomized opaque error identifiers. This removes version-specific error text but does not remove the intentionally branded comment/banner, API metadata or fatal error behavior. Source/compiler errors and legacy V3 remain unchanged.
- **No fake library wrappers:** Roblox/Luau `buffer` and `bit32` functions called by protected programs continue to resolve through their original runtime globals. The VM's *internal* decoder only needs fromstring/readu8/readu32. A 3-function internal decoder does not imply that Roblox buffer methods such as writeu32 or readf64 are unsupported. Regression tests now execute protected programs using several read/write buffer operations and additional bit32 operations.

## What this does NOT do

- It does not prevent dynamic tracing, bytecode extraction, operator emulation or reconstruction of data accessed by the running client.
- It does not hide standalone encryption keys from someone who controls the execution context.
- It does not claim to match Luraph, whose internals and capabilities cannot be inferred reliably from a single decompiled Loader sample.
- It does not magically support every LuaU syntax construct. The compiler retains its tested subset.
- Repeating handler families increases code size. Test Maximum builds for Roblox source/runtime limits and performance with realistic inputs. If users need genuine confidentiality, private game economy/authorization logic stays server-side.

## Tests

- `node tests/vm4-structural-audit.js`: per-function opcode maps, per-PC dispatcher families, masked V4 error text and V3 compatibility.
- `LUAU_BIN=luau node tests/vm4-luau.js`: original vs obfuscated output for 20+ representative programs, runtime `buffer` and `bit32` APIs, Maximum three-family output, and corrupted-payload failure.
- `node tests/vm4-api.js`: service exposes the generated family count and internal diagnostic mask count; preserves manual/automatic encryption and one-click behavior.

This is a targeted incremental hardening against simple static signatures, not evidence of invulnerability.
