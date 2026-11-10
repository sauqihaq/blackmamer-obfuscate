# BLACKMAMER `BM_ENCFUNC` (Native V4) — External Function Keys

**Experimental. Only for Roblox server-side scripts / private Lua runtimes with an external key provider.** This is a custom BLACKMAMER feature, not Luraph code and not a drop-in replacement for its proprietary macros.

## Use it from the website

1. Select **Native V4** and click **Contoh BM_ENCFUNC**.
2. Functions to encrypt must use `BM_ENCFUNC("id", function(args) ... end)`. The ID starts with a letter and contains up to 64 letters, digits, underscores or dashes.
3. Click **Obfuscate Script**. The backend generates a random **256-bit key** per ID and returns those keys **only in that response**. The script output contains the function ID, nonce and authenticated ciphertext, **not the secret**.
4. Download **BlackmamerKeyProvider.lua** from panel **03**. Create a **ModuleScript** with that name inside **ServerScriptService**. Do not publish that provider or put keys in a LocalScript, ReplicatedStorage, or StarterPlayer.
5. Paste the obfuscated code into a Roblox **Script (server)**. Ensure the original source sets `BLACKMAMER_KEY_PROVIDER` before the encrypted function is actually called. The marker is a compile-time intrinsic and disappears from the obfuscated output.

### Example Luau source

```lua
BLACKMAMER_KEY_PROVIDER = require(
    game:GetService("ServerScriptService"):WaitForChild("BlackmamerKeyProvider")
)

local premium = BM_ENCFUNC("premium", function(n)
    local function double(x)
        return x * 2
    end
    return double(n) + 10
end)

print("Premium:", premium(16))
```

A generated key-provider ModuleScript resembles:

```lua
-- SERVER-ONLY. This value is a placeholder; use the generated key from your build.
local keys = {
    ["premium"] = "<64-character secret hex string>",
}
return function(id)
    local key = keys[id]
    if not key then error("Unknown protected function ID") end
    return key
end
```

**Never paste a real key into the source sent to the obfuscator** or into code that clients receive. The example uses a ModuleScript stored only in Roblox's server-side container. A production provider may instead request the key from an independently authenticated HTTPS license/key service; that service is **not** implemented or hosted by BLACKMAMER in this change.

## Existing API

`POST /api/obfuscate` with `preset: "NativeV4"`, `target: "LuaU"` and `script: "...BM_ENCFUNC(...)"`. New fields:

- `externalKeys: [{id,key}]`: newly generated 256-bit hex keys, returned once and **not stored server-side**. If you lose them, rebuild the obfuscation or provide the key explicitly to the compiler.
- `protectedFunctionIds: ["premium"]`: protected feature IDs.
- `blackmamerVM.protectedFunctions`: number of distinct protected feature IDs.
- Optional `functionKeys: {"premium":"<existing 64 hex secret>"}` lets the owner provide an existing key. Keys supplied by the caller are not echoed in `externalKeys`.

Important: the API is currently publicly callable, and generated keys are returned directly to the requesting browser. Treat those responses as sensitive, and secure your real deployment with authentication, rate limiting and TLS. The obfuscation service does not persist keys, issue remote credentials, or implement licensing/whitelisting.

## Technical implementation

Each protected function (including child function prototypes) has packed VM bytecode encrypted using a per-function 96-bit random nonce and an HMAC-SHA256-based keystream derived from a 256-bit external key. The ciphertext is authenticated with a distinct HMAC-SHA256 domain. The outer native C++ sealer then applies the existing S-box layer to the protected ciphertext. When the function is executed the VM calls `BLACKMAMER_KEY_PROVIDER(id)`, verifies the keyed authentication tag, and decrypts the packed bytes on-demand. A wrong key, missing provider, or altered ciphertext fails closed. The SHA-256 and HMAC runtime are implemented in pure Luau (no `loadstring` requirement).

The key is never embedded in the generated VM chunk, but the executing **server** can still access it, and anyone with privileged access to that server can dump the decrypted bytes. This does **not** establish equivalence to Luraph, nor is it a general-purpose key-management system. Keyed decryption adds runtime overhead, so benchmark real Roblox game workloads. Native V3 remains unchanged.

### Local tests

```bash
node tests/vm4-external-keys.js
# With official Luau CLI installed:
LUAU_BIN=luau node tests/vm4-external-luau.js
```
