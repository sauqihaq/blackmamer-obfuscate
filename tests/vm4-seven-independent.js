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
 for(let n=1;n<=7;n++){
   assert.match(protectedOutput.code,new RegExp('function execVM'+n+'\\('));
   assert.match(protectedOutput.code,new RegExp('execVM'+n+'\\(fid,passed,captured,spec\\)'));
 }
 assert.match(protectedOutput.code,/local variant=spec\[10\]/);
 assert.equal((protectedOutput.code.match(/function execVM[1-7]\(/g)||[]).length,7);
 assert.equal((protectedOutput.code.match(/while true do/g)||[]).length,7);
 assert.equal((protectedOutput.code.match(/op=\(\(op-/g)||[]).length,7);
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
