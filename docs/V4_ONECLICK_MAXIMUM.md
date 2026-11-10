# BLACKMAMER Native V4 — One-Click Maximum Protection

The public Netlify workspace has **one protection action**. There is no tier selector, standalone/external key selector, extra ModuleScript download, or manual \`BM_ENCFUNC\` step.

### Customer workflow

1. Open the BLACKMAMER workspace.
2. Paste or upload a script. The target runtime is \`LuaU\` (Roblox) by default; Lua 5.1 and LuaJIT remain available to users who need them.
3. Click **Obfuscate Script**.
4. Copy the result into **Script**, **LocalScript**, or **ModuleScript**, subject to the existing parser/runtime capabilities and the original script's own placement requirements.

The frontend sends \`{"preset":"NativeV4","target":"LuaU","oneClick":true,"script":"..."}\`. The server **ignores weaker overrides** and forces:
- V4 \`Maximum\` AST decoys, state-driven AST flattening and bytecode CFG transforms
- Nested VM and per-function opcode palettes
- Per-instruction operand permutation and C++ sealed bytecode
- \`antiTamper:true\`, \`antiDebug:true\`, and \`superInstructions:true\`
- Automatic standalone protection of all function prototypes, including entry
- No separately generated external key or provider file

If an older source contains an explicit \`BM_ENCFUNC("premium", function...) \` marker, the one-click standalone build absorbs it into the automatic key. It **does not** require a provider module.

### Key material and security boundaries

The previous obvious two-string \`a XOR b\` reconstruction is replaced with independently generated three-share material, per-build byte permutation, additive masking and a sealed-payload bootstrap value. This is **polymorphic obfuscation, not an unrecoverable secret**. Python or another language can still implement the decryption algorithm and recover any bytes the Roblox client executes.

The backend performs bytecode sealing and source compilation, but must return an executable artifact. **Roblox LocalScripts cannot directly use HttpService's external HTTP request methods.** A backend-held encryption key cannot magically remain on the backend while every client executes the decryption code without additional server/client integration. The one-file customer workflow therefore uses standalone key material.

For genuine confidentiality, place sensitive logic, paid entitlements, data stores and private secrets on the Roblox server. Production deployment via a hosted key server is a **different product mode**, possible for server-only execution with a durable database and authenticated requests, and still does not conceal plaintext from a privileged runtime owner.

### Runtime overhead

This intentionally forces the heaviest transform profile. Expect increased script size and interpreter cost; benchmark animation/gameplay loops. Native V4 protects only the subset of Luau/Lua supported by the compiler. The public website should never claim the engine is equivalent to Luraph or unbreakable.

### Regression testing

- \`node tests/vm4-only-api.js\`: oneClick overrides weaker API settings and returns no external key.
- \`LUAU_BIN=luau node tests/vm4-external-luau.js\`: runs standalone Script/LocalScript-shaped and ModuleScript-returning source, as well as old \`BM_ENCFUNC\` markers, without a provider.
- \`node tests/frontend-smoke.js\`: public frontend only offers Maximum one-click and refuses output that unexpectedly requests external keys.
- \`node tests/vm4-lua51.js\`: vanilla Lua 5.1 and LuaJIT remain operational.

Premium frontend for the current manually deployed Netlify site is delivered separately as a ZIP containing \`index.html\`, \`app.html\`, \`admin.html\`, \`assets/\`, and routing files. The generated ZIP must be uploaded to the **existing** Netlify site after Render is updated.
