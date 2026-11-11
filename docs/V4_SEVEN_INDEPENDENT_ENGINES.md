# BLACKMAMER Native V4 — Seven independent VM engines

This replaces the experimental stacked seven-stage design in closed PR #35. It is **not** inner VM + outer decoder + five micro-VMs.

## Architecture

The compiler generates seven **complete language interpreter variants** in Maximum one-click mode. Each variant has its own bytecode execution loop, program counter, register file, local scopes, closure support, and full set of instruction handlers. The compiler also gives each variant a separately randomized, invertible **affine opcode ISA mapping** in addition to the per-prototype opcode palette.

- Every virtualized function prototype contains a separately sealed **VM variant ID** (1–7).
- When a function is called, the root router loads that prototype and chooses **one interpreter** to run its instructions.
- Recursive and captured closures use the same router, allowing functions inside the same script to execute under different engines.
- All seven complete interpreter implementations are present in a Maximum artifact, but **each function executes only one engine at a time**, rather than passing every instruction through seven decoder layers.
- Other existing protections remain: AST/CFG transforms, encrypted function prototypes, sealed constants, compressed operands, SoA/AoS bytecode layouts, per-function opcode palette, source local-name virtualization, anti-tamper, and C++17 bytecode sealing.
- In this architecture the old **outer decoder VM is disabled**; the one-click API reports `nestedVM:false`, `vmArchitecture:"seven-independent"`, `vmInterpreterCount:7`, and `vmSelectedPerPrototype:true`.
- Advanced direct compiler calls without `vmArchitecture:"seven-independent"` remain compatible with the older nested architecture. Archived V3 is unchanged.

The 7 engines share language semantics and VM IR semantics, but differ in per-variant opcode maps, handler order and the per-function bytecode selection. This is an honest implementation of **7 independently executable interpreters**, not seven unrelated languages or a guarantee of 7 distinct security properties.

## Usage

The website calls `oneClick:true` and the backend automatically selects the independent-VM Maximum architecture, without extra files or Roblox ModuleScript providers. Roblox server-only Remote Vault remains a separate optional key-storage mode; default LocalScript uses standalone function encryption. The same script can run as Script/LocalScript or server/client ModuleScript depending on its actual Roblox context and original API access.

Legacy or advanced consumers can explicitly set:

```json
{
  "preset": "NativeV4",
  "protectionLevel": "Maximum",
  "nestedVM": true,
  "vmArchitecture": "seven-independent",
  "target": "LuaU",
  "script": "print(42)"
}
```

The `nestedVM` request flag is ignored in this architecture because all seven independent engines operate without an outer decoder. Direct compiler options have the same meaning.

## Verifying

- `node tests/vm4-seven-independent.js` ensures seven full loops, seven independently shuffled dispatchers and routers, no outer VM, and a seven-function fixture.
- Official Luau comparison suite executes seven functions under the new architecture and tests ModuleScript table returns.
- Official Lua 5.1 and LuaJIT regression runs a seven-function fixture.
- The API smoke checks one-click output metadata and no extra external function keys.
- All C++ sealer, authenticated Remote Vault, V3 backward compatibility, tamper protection and other V4 tests continue.

## Performance and security limits

The generated file contains seven independent interpreters, so **code size and initial parse time grow**. However, each function only executes one VM rather than stacking all seven layers per instruction. Benchmark Roblox runtime CPU/memory and output size with large scripts. Seven similar engine variants can still be normalized by a sophisticated deobfuscator; this is **not** evidence of Luraph-level protection.

Luraph v15's official docs publicly list two selectable VM types (OPAL and ONYX) and do not verify a claim of seven full VM engines. BLACKMAMER's seven-engine design is independent and should not be described as an identical copy of proprietary Luraph internals.
