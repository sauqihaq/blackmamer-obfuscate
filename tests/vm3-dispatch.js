'use strict';
const assert=require('node:assert/strict');
const {compile}=require('../blackmamer-vm3');

// A previous build with mul=135 and count=5 generated exactly one branch:
// ((op*135+661)%5)==1 is true for every possible opcode.
// Assert a genuine multi-shard dispatch on many independently randomized builds.
const gcd=(x,y)=>{while(y){[x,y]=[y,x%y]}return x;};
let layouts=0;
for(let i=0;i<160;i++){
  const out=compile('print("Hello World")',{antiTamper:true,antiDebug:true}).code;
  const matches=[...out.matchAll(/\(\(op\*(\d+)\+(\d+)\)%(\d+)\)==(\d+) then/g)];
  assert.ok(matches.length>=3,'Dispatcher must have multiple nonempty top-level branches');
  const count=Number(matches[0][3]);
  const mul=Number(matches[0][1]);
  const bias=Number(matches[0][2]);
  assert.ok(count>=3 && count<=7,'Unexpected shard count');
  assert.equal(gcd(mul,count),1,'Shard multiplier must be coprime to count');
  assert.equal(matches.length,count,'Every shard must have a branch');
  assert.equal(new Set(matches.map(x=>Number(x[4]))).size,count,'Shard bucket labels must be unique');
  for(const m of matches){
    assert.equal(Number(m[1]),mul);
    assert.equal(Number(m[2]),bias);
    assert.equal(Number(m[3]),count);
    assert.ok(Number(m[4])>=0 && Number(m[4])<count);
  }
  const handlerCount=[...out.matchAll(/(?:if|elseif) op==\d+ then/g)].length;
  assert.ok(handlerCount>=30,'VM handlers missing after partition');
  layouts++;
}
console.log('PASS '+layouts+' randomized VM3 dispatchers: populated branches, coprime multipliers, complete handlers');
