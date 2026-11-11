# BLACKMAMER Native V4 Maximum — Seven Real Runtime Interpreters

This mode creates **seven distinct runtime interpreters**, all of which execute on every obfuscated VM instruction:

1. **VM1 — Luau instruction VM:** executes the original program's virtualized register bytecode, closures, control flow, method calls, returns and other supported operations.
2. **VM2 — Outer decoder VM:** decodes and unpacks each 4-field inner instruction using its separately sealed microprogram.
3. **VM3 — Opcode layer 1:** interprets a sealed program to remove the first independent XOR mask.
4. **VM4 — Opcode layer 2:** independently interprets another sealed program to subtract an additive opcode mask.
5. **VM5 — Opcode layer 3:** independently interprets its own program to undo an 8-bit opcode rotation.
6. **VM6 — Opcode layer 4:** independently interprets another sealed XOR-mask program.
7. **VM7 — Opcode layer 5:** independently interprets the final additive-mask program.

The compiler applies the five opcode encryption transforms in the forward order VM3→VM7, then applies the original per-PC opcode mask. The runtime first invokes VM2, then VM7→VM3 to remove all five stages before VM1 dispatches the recovered opcode.

Each micro-VM is a **separate Lua function with its own interpreter loop, program counter, register array, runtime branch, instruction set, per-build shuffled opcode IDs, independent sealed bytecode and instruction budget**. The microprogram bytes are sealed with the same native C++ sealer and included in both bootstrap mixing and runtime integrity verification.

**This is not a claim that seven complete Lua language VMs are nested.** Only VM1 interprets the user's full Lua/Luau instruction set; VM2–VM7 are smaller, real bytecode interpreters focused on instruction decoding. Seven complete language interpreters would multiply execution overhead enormously and are not supported by the Luraph v15 documentation cited earlier. Nor does this imply equivalent resistance to a deobfuscator with runtime instrumentation.

## Enabling

- Default website **oneClick: true** always selects Maximum, Nested VM and auto function encryption, so the seven interpreters are enabled automatically.
- Advanced API: `preset: "NativeV4", protectionLevel: "Maximum", nestedVM: true`.
- Other V4 levels retain the existing 1- or 2-interpreter implementation; archived V3 is unaffected.
- Supported targets remain Roblox Luau, Lua 5.1 and LuaJIT for the compiler's currently supported language subset.

## Auditing

- Response metadata includes `blackmamerVM.vmInterpreterCount` (7 for Maximum), `opcodeMicroVMs` (5) and `microVMInstructions` (35).
- `node tests/vm4-seven-vms.js` runs a 5-stage opcode encode/decode round-trip across 12 builds, 20 PC/seed combinations each, all 256 opcode byte values. Test-only microprogram hashes can be obtained with `auditMicroVMs: true` in a trusted compiler process; they are never embedded in the output.
- `LUAU_BIN=luau node tests/vm4-luau.js` runs source and generated Lua through official Luau and checks all five new runtimes are embedded.
- `LUA51_BIN=lua5.1 LUAJIT_BIN=luajit node tests/vm4-lua51.js` checks that the portable interpreters run correctly on both runtimes.
- All existing external-key vault, library, original superinstructions, compact/wide, AoS/SoA, CFG and tamper regressions remain necessary.

## Trade-offs and security

These extra interpreters add approximately 5×7 microinstruction dispatches per original VM instruction, increasing code size, CPU use and memory. Benchmark actual Roblox game workloads; particularly long per-frame loops may not tolerate the overhead. Even seven real interpreters are **not an anti-dump guarantee**: all decoder programs and keys for a standalone client ultimately execute in the user's runtime, and dynamic tracing can record the restored instruction stream. Confidential authorization and secrets still belong in server code or Server Remote Vault.

No Prometheus source is included; the VM architecture and five-stage microprogram implementation are original BLACKMAMER code.
