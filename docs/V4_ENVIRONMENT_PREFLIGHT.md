# BLACKMAMER V4 — Universal Environment Preflight

## Purpose

Detect clearly malformed Lua host primitives **at VM startup**, before
executing user bytecode. This builds on the existing Protected API Boundary
that snapshots selected global bindings and detects changes after startup.

Preflight is enabled in hardened V4 when `antiDebug` is enabled (including
Maximum one-click), with no extra UI options and no requirement for Roblox
Instances, `game`, `script`, or backend connectivity at script execution.

## Checks

- Verify the built-in `type` behavior for nil, boolean, number, string,
  function and table.
- Verify `rawget` ignores `__index`, `rawset` writes raw table slots,
  and `rawequal` respects table identity.
- Verify a normal `pcall` success (including multiple return values) and
  the failure path for `error`.
- Check string/concat/bitwise operations required by the VM.
- Reject callable **table** substitutes for known standard function globals
  such as `print`, `require`, `type`, `assert`, `rawget` and `pcall`.
  Absent optional functions are allowed; `game` and `script` can be any
  custom values or absent in universal mode.

## Compatibility and limits

A faithful Lua function wrapper around a real API can reproduce every
behavioral probe and pass preflight; consequently this is **not** a reliable
detector of a wholly pre-instrumented host, even if it detects simple fake
environments. It does not certify that `print` or any function is native,
or prevent someone controlling the interpreter from observing side effects.
No claim of total anti-tracing protection is made.

Callable-table substitutions for standard functions may be legitimate in
unusual custom hosts; the default Maximum profile rejects them intentionally.
Scripts that introduce their own custom `game` tables or inherited global
environments remain supported. Do not expand the startup check to require
specific Roblox APIs for all Lua targets.

## Verification

`tests/vm4-environment-preflight.js` compares behavior for real Lua51,
LuaJIT, and official Luau CLI including custom globals, inherited
environments, normal function forwarding, and five malformed-host scenarios.
Use `LUAU_BIN` to enable the Luau CLI test. Existing API Boundary,
metamethod and double-VM tests remain required.

The backend returns `blackmamerVM.environmentPreflight: true` for builds
that include the startup probes.
