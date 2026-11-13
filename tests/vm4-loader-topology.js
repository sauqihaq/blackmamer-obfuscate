'use strict';
// Regression for the independent BLACKMAMER table+state-machine topology.
// Visual complexity is not a cryptographic security metric; real semantic
// parity is checked by vm4-luau.js, vm4-lua51.js and differential-50.
const assert=require('node:assert/strict');
const {compile}=require('../blackmamer-vm3');
const source='local function f(x)return x*3+1 end;print(f(7))';
const seen=new Set();
for(const target of ['LuaU','Lua51','LuaJIT']){
 for(let round=0;round<2;round++){
  const r=compile(source,{
   target,hardened:true,protectionLevel:'Maximum',
   vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone'
  });
  assert.equal(r.metatableEntrypoint,true);
  assert.equal(r.stateMachineDispatch,true);
  assert.equal(r.tableDrivenDispatch,true);
  assert.equal(r.vmInterpreterCount,7);
  assert.equal(r.autoFunctionEncryption,'standalone');
  assert.equal(r.generatedKeys.length,0);
  assert.ok(r.runtimeAliasCount>=25);
  assert.match(r.code,/^--\[\[BLACKMAMER VM V4\.0\]\]return\s+setmetatable\s*\(/);
  assert.equal(r.cachedOpcodeRouter,true);
  assert.equal(r.directOpcodeTableDispatch,true);
  assert.equal(r.localInstructionColumns,true);
  assert.ok((r.code.match(/__index\s*=\s*function/g)||[]).length>=8,
    'Seven independently shuffled cached opcode routers and engine router remain');
  assert.ok((r.code.match(/while\s+_[A-Za-z0-9_]+\s*~=\s*0\s*do/g)||[]).length>=7);
  assert.doesNotMatch(r.code,/_routeId|_unfold|BMAUTO_V4|function\s+execVM[1-7]\s*\(/);
  assert.notEqual(seen.has(r.buildWatermark),true);
  seen.add(r.buildWatermark);
 }
}
const strong=compile(source,{target:'Lua51',hardened:true,protectionLevel:'Strong'});
assert.equal(strong.metatableEntrypoint,false,'Only Maximum enables the table entrypoint');
assert.equal(strong.stateMachineDispatch,false,'Nested decoder remains a separate architecture');
console.log('BLACKMAMER V4 loader-style state machine: 3 runtimes x 2 builds, executable topology contracts PASS');
