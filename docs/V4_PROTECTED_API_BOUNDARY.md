# BLACKMAMER V4 — Protected API Boundary

The API boundary is emitted inside Maximum/hardened V4's Lua VM and works
across Lua 5.1, LuaJIT, and Luau. It requires **no Roblox globals or backend
connection** at script startup.

## Behavior

- Snapshot selected **already-present raw global bindings** at VM bootstrap.
  The watched set includes `print`, `require`, `type`, `pcall`,
  `assert`, `tostring`, `table`, `math`, `string`, and other core
  Lua APIs. Missing globals are simply ignored; `game` and `script`
  are not treated as mandatory.
- For VM global lookups, check watched bindings before returning them. Accesses
  to non-watched/custom globals keep their normal Lua semantics.
- For global writes via VM instructions, respect the original assignment
  semantics and update the snapshot. A script that intentionally reassigns
  `print` through the VM remains supported.
- Validate watched host API bindings periodically during VM execution.
  Post-bootstrap direct modification through `_G`/environment aliases
  triggers a fail-closed error before another watched API call.
- The existing metamethod sentinels monitor `__tostring`, `__index`,
  `__newindex`, and `__call`; the explicit Roblox validation remains a
  separate optional platform check.

## Known limits

The boundary is **not** complete API tracing prevention. A preinstalled hook
can be present in the initial snapshots; a hostile runtime can instrument
function calls, mutate underlying libraries/objects, forge guard results, or
observe side effects. Custom environments may be legitimate. Do not reject
every custom global or require `game` to be a Roblox Instance in universal
mode. The design primarily detects a class of *post-startup* changes to
already-visible Lua host API bindings.

Changing a watched global indirectly through `_G.print=...` or `rawset`
is treated as tampering; intentional raw environment mutation may therefore
need a different compatibility profile or application-level review.

## Tests

`tests/vm4-api-boundary.js` runs good-path behavior, custom game-like
globals, normal VM-driven global rebinding, and a direct host-binding mutation
probe across Lua 5.1, LuaJIT and Luau CLI (with `LUAU_BIN`).
Existing `vm4-universal-platform.js`, `vm4-metamethod-trap.js`, and
differential tests provide additional runtime compatibility checks.

Metadata fields: `blackmamerVM.protectedApiBoundary` and
`blackmamerVM.portableApiIntegrityGuard`. No new UI choice is required.
