'use strict';
const assert=require('node:assert/strict');
const {compile}=require('../blackmamer-vm3');
const {getPreset,PRESETS}=require('../v4-presets');
const source='local function add(x,y)return x+y end;print(add(18,24))';
assert.deepEqual(Object.keys(PRESETS),['fast','balanced','paranoid']);
assert.throws(()=>getPreset('unknown'),/Unknown BLACKMAMER preset/);
const seen=new Set();
for(const name of Object.keys(PRESETS)){
  const options=getPreset(name);
  const a=compile(source,{hardened:true,target:'Lua51',...options,auditPalettes:true});
  const b=compile(source,{hardened:true,target:'Lua51',...options});
  assert.equal(a.predecodedInstructions,true);
  assert.equal(a.parsedInstructionColumns,4);
  assert.ok(a.buildWatermark);
  assert.notEqual(a.buildWatermark,b.buildWatermark);
  assert.notEqual(a.code,b.code);
  assert.ok(a.opcodePaletteFingerprints.every(Boolean));
  assert.equal(new Set(a.opcodePaletteFingerprints).size,a.virtualizedFunctions);
  assert.equal(a.opcodePaletteSize,49,'The current ISA has 49, not 48, opcodes');
  assert.match(a.code,/local function parseStage/);
  assert.match(a.code,/local programCache/);
  assert.ok(a.code.includes('WM:'+a.buildWatermark));
  seen.add(a.buildWatermark);
  if(name==='fast'){
    assert.equal(a.nestedVM,false);
    assert.equal(a.dispatcherVariants,1);
    assert.equal(a.soaPrototypes,0);
  }else if(name==='balanced'){
    assert.equal(a.nestedVM,true);
    assert.equal(a.dispatcherVariants,3);
    assert.ok(a.soaPrototypes>=1);
  }else{
    assert.equal(a.nestedVM,true);
    assert.equal(a.dispatcherVariants,3);
    assert.equal(a.soaPrototypes,a.virtualizedFunctions);
    assert.equal(a.autoFunctionEncryption,'external-full');
    assert.deepEqual(a.protectedFunctions,['BMAUTO_V4']);
    assert.equal(a.generatedKeys.length,1);
    assert.equal(a.generatedKeys[0].id,'BMAUTO_V4');
    assert.equal(a.code.includes(a.generatedKeys[0].key),false);
    assert.doesNotMatch(a.code,/_unfold/);
  }
}
assert.equal(seen.size,3);
console.log('BLACKMAMER V4 named presets, two-stage parse and runtime key requirements PASS');
