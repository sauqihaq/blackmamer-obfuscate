# BLACKMAMER V4: portable Lua/Luau host-boundary protection

## Universal by default

The Lua language target is independent from the host platform. A one-click request
with `target:"LuaU"`, `target:"Lua51"`, or `target:"LuaJIT"` now defaults to
`platform:"universal"`. The generated runtime must **not** require Roblox
globals (`game`, `script`, `task`, `typeof`, `Instance`) simply to start.

Unlike a Roblox-only runtime, LuaU compiled in universal mode can execute in
the official Luau CLI or in Roblox when the input script's own API requirements
are satisfied. The output dialect still matters; it is **not** one binary
compatible with all Lua interpreters.

All Maximum V4 one-click standalone requests retain Prometheus's full 11-step
prepass, 7-engine BLACKMAMER VM, tamper checks, and reconstructible standalone
key material. No change silently downgrades protection.

## Portable anti-hook probes

Protected V4 runtimes use best-effort standard Lua/Luau identity and behavior
checks. Checks include stable standard-library bindings, a dedicated private
`__tostring` sentinel, and private `__index`, `__newindex`, and `__call`
metamethod sentinels. They run at startup and periodically when anti-debugging
is enabled. Hooks on *the runtime's own sentinel operations* are detected by
the sentinel tests. Generic callers may still install their own metatables or
custom globals.

This does not prove that host functions are genuine. If an adversary controls
the entire Lua interpreter or supplies a consistent pre-hooked environment,
all tests and runtime results can be forged. Obfuscation raises reverse
engineering effort; it cannot conceal observable API effects from a hostile
client. Avoid false-positive claims of guaranteed "anti-executor" coverage.

## Explicit Roblox host validation

To opt into the stronger but Roblox-dependent Instance checks, pass
`platform:"roblox"`, `target:"LuaU"`. Only this mode requires real Roblox
`game`/`script` values and checks `task`/`typeof` bindings. Using
`platform:"roblox"` with other dialects fails with HTTP 400.

Examples:

```json
{"script":"print('portable')","target":"LuaU","oneClick":true,"platform":"universal","executionContext":"client"}
```

```json
{"script":"print('Roblox only')","target":"LuaU","oneClick":true,"platform":"roblox","executionContext":"client"}
```

`executionContext` controls client/server key-safety policy, **not**
whether the Luau runtime must expose Roblox Instances. Backend server-key
vault is a distinct mode: `runtimeMode:"server-vault"`, which requires
`platform:"roblox"` and `executionContext:"server"`, plus authenticated
backend key storage, Roblox Secrets Store and HttpService access. The server
vault does not currently execute the full 11-step Prometheus prepass.

The source frontend defaults to universal Luau, with the existing server-vault
choice for server-only key storage. A separately hosted Netlify frontend must
be redeployed independently to use this UI change.

## Tests

- `node tests/vm4-universal-platform.js` with `LUAU_BIN` for all three
  target dialects (Lua 5.1, LuaJIT, Luau CLI).
- `node tests/vm4-metamethod-trap.js` tests private metamethod tamper
  detection on the same native interpreters.
- `node tests/vm4-roblox-host-guard.js` checks explicit Roblox-only guard
  rejection of table proxy and fake global environments.
- `node tests/frontend-smoke.js` and `node tests/vm4-only-api.js` validate
  mode selection and fail-closed response checks.

CI tests cannot substitute for live Roblox Studio tests; Roblox server and
LocalScript compatibility must also be measured in real experiences.
