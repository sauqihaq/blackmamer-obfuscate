# Native V4 — Lexical/IR hardening against readable VM dumps

This release addresses a concrete observation: a deobfuscated V4 VM dump printed meaningful **original local variable names**, sequential temporary register IDs and obvious \`if false\` decoys. Those patterns are not encryption leaks; they are **compiler metadata/dataflow leaks** that make reconstructed output easier to read.

## Changes

- **Lexical name virtualization**: a scope-aware AST pass replaces local declaration names, local function names, function parameters, shadowed locals, captured upvalues, numeric/generic loop bindings and compiler-generated state locals with independent randomized aliases. All bindings are resolved according to lexical scope before the VM bytecode is generated. Original names are not needed for correct execution.
- **Function-specific randomized virtual registers**: the allocation no longer produces predictable \`R1, R2, R3, ...\` register definitions in each IR function. Temporary register references are consistently mapped into randomly selected distinct physical IDs from a 2,048-register namespace.
- **Arithmetic dead guards**: the obvious literal \`false\` dead-branch condition is replaced with a scoped arithmetic parity identity and a distinct random false path. This still can be solved and removed by a capable symbolic deobfuscator.

The compiler continues using native C++ bytecode sealing, Nested VM, dynamic opcode palettes, operand rotation, AST/CFG flattening and one-click Maximum mode. All changes are additive within the **independent BLACKMAMER engine**, not Prometheus imports.

## Compatibility and validation

The official Luau differential suite now includes a mock Roblox \`LogService\` / \`script:SetAttribute\` callback pattern modeled on an actual decompiler output, plus nested closures, shadowed local variables, methods and repeat-until locals. Stock Lua 5.1 and LuaJIT fixtures cover shadowing and captured upvalues too.

A structural audit (\`node tests/vm4-binding-hardening.js\`) inspects **compiler internals only** to verify original binding names are remapped in the proper scopes, each allocation is unique per prototype, alias values differ between builds and archived V3 behavior is unchanged. The test-only audit records are not emitted into Lua.

## Security limits

- This is **metadata and IR hardening**, not cryptographic secrecy. A deobfuscator can still recover executable instructions, API member strings, control flow, constants and dynamic values by instrumenting the VM.
- Names such as \`LogService\`, \`SetAttribute\`, \`GetService\`, \`script\` and other **global API identifiers** must remain functionally accessible and cannot simply be renamed without changing program behavior. Their semantic use remains visible when decoded.
- The HMAC-SHA256 function is standard by design; replacing it with a custom algorithm would not fix client-side key exposure.
- The standalone key and bootstrap can still be reconstructed from the distributed artifact. Roblox LocalScripts cannot keep server secrets once the values are delivered into client runtime.
- API protection and entitlement checks belong on the Roblox server; use remote events/functions only for **server-authoritative actions**, not to fetch a permanent client decryption secret.

Do **not** market this change as "Python-proof" or claim equivalence to Luraph without independently testing it with a real deobfuscator and performance benchmarks.

## Commands

\`\`\`bash
node tests/vm4-binding-hardening.js
LUAU_BIN=luau node tests/vm4-luau.js
LUA51_BIN=lua5.1 LUAJIT_BIN=luajit node tests/vm4-lua51.js
\`\`\`
