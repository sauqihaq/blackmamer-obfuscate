'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {buildLayers,encodeOpcode,decodeOpcode,fingerprints}=require('../vm7-layers');
const {compile}=require('../blackmamer-vm3');
const rand=n=>crypto.randomInt(n);
let validated=0;
for(let sample=0;sample<12;sample++){
 const layers=buildLayers(rand);
 assert.equal(layers.length,5);
 for(const stage of layers){
  assert.equal(stage.bytes[0],7);
  assert.equal(stage.bytes.length,15);
  assert.equal(new Set(Object.values(stage.opcodes)).size,7);
 }
 const ids=fingerprints(layers);
 assert.equal(new Set(ids).size,5);
 for(const pc of [1,2,37,131,255]){
  for(const seed of [1,17,99,255]){
   for(let opcode=0;opcode<256;opcode++){
    const encrypted=encodeOpcode(opcode,pc,seed,layers);
    assert.ok(encrypted>=0&&encrypted<=255);
    assert.equal(decodeOpcode(encrypted,pc,seed,layers),opcode,
      'Five-stage opcode encryption must be exactly reversible');
    validated++;
   }
  }
 }
}
const source='local function bump(n) return n+3 end;print(bump(39))';
const maximum=compile(source,{
 hardened:true,protectionLevel:'Maximum',nestedVM:true,
 autoFunctionEncryption:'standalone',auditMicroVMs:true});
assert.equal(maximum.vmInterpreterCount,7);
assert.equal(maximum.opcodeMicroVMs,5);
assert.equal(maximum.microVMInstructions,35);
assert.equal(maximum.microVMFingerprints.length,5);
for(let id=3;id<=7;id++){
 assert.match(maximum.code,new RegExp('local function _vm'+id+'\\('));
 assert.match(maximum.code,new RegExp('op=_vm'+id+'\\(op,pc,spec\\[3\\]\\)'));
}
assert.match(maximum.code,/local function outerVM\(/);
assert.deepEqual(maximum.generatedKeys,[]);
assert.ok(!maximum.code.includes('microVMFingerprints'),
 'Test-only audit values must not leak into the generated artifact');
const maximumAgain=compile(source,{hardened:true,protectionLevel:'Maximum',
 nestedVM:true,auditMicroVMs:true});
assert.notDeepEqual(maximum.microVMFingerprints,maximumAgain.microVMFingerprints);
for(const level of ['Minify','Light','Medium','Strong']){
 const x=compile('print(42)',{hardened:true,protectionLevel:level});
 assert.equal(x.vmInterpreterCount,level==='Minify'||level==='Light'?1:2);
 assert.equal(x.opcodeMicroVMs,0);
 assert.equal(x.microVMInstructions,0);
}
const v3=compile('print(42)',{hardened:false});
assert.equal(v3.vmInterpreterCount,1);
console.log('V4 seven interpreters: '+validated+
 ' staged opcode round-trips, five independently dispatched microprograms, archived modes PASS');
