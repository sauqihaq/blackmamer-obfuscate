# BLACKMAMER Native V4 — Heterogeneous Per-Prototype Bytecode Layouts

This change strengthens the **bytecode structure**, not merely the outer `elseif` branch order.

## Two real physical encodings

Before: every function encoded the operands as adjacent instruction rows, with per-PC field rotation:

```
[op0,a0,b0,c0, op1,a1,b1,c1, ...]   (AoS / row-oriented)
```

In Maximum V4, a prototype can now use the alternative **Structure-of-Arrays** layout:

```
[op0,op1,..., a0,a1,..., b0,b1,..., c0,c1,...]  (SoA / column-oriented)
```

Fields remain encrypted, masked, and individually rotated per instruction. The compiler writes the fields in a genuinely different order, stores a sealed layout bit alongside each prototype, and the VM calculates a distinct physical byte offset to fetch each operand. For multiple prototypes, Maximum always includes **at least one of each** layout. This changes the physical bytecode grammar and requires a deobfuscator to identify the layout for each function, not merely remap numeric opcodes.

The same nested outer decoder micro-VM, sealed per-prototype opcode palette, AST/CFG transformation and function encryption continue to work. The plaintext layout bit exists at runtime once an authorized execution environment decrypts the prototype, so a runtime tracer can still discover it.

## Seven relevant areas of hardening

The screenshot in the original report compares seven **technical aspects** (dispatcher, buffer API, bit32 API, environment/sandbox, anti-hooking, string storage and diagnostic messages). It does **not** establish that Luraph v15 uses seven separate complete interpreters. The official Luraph v15 documentation describes **two VM types**, OPAL and ONYX, alongside multiple security features.

BLACKMAMER already uses several distinct mechanisms: AST state machines and dead code, IR basic-block CFG relocation, four fused instruction kinds, per-prototype opcode mapping, per-PC operand rotation, two-level interpreter, C++ byte sealing, constant encryption, lexical binding virtualization, and server-only remote key storage as an optional mode. The SoA layout is a new structural dimension, not a claim that there are seven independent VMs.

## Compatibility tests

- `LUAU_BIN=luau node tests/vm4-luau.js` executes Maximum SoA with official Luau.
- `node tests/vm4-structural-audit.js` ensures mixed layout on multi-prototype Maximum bundles and preserves archived V3.
- `node tests/vm4-only-api.js` asserts Maximum one-click emits columnar bytecode.
- `node tests/vm4-lua51.js` executes all five levels on Lua 5.1 and LuaJIT.

Performance caveat: the SoA reader adds per-field offset arithmetic and can make Maximum slower and larger than other modes. Measure real Roblox scripts before deploying. This does not prevent tracing in a compromised execution environment; do not claim Luraph-equivalent strength without independent red-team evidence.
