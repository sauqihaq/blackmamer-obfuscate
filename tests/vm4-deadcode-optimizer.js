'use strict';
const assert=require('node:assert/strict');
const {optimizer,mosaic}=require('../vm4-deadcode-optimizer');
const {compile}=require('../blackmamer-vm3');
const names=['K','GET','SET','TABLE','ADD','SUB','MUL','CAT','MOV','EQ',
 'JUMP','JF','JT','RET','RETVOID','RETM','KRET','GETRET','MOVRET'];
const codes=Object.fromEntries(names.map((name,i)=>[name,i+1]));
const fake=[
 [codes.K,1,1,0],
 [codes.JUMP,5,0,0],
 [codes.GET,2,1,0], // must be optimized out
 [codes.RETVOID,0,0,0], // must be optimized out
 [codes.RET,1,0,0],
 [codes.RETVOID,0,0,0] // unreachable tail
];
const optimized=optimizer(fake,codes);
assert.equal(optimized.removed,3);
assert.equal(optimized.rows.length,3);
assert.equal(optimized.rows[1][1],3);
assert.deepEqual(optimized.rows[2],[codes.RET,1,0,0]);
function reachable(rows){
 const visited=new Set(),queue=[1],term=new Set(
  ['RET','RETM','RETVOID','KRET','GETRET','MOVRET'].map(x=>codes[x])
 );
 while(queue.length){
  const pc=queue.pop();
  if(pc>rows.length||pc<1||visited.has(pc))continue;
  visited.add(pc);
  const row=rows[pc-1],op=row[0];
  if(term.has(op))continue;
  if(op===codes.JUMP)queue.push(row[1]);
  else if(op===codes.JF||op===codes.JT)queue.push(row[2],pc+1);
  else queue.push(pc+1);
 }
 return visited;
}
const baselineGraph=reachable(optimized.rows);
assert.equal(baselineGraph.size,3);
for(let round=0;round<15;round++){
 const dead=mosaic(optimized.rows,codes,3,{density:5,budget:100});
 assert.ok(dead.added>=15);
 assert.ok(dead.blocks>=1);
 assert.equal(dead.rows.length,3+dead.added);
 const actuallyReached=reachable(dead.rows);
 assert.equal(actuallyReached.size,3,'Junk instructions must not execute');
 for(const pc of dead.audit.decoyPositions)
  assert.equal(actuallyReached.has(pc),false,'A branch enters junk at PC '+pc);
 assert.ok(dead.audit.realPositions.every(pc=>actuallyReached.has(pc)));
}
const source=[
 'local total=0',
 'local function f(a) if a%2==0 then return a*3 end return a+7 end',
 'for i=1,20 do total=total+f(i) end',
 'print(total)'
].join('\n');
const signatures=new Set();
for(const target of ['LuaU','Lua51','LuaJIT']){
 const r=compile(source,{target,hardened:true,protectionLevel:'Maximum',
  vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone'});
 assert.equal(r.optimizerEnabled,true);
 assert.ok(r.deadCodeInstructions>r.vmCoreInstructions,
  'Maximum needs materially more VM decoy instructions than core code');
 assert.ok(r.deadCodeBlocks>=1);
 assert.equal(r.vmInstructions,r.vmCoreInstructions+r.deadCodeInstructions);
 assert.equal(r.zeroRuntimeDecoyDispatch,true);
 assert.equal(r.deadCodeStrategy,'sealed-cfg-islands');
 assert.equal(r.vmInterpreterCount,7);
 assert.equal(r.antiTamper,true);
 assert.equal(r.metamethodTostringTrap,true);
 assert.doesNotMatch(r.code,/[\r\n]/);
 assert.equal(r.nativeExemptFunctions,0);
 signatures.add(r.code);
 const noOpt=compile(source,{target,hardened:true,
  protectionLevel:'Maximum',vmArchitecture:'seven-independent',
  irOptimizer:false,autoFunctionEncryption:'standalone'});
 assert.equal(noOpt.optimizerEnabled,false);
 assert.equal(noOpt.deadCodeInstructions,0);
 assert.equal(noOpt.deadCodeBlocks,0);
 assert.equal(noOpt.vmCoreInstructions,noOpt.vmInstructions);
}
assert.equal(signatures.size,3);
const low=compile(source,{target:'Lua51',hardened:true,protectionLevel:'Strong'});
assert.equal(low.optimizerEnabled,false);
assert.equal(low.deadCodeInstructions,0);
console.log('V4 dead-code mosaic: 15 unreachable CFG proofs, 3 runtime layouts, optimizer and security invariants PASS');
