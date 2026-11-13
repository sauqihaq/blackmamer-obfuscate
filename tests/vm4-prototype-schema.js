'use strict';
// Audit that stand-alone Maximum no longer uses the v4 sample3 fixed
// prototype header+operand decoding recipe. The decoder remains reversible
// because all information required to run it travels with the loader.
const assert=require('node:assert/strict');
const {compile}=require('../blackmamer-vm3');
const src=[
 'local function compute(n)',
 '  local sum=0',
 '  for i=1,n do if i%2==0 then sum=sum+i*3 else sum=sum-i end end',
 '  return sum',
 'end',
 'local function twice(v)return compute(v)+compute(v+1)end',
 'print(twice(12))'
].join('\n');
const encountered=new Set(),signatures=new Set();
for(const target of ['LuaU','Lua51','LuaJIT']){
 for(let attempt=0;attempt<5;attempt++){
  const r=compile(src,{
   hardened:true,target,protectionLevel:'Maximum',
   vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone',
   auditPrototypeSchemas:true
  });
  assert.equal(r.perPrototypeEncodingSchemas,true);
  assert.equal(r.prototypeSchemaVariants,4);
  assert.equal(r.prototypeSchemaCount,r.virtualizedFunctions);
  assert.ok(r.virtualizedFunctions>=3);
  assert.equal(r.prototypeSchemaFingerprints.length,r.virtualizedFunctions);
  assert.equal(new Set(r.prototypeSchemaFingerprints).size,r.virtualizedFunctions);
  for(const fp of r.prototypeSchemaFingerprints){
   assert.match(fp,/^[0-3]:[0-9]+:[0-9]+:[0-9]+$/);
   const [mode,seed,mul,bias]=fp.split(':').map(Number);
   assert.ok(seed>=1&&seed<=60000&&mul>=1&&mul<=255&&bias>=1&&bias<=255);
   encountered.add(mode);
   // The audit fingerprint cannot be embedded in generated source.
   assert.equal(r.code.includes(fp),false);
  }
  assert.equal(r.vmInterpreterCount,7);
  assert.equal(r.antiTamper,true);
  assert.equal(r.metamethodTostringTrap,true);
  assert.equal(r.autoEncryptedFunctions,r.virtualizedFunctions);
  assert.doesNotMatch(r.code,/[\r\n]/);
  signatures.add(r.prototypeSchemaFingerprints.join('|'));
 }
}
assert.ok(encountered.size>=3,'Per-build decoder should exercise 3+ actual schema modes');
assert.equal(signatures.size,15,'Each compilation needs new per-function format coefficients');
const strong=compile(src,{
 hardened:true,target:'Lua51',protectionLevel:'Strong',
 autoFunctionEncryption:'standalone'
});
assert.equal(strong.perPrototypeEncodingSchemas,false);
assert.equal(strong.prototypeSchemaCount,0);
assert.equal(strong.prototypeSchemaVariants,0);
const v3=compile('print(42)',{hardened:false,target:'Lua51'});
assert.equal(v3.perPrototypeEncodingSchemas,false);
console.log('V4 polymorphic schema: 15 independent Maximum builds, per-prototype coefficients and legacy format isolation PASS');
