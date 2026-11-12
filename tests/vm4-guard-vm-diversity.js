'use strict';
const assert=require('node:assert/strict');
const {compile}=require('../blackmamer-vm3');
const {isLicense}=require('../license-format');
const crypto=require('node:crypto');

// Six six-digit groups, exactly matching commercial issuance.
const good='BM-'+Array.from({length:6},()=>crypto.randomBytes(3).toString('hex').toUpperCase()).join('-');
assert.equal(good.length,44);
assert.equal(isLicense(good),true);
for(const bad of [
 good+'A',good.slice(0,-1),good.toLowerCase(),good.replace(/-/g,''),
 good.replace(/^BM-[A-F0-9]{6}-/,'BM-12345-'), 'BM-'+'G'.repeat(36),good+' ',
 '',null,{},'BM-'+('ABCD-'.repeat(8))
])assert.equal(isLicense(bad),false,String(bad));

// Structural permutation uses the actual grouped opcode handler ordering,
// not aliases, state numbers, S-box bytes, or the public watermark.
const src='local function f(x)return (x+2)*3 end;print(f(7))';
const all=new Set();
for(let round=0;round<10;round++){
 const r=compile(src,{target:'Lua51',hardened:true,
  protectionLevel:'Maximum',vmArchitecture:'seven-independent',
  autoFunctionEncryption:'standalone',auditVmTopology:true});
 assert.equal(r.guardIntervalPolicy,'prototype-scaled');
 assert.equal(r.vmEngineDispatchFingerprints.length,7);
 assert.equal(new Set(r.vmEngineDispatchFingerprints).size,7,
  'Each engine needs a distinct handler-group topology');
 for(const hash of r.vmEngineDispatchFingerprints){
  assert.match(hash,/^[a-f0-9]{64}$/);
  assert.equal(all.has(hash),false,'Repeated dispatcher handler topology');
  all.add(hash);
 }
 assert.equal(r.code.includes(r.vmEngineDispatchFingerprints[0]),false,
  'Audit fingerprints must never appear in protected Lua output');
}
assert.equal(all.size,70);
const legacy=compile(src,{target:'Lua51',hardened:true,protectionLevel:'Strong'});
assert.equal(legacy.vmEngineDispatchFingerprints,undefined);
assert.equal(legacy.guardIntervalPolicy,'prototype-scaled');
console.log('V4 VM diversity: 70 distinct logical handler topologies over 10 builds; strict license format PASS');
