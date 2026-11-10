# Native V4: Per-function opcode palettes and per-instruction operand rotation

This hardening targets a specific weakness in BLACKMAMER V4: previously, all function prototypes in one build reused the same opcode-ID mapping and the same four-operand offset layout across each function. Once a deobfuscator inferred those mappings, it could reuse them across many bytecode streams.

## Actual changes

- **Independent opcode palette per function.** Each V4 compiled function now carries a cryptographically randomly permuted set of 0–255 opcode bytes (one unique value for every supported instruction kind). The palette travels **inside that function's sealed/encrypted bytecode blob** instead of appearing as one build-global constant in the emitted Lua runtime. The dispatcher checks opcode bytes against `spec[8][index]` from the *executing function's* palette.
- **Per-instruction operand rotation.** Physical positions of the four encoded instruction fields now rotate with the function's `opSeed` and the current PC; the old per-function offset permutation remains as an independent layer. The runtime `field(at,logical)` recovers each position on demand.
- **No source/API migration.** Native V4 automatically uses both changes, including with its Nested VM, `autoFunctionEncryption` (standalone/external), and `BM_ENCFUNC`. Native V3 is unchanged.
- **Correctness checks.** Structural tests compile the same multi-function input 12 times, verify opcode maps differ between prototypes and builds, and confirm V4 no longer has a `if op==<literal number>` dispatcher pattern. Separate official Luau CLI tests compare real results across recursion, closures, loops and encrypted functions; API tests verify the feature flags.

## Security reality and tradeoffs

This is **not proof against Python-based deobfuscators**. A well-adapted analyzer can execute or emulate the Luau interpreter, recover each sealed palette, and reconstruct the rotating fields. These changes mainly defeat simplistic single-mapping/static extractor assumptions and raise adaptation cost. A per-function palette does **not** provide confidentiality by itself.

There is a runtime cost: additional per-instruction modulo arithmetic and a function-palette-dependent dispatcher (linear shuffled handler branches). Benchmark large Roblox loops and gameplay timings, and consider reducing VM coverage for extremely performance-sensitive code. Standalone keys remain reconstructible; keys kept on the Roblox server remain more valuable for genuine separation.

## Testing

```bash
node tests/vm4-structural-audit.js
node tests/vm4-api.js
# With an official Luau CLI:
LUAU_BIN=luau node tests/vm4-luau.js
LUAU_BIN=luau node tests/vm4-external-luau.js
```
