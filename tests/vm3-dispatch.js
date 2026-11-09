'use strict';
const assert=require('node:assert/strict');
const {compile}=require('../blackmamer-vm3');

// The output must keep all VM operations, never silently fall through on an
// unknown opcode, and vary between a modulus-sharded dispatcher and a sorted
// decision tree. This is polymorphism, not cryptographic security.
const gcd=(x,y)=>{while(y){[x,y]=[y,x%y]}return x;};
const seen=new Set();
for(let i=0;i<160;i++){
  const forced=i%2===0?'shard':'tree';
  const result=compile('print("Hello World")',
    {antiTamper:true,antiDebug:true,dispatchMode:forced});
  const out=result.code;
  assert.equal(result.dispatchStructure,forced);
  seen.add(forced);
  const matches=[...out.matchAll(/\(\(op\*(\d+)\+(\d+)\)%(\d+)\)==(\d+) then/g)];
  const comparisons=[...out.matchAll(/(?:if|elseif) op[<>=]+\d+/g)];
  assert.ok(comparisons.length>=12,'Generated code lost opcode conditions');
  assert.equal((out.match(/BLACKMAMER V3 invalid opcode/g)||[]).length,1,
    'Invalid opcode must have exactly one centralized failure path');
  assert.doesNotMatch(out,/else nativeError\("BLACKMAMER V3 invalid opcode"\)/,
    'No nested repeated invalid-opcode else clauses allowed');
  assert.match(out,/if not _d[a-f0-9]{10} then nativeError\("BLACKMAMER V3 invalid opcode"\) end/,
    'Invalid opcode guard must be retained');
  if(forced==='tree'){
    assert.equal(matches.length,0,'Tree dispatcher must not use modulo shards');
    assert.match(out,/(?:if|elseif) op<\d+/,'Tree lacks less-than branch');
    assert.match(out,/(?:if|elseif) op>\d+/,'Tree lacks greater-than branch');
  }else{
    assert.ok(matches.length>=3,'Sharded dispatcher needs multiple branches');
    const count=Number(matches[0][3]);
    const mul=Number(matches[0][1]);
    const bias=Number(matches[0][2]);
    assert.ok(count>=3&&count<=7);
    assert.equal(gcd(mul,count),1,'Shard multiplier must be coprime to count');
    assert.equal(matches.length,count,'Every shard must have a branch');
    assert.equal(new Set(matches.map(x=>Number(x[4]))).size,count,
      'Shard bucket labels must be unique');
    for(const match of matches){
      assert.equal(Number(match[1]),mul);
      assert.equal(Number(match[2]),bias);
      assert.equal(Number(match[3]),count);
    }
  }
}
for(let i=0;i<64;i++){
  const result=compile('print("Hello World")',{});
  seen.add(result.dispatchStructure);
  assert.equal((result.code.match(/BLACKMAMER V3 invalid opcode/g)||[]).length,1);
}
assert.deepEqual([...seen].sort(),['shard','tree']);
console.log('PASS 224 randomized V3 dispatchers (tree and shards), one centralized failure guard');
