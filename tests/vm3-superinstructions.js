'use strict';
const assert=require('node:assert/strict');
const {compile}=require('../blackmamer-vm3');

// Structural tests for independent VM bytecode superinstructions, not a claim
// that fused opcodes can never be lifted by a motivated reverse engineer.
const samples=[
  ['hello','print("Hello World")'],
  ['two-constants','print(3,4)'],
  ['const-plus-global','print(3,globalValue)'],
  ['local-init','local value=42\nprint(value)'],
  ['branch-reindex','local n=3\nif n>2 then print("yes") else print("no") end'],
  ['while-reindex','local n=0\nwhile n<3 do n=n+1 end\nprint(n)'],
  ['closure-reindex','local function get(x) return function(y) return x+y end end\nprint(get(2)(3))']
];
const allCounts={GETK:0,KGET:0,KK:0,KDECL:0};
let builds=0;
for(const [label,src] of samples){
  const baseline=compile(src,{superInstructions:false});
  assert.equal(baseline.fusedInstructions,0,label+' baseline must not fuse');
  for(let i=0;i<90;i++){
    const out=compile(src,{superInstructions:true});
    assert.equal(out.engine,'BLACKMAMER V3 Native VM');
    assert.ok(out.vmInstructions>0);
    assert.ok(out.vmInstructions<=baseline.vmInstructions,label+' fusion must not increase VM instruction count');
    assert.equal(
      Object.values(out.superInstructionKinds).reduce((a,b)=>a+b,0),
      out.fusedInstructions,label+' fusion metadata inconsistent'
    );
    assert.equal(
      baseline.vmInstructions-out.vmInstructions,
      out.fusedInstructions,label+' each fusion should remove exactly one instruction'
    );
    for(const kind of Object.keys(allCounts))allCounts[kind]+=out.superInstructionKinds[kind];
    builds++;
  }
}
for(const [kind,used] of Object.entries(allCounts)){
  assert.ok(used>0,'Missing fused opcode in randomized samples: '+kind);
}
assert.ok(allCounts.GETK>0,'Hello World should sometimes use superinstructions');
console.log('PASS '+builds+' native VM builds with superinstructions: '+JSON.stringify(allCounts));
