'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {encryptBytes,decryptBytes,requireId,requireKey,runtimeLines}=
  require('../protected-functions');
const {compile}=require('../blackmamer-vm3');

for(let attempt=0;attempt<50;attempt++){
  const secret=crypto.randomBytes(32).toString('hex');
  const source=crypto.randomBytes(attempt*7);
  const id='test_core';
  const sealed=encryptBytes(source,secret,id);
  const original=decryptBytes(sealed.bytes,secret,id,sealed.nonce,sealed.tag);
  assert.deepEqual(original,source);
  assert.throws(()=>decryptBytes(sealed.bytes,crypto.randomBytes(32).toString('hex'),
    id,sealed.nonce,sealed.tag),/invalid|modified/);
  assert.throws(()=>decryptBytes(sealed.bytes,secret,id+'_wrong',
    sealed.nonce,sealed.tag),/invalid|modified/);
  if(sealed.bytes.length){
    const damaged=sealed.bytes.slice();
    damaged[0]^=1;
    assert.throws(()=>decryptBytes(damaged,secret,id,sealed.nonce,sealed.tag),/invalid|modified/);
  }
}
assert.throws(()=>requireKey('1234'),/64/);
assert.throws(()=>requireId('../bad'),/Protected/);
assert.ok(runtimeLines().length>60);

const source=`local secure = BM_ENCFUNC("premium",function(a)
  local function inner(b)return a+b end
  return inner(12)
end)
print(secure(30))`;
const result=compile(source,{hardened:true,nestedVM:true});
assert.deepEqual(result.protectedFunctions,['premium']);
assert.equal(result.generatedKeys.length,1);
assert.equal(result.generatedKeys[0].id,'premium');
assert.match(result.generatedKeys[0].key,/^[a-f0-9]{64}$/);
assert.equal(result.code.includes(result.generatedKeys[0].key),false);
assert.doesNotMatch(result.code,/external key provider missing|nativeError\("BLACKMAMER/);
assert.match(result.code,/nativeError\("E[0-9a-f]{12}"\)/);
assert.ok(result.scrubbedRuntimeErrors>=10);
assert.equal(result.nestedVM,true);
assert.equal(result.virtualizedFunctions>=3,true);
const again=compile(source,{hardened:true,functionKeys:{premium:result.generatedKeys[0].key}});
assert.deepEqual(again.protectedFunctions,['premium']);
assert.deepEqual(again.generatedKeys,[]);
assert.notEqual(result.code,again.code);
assert.throws(()=>compile(source,{hardened:false}),/requires NativeV4/);
assert.throws(()=>compile('print(BM_ENCFUNC(123, function()return 1 end))',{hardened:true}),
  /BM_ENCFUNC expects/);
assert.throws(()=>compile(source,{hardened:true,functionKeys:{premium:'bad'}}),/64/);
const ordinary=compile('print(42)',{hardened:true});
assert.deepEqual(ordinary.protectedFunctions,[]);
assert.deepEqual(ordinary.generatedKeys,[]);
assert.equal(ordinary.code.includes('efDecrypt'),false);
console.log('BLACKMAMER protected functions: 50 authenticated crypto parity checks + compiler marker tests passed');
