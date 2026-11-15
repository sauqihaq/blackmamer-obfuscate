# BLACKMAMER V4 — Runtime Alias Hardening and Dense Ciphertext Fragments

## Changes

1. Extend per-build syntax-aware identifier randomization to the protected
   Lua host API boundary and Environment Preflight's compiler-owned locals:
   `boundaryKeys`, `boundarySnapshot`, `boundaryCheck`,
   `_bmEnvironmentPreflight`, and associated internal symbols.
   Global API names (e.g. `print`, `require`, `rawget`, `game`) and
   string literals are not renamed.

2. Reduce size overhead in the sealed-fragment transport. Instead of
   fragmenting base64-like sealed ciphertext in approximately 37–97-character
   segments, hardened V4 uses randomized 144–303-character segments, or
   256–511 characters for full double-VM output. All fragments are still
   encrypted, broken into many pieces, globally shuffled, referenced through
   separately shuffled index lists and decoded by the same runtime code.

3. Expose `blackmamerVM.denseCipherFragments` and
   `blackmamerVM.cipherFragmentCount` for debugging/telemetry.
   No frontend settings or runtime backend calls are required.

## Security and compatibility

The encrypted bytecode, opcode palettes, seven independent interpreters,
outer nested VM, anti-tamper, Environment Preflight, and all eleven
Prometheus steps remain unchanged. Fewer ciphertext fragments mean a less
fragmented representation, which **can marginally reduce the nuisance value**
of splitting against static analysts. Fragment splitting is not itself a
cryptographic security boundary, and the encrypted bytecode and VM structure
are still in place.

The legacy-size fragment profile is accessible only as an internal compiler
test option (`fragmentPacking:'legacy'`); it is not a public API or frontend
choice. The default has the smaller output.

`tests/vm4-cipher-fragment-density.js` A/B-tests the old/new profiles,
checks runtime-local aliases and core VM security metadata, and compares
actual execution output across Lua 5.1, LuaJIT and official Luau CLI.
The optimized profile should produce a smaller output without changing
the script's behavior.

The user's earlier example was ~4.32 MB. Exact savings for that file cannot
be asserted without its original cleartext source and recompilation, because
each obfuscation build randomizes bytecode and fragment layout.
