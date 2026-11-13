'use strict';
const assert=require('node:assert/strict');
const {checkRuntimePolicy,describeRuntimeSecurity,hasProtectedMarker}=require('../runtime-security-policy');
const {lex}=require('../blackmamer-vm3');
const check=opts=>checkRuntimePolicy({target:'LuaU',...opts});

assert.deepEqual(check({executionContext:'client'}),{ok:true,context:'client'});
assert.deepEqual(check({executionContext:'server',runtimeMode:'server-vault'}),{ok:true,context:'server'});
assert.deepEqual(check({executionContext:'portable',target:'Lua51'}),{ok:true,context:'portable'});
assert.equal(check({}).context,'unspecified','Backward compatible native Luau API');
assert.equal(check({runtimeMode:'server-vault'}).context,'server','Backwards compatible vault API');
for(const mode of ['external','external-full']){
 assert.equal(check({executionContext:'client',autoFunctionEncryption:mode}).code,'CLIENT_KEY_POLICY');
}
assert.equal(check({executionContext:'client',preset:'paranoid'}).code,'CLIENT_KEY_POLICY');
assert.equal(check({executionContext:'client',functionKeys:{}}).code,'CLIENT_KEY_POLICY');
assert.equal(check({executionContext:'client',runtimeMode:'server-vault'}).code,'SERVER_VAULT_CONTEXT');
assert.equal(check({executionContext:'server',target:'Lua51'}).code,'ROBLOX_CONTEXT_REQUIRES_LUAU');
assert.equal(check({executionContext:'malformed'}).code,'INVALID_EXECUTION_CONTEXT');
const client=describeRuntimeSecurity({
 context:'client',runtimeMode:'standalone',autoFunctionEncryption:'standalone',externallyKeyedFunctions:0
});
assert.equal(client.keyLocation,'embedded-reconstructible');
assert.match(client.warnings[0],/observable/);
const vault=describeRuntimeSecurity({
 context:'server',runtimeMode:'server-vault',autoFunctionEncryption:'external-full',externallyKeyedFunctions:1
});
assert.equal(vault.keyLocation,'authenticated-server-vault');
assert.equal(vault.warnings.length,1);
assert.equal(hasProtectedMarker(lex('print("BM_ENCFUNC(42)") -- BM_ENCFUNC("x")')),false);
assert.equal(hasProtectedMarker(lex('local f=BM_ENCFUNC("secure",function() return 42 end)')),true);
assert.equal(hasProtectedMarker(lex('object.BM_ENCFUNC("x")')),false);
console.log('Client/server runtime trust boundary policy PASS');
