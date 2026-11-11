'use strict';
// Test that protection no longer leaks the user's original *local* names in
// recovered VM DECL/GET/SET names. Globals and API member strings intentionally
// remain valid. Also verify the physical register allocator is not R1..Rn.
const assert=require('node:assert/strict');
const {compile}=require('../blackmamer-vm3');

const src=[
 'local secretSessionCounter=9',
 'local function privateAccumulator(secretArgValue)',
 '  local secretSessionCounter=secretArgValue+3',
 '  local function inner(privateCapturedArg)',
 '    return secretSessionCounter+privateCapturedArg',
 '  end',
 '  return inner',
 'end',
 'local f=privateAccumulator(secretSessionCounter)',
 'local shadowProbe=0',
 'do local shadowProbe=43; print("shadow",shadowProbe) end',
 'print("closure",f(30),shadowProbe)',
 'local steps=0',
 'repeat',
 '  local repeatLocal=steps+1',
 '  steps=repeatLocal',
 'until repeatLocal>=3',
 'print("repeat",steps)'
].join('\n');

const protectedNames=[
 'secretSessionCounter','privateAccumulator','secretArgValue',
 'privateCapturedArg','shadowProbe','repeatLocal'
];
const hashedRuns=new Set();
for(let run=0;run<12;run++){
 const v4=compile(src,{hardened:true,nestedVM:true,
   protectionLevel:'Maximum',autoFunctionEncryption:'standalone',
   auditBindings:true});
 assert.ok(v4.virtualizedLexicalBindings>=10);
 assert.equal(v4.randomizedRegisterAllocation,true);
 assert.ok(v4.bindingAudit.every(x=>x.original!==x.alias));
 for(const name of protectedNames){
   assert.ok(v4.bindingAudit.some(x=>x.original===name),
     'Missing lexical binding audit '+name);
 }
 for(const item of v4.bindingAudit){
   assert.match(item.alias,/^_[0-9a-f]{22}$/);
   assert.equal(v4.bindingAudit.filter(x=>x.alias===item.alias).length,1);
 }
 const sameName=v4.bindingAudit.filter(x=>x.original==='secretSessionCounter');
 assert.equal(sameName.length,2,'Shadowed declarations need distinct names');
 assert.notEqual(sameName[0].alias,sameName[1].alias);
 for(const ids of v4.registerAllocationAudit){
   if(ids.length===0)continue;
   assert.equal(new Set(ids).size,ids.length,'Physical regs reused in prototype');
   assert.ok(ids.every(n=>Number.isInteger(n)&&n>=1&&n<=2048));
   if(ids.length>=8)
     assert.ok(ids.some(n=>n>100),'V4 register locations should be spread across pool');
 }
 const signature=v4.bindingAudit.map(x=>x.alias).join('|');
 assert.equal(hashedRuns.has(signature),false);
 hashedRuns.add(signature);
 assert.ok(!v4.code.includes('bindingAudit'));
 assert.ok(!v4.code.includes('registerAllocationAudit'));
 assert.ok(!v4.code.includes('secretSessionCounter'));
}
const old=compile(src,{hardened:false,auditBindings:true});
assert.equal(old.virtualizedLexicalBindings,0);
assert.equal(old.randomizedRegisterAllocation,false);
assert.ok(old.registerAllocationAudit.some(ids=>
 ids.length>=4&&ids.slice(0,4).every((n,i)=>n===i+1)));
console.log('V4 binding hardening: scope-aware local aliases, shadowing and random register IDs verified across 12 builds');
