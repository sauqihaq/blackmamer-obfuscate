'use strict';
const assert=require('node:assert/strict');
const {compile}=require('../blackmamer-vm3');
const funcs=Array.from({length:7},(_,i)=>
 'local function f'+(i+1)+'(x) return x+'+(i+1)+' end');
const program=[...funcs,
 'print('+Array.from({length:7},(_,i)=>'f'+(i+1)+'(1)').join(',')+')'
].join('\n');
for(let round=0;round<6;round++){
 const protectedOutput=compile(program,{
   hardened:true,protectionLevel:'Maximum',nestedVM:true,
   vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone'
 });
 assert.equal(protectedOutput.vmArchitecture,'seven-independent');
 assert.equal(protectedOutput.vmInterpreterCount,7);
 assert.equal(protectedOutput.vmVariants,7);
 assert.equal(protectedOutput.vmSelectedPerPrototype,true);
 assert.equal(protectedOutput.nestedVM,false);
 assert.equal(protectedOutput.outerVmInstructions,0);
 assert.ok(protectedOutput.virtualizedFunctions>=8);
 assert.equal(protectedOutput.autoEncryptedFunctions,protectedOutput.virtualizedFunctions);
 assert.deepEqual(protectedOutput.generatedKeys,[]);
 assert.doesNotMatch(protectedOutput.code,/local function outerVM\(/);
 assert.ok(protectedOutput.runtimeAliasCount>=30,'Expected polymorphic VM identifiers');
 assert.equal(protectedOutput.runtimeChaosLineBreaks,0,'One-line V4 output must not inject newlines');
 assert.doesNotMatch(protectedOutput.code,/[\r\n]/,'VM output must have no physical line breaks');
 assert.doesNotMatch(protectedOutput.code,/execVM[1-7]|_unfold|BMAUTO_V4/);
 assert.equal(protectedOutput.stateMachineDispatch,true);
 assert.equal(protectedOutput.tableDrivenDispatch,true);
 // Seven complete interpreters, now routed by an encoded function table
 // rather than a predictable if/elseif engine selector.
 assert.doesNotMatch(protectedOutput.code,/_routeId|elseif\s+variant|execVM[1-7]/);
 assert.equal((protectedOutput.code.match(/while\s+true\s+do/g)||[]).length,7);
 assert.equal(protectedOutput.cachedOpcodeRouter,true);
 assert.equal(protectedOutput.directOpcodeTableDispatch,true);
 assert.equal(protectedOutput.localInstructionColumns,true);
 assert.ok((protectedOutput.code.match(/__index\s*=\s*function/g)||[]).length>=8,
   'Every VM retains its own sealed-palette route table and invalid-opcode fallback');
 assert.doesNotMatch(protectedOutput.code,/__call\s*=\s*function/,
   'Opcode dispatch must not invoke __call on each instruction');
 assert.ok((protectedOutput.code.match(/setmetatable\s*\(/g)||[]).length>=8,
   'Seven opcode route tables plus an engine-router table expected');
 assert.equal(protectedOutput.dispatcherVariants,7);
 assert.equal(protectedOutput.dispatchStructure,'seven-per-prototype');
}
const archived=compile('print(42)',{
 hardened:true,protectionLevel:'Maximum',nestedVM:true
});
assert.equal(archived.vmArchitecture,'nested');
assert.equal(archived.vmInterpreterCount,2);
assert.equal(archived.vmVariants,1);
assert.equal(archived.nestedVM,true);
const v3=compile('print(42)',{hardened:false});
assert.equal(v3.vmInterpreterCount,1);
console.log('Seven separate VM engines: 7 complete opcode dispatchers, per-function routing, independent ISA mappings, no stacked outer VM PASS');
