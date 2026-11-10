# Native V4 — Auto Function Encryption

Auto Function Encryption is an opt-in Native V4 compiler feature. The compiler encrypts eligible function bytecode **without requiring `BM_ENCFUNC` markers**.

## Modes

| `autoFunctionEncryption` | Effect | Requires extra file? | Secret in output? |
| --- | --- | --- | --- |
| `off` | Existing V4 VM behavior; explicit `BM_ENCFUNC` continues to work | Only when explicit markers are used | No for marked functions |
| `standalone` | Encrypts **all compiled function prototypes, including the entry** with one random per-build key | **No**, one copy-paste script | **Yes**; split key material is reconstructible |
| `external` | Encrypts **all ordinary nested/declared function prototypes except the root bootstrap** with a per-build 256-bit external key | **Yes**, one server-only ModuleScript | **No**, generated key is returned only once |

The default for existing API clients is `off` to preserve backward compatibility. The premium frontend offers `standalone` as the default selected option when choosing Native V4.

When `external` is selected, put the one-time generated `BlackmamerKeyProvider.lua` into `ServerScriptService` as a ModuleScript named **BlackmamerKeyProvider**. V4 automatically loads it the first time a protected function is called, without requiring modifications to the original source. This **only works in Roblox Script on the server**. Existing `BLACKMAMER_KEY_PROVIDER` assignment still takes precedence and enables custom key-hosting services. If no protected nested function exists, external mode emits no new key and reports zero encrypted function prototypes.

Functions explicitly marked with `BM_ENCFUNC("id", function...) ` always retain their specified external-key behavior, regardless of the automatic mode. The reserved ID `BMAUTO_V4` is used for automatically protected functions. A standalone auto build containing explicit `BM_ENCFUNC` still requires the keys for those explicit markers.

## API

Send to `POST /api/obfuscate`:

```json
{
  "preset": "NativeV4",
  "target": "LuaU",
  "script": "local function sum(a,b) return a+b end\nprint(sum(2,3))",
  "autoFunctionEncryption": "standalone",
  "antiTamper": true,
  "antiDebug": true
}
```

Response metadata:
- `blackmamerVM.autoFunctionEncryption`: chosen mode
- `blackmamerVM.autoEncryptedFunctions`: number of automatically encrypted function prototypes
- `blackmamerVM.externallyKeyedFunctions`: number of externally keyed encrypted prototypes
- `externalKeys`: one-time keys for `external` or explicit `BM_ENCFUNC` markers; **empty for standalone-only auto encryption**

**Security:** standalone encryption is a reversible second layer. The complete key and decryption routine must ship to the executor. This does not imply equivalent protection to Luraph, nor that the code can never be recovered. The external mode protects keys only when used with a trusted Roblox **server-side provider**; do not distribute server-only keys through LocalScripts, ReplicatedStorage, HTTP responses to untrusted clients or client-visible configuration.

## Testing

The Native V4 GitHub Actions workflow tests official Luau execution of standalone functions, closures, external-key functions, no-provider rejection, wrong-key rejection and automatic Roblox-style provider resolution, plus existing V3/V4 regression tests. Script performance should be benchmarked in Roblox Studio before production.
