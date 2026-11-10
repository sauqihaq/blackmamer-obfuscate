# BLACKMAMER Native V4 — Runtime hardening (experimental)

This revision responds to four frequently repeated comparisons with Luraph. **Do not compare checkboxes as proof of equivalent security.**

## Implemented in Native V4

1. **Payload-derived bootstrap masks**: A per-build SALT, CHECK and SBOX mask is reconstructed using randomly split constants **and a runtime bootstrap derived from the unpacked encrypted function/constant blobs and VM metadata**. This ties mask derivation to real runtime data and can frustrate simple literal matching. **Every input is still shipped to the client and reconstructible**. It is not cryptographic runtime-key secrecy.
2. **Opaque polynomial branch**: Each Nested V4 outer decoder execution evaluates an integer polynomial invariant computed from the live instruction PC, prototype seed and bytecode position. The false path fails closed. The invariant can be proven statically; this is a lightweight opaque predicate / control-flow distraction, not an anti-decompiler guarantee.
3. **Periodic runtime/API integrity checks**: When antiDebug is enabled, the V4 loader checks that the cached standard-library functions still match their public bindings; it performs deterministic operations and, when available, checks `debug.info` function identity and arity on a fresh sentinel function. It repeats on every 251st inner instruction. This catches some hooks/tampering **after initialization**, not a skilled debugger or a hooked runtime present before startup.
4. **Executor fingerprint**: **Not enabled.** Roblox does not expose a trustworthy, portable, security-grade executor fingerprint to ordinary Luau scripts. Aggressive checks of exploit-specific globals risk false positives and can be spoofed. Use server-side authorization and key delivery instead.

The existing `BM_ENCFUNC` is the option that can keep a function's key *out of a standalone client artifact*, with a server-managed key provider. Keep keys and sensitive logic on the Roblox server. See [External function keys](EXTERNAL_FUNCTION_KEYS.md).

## Compatibility

All improvements are for Native V4. Native V3 is unchanged. `antiDebug:false` disables the new repeating API probes but leaves bytecode integrity checks governed separately by `antiTamper`.

These checks are runtime-only and don't require platform-specific addresses, `debug.sethook`, `getlocal`, `getupvalue`, executor-specific extensions, network telemetry, or user/device fingerprint data. The supported Roblox debug API is `debug.info`, not the full Lua `debug` library.

Run: `node tests/vm4-luau.js`, `node tests/vm4-api.js` and the native C++/Luau GitHub Actions workflow. Benchmark real gameplay: runtime guards add work to the VM interpreter, especially with tight loops.
