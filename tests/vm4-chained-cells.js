'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const feedback=require('../vm4-chained-cells');
const {compile}=require('../blackmamer-vm3');
const rnd=(n)=>crypto.randomInt(n);
const MOD=feedback.MODULUS;
let observedStatelessFailure=0,observedPropagation=0;
// Verify both storage layouts and all four per-function schema families,
// including a long chain and corruption propagation.
for(let mode=0;mode<4;mode++){
  for(const layout of ['aos','soa']){
    for(let attempt=0;attempt<20;attempt++){
      const schema={seed:1+rnd(60000),mul:1+rnd(255),
        bias:1+rnd(255),mode};
      const opSeed=1+rnd(255);
      const coefA=7+rnd(113),coefB=11+rnd(151);
      const rows=Array.from({length:60+rnd(30)},()=>
        Array.from({length:4},()=>rnd(MOD)));
      const cellMask=feedback.states(rows,schema,opSeed,coefA,coefB);
      const encrypted=rows.map((row,index)=>row.map((value,j)=>
        (value+feedback.mask(schema,index+1,j+1,cellMask[index],coefA,coefB))%MOD));
      // AoS and SoA are different physical layouts of the SAME logical cells.
      const encoded=layout==='aos'
        ?encrypted.flat()
        :Array.from({length:4},(_,j)=>encrypted.map(row=>row[j])).flat();
      const get=(pc,logical)=>layout==='aos'
        ?encoded[(pc-1)*4+logical-1]
        :encoded[(logical-1)*rows.length+pc-1];
      let state=feedback.initialState(schema,opSeed);
      for(let pc=1;pc<=rows.length;pc++){
        const decoded=Array.from({length:4},(_,j)=>(
          get(pc,j+1)-feedback.mask(schema,pc,j+1,state,coefA,coefB)+MOD)%MOD);
        assert.deepEqual(decoded,rows[pc-1],mode+'/'+layout+' PC '+pc);
        state=feedback.advance(schema,pc,decoded,state,coefA,coefB);
      }
      // A prior-row-less decoder may get PC1, but is wrong at PC2.
      const wrong=get(2,1)-feedback.mask(schema,2,1,
        feedback.initialState(schema,opSeed),coefA,coefB);
      if((wrong+MOD)%MOD!==rows[1][0])observedStatelessFailure++;
      const changed=rows[0].slice();
      changed[0]=(changed[0]+1)%MOD;
      const alternate=feedback.advance(schema,1,changed,
        feedback.initialState(schema,opSeed),coefA,coefB);
      if(feedback.mask(schema,2,1,alternate,coefA,coefB)!==
         feedback.mask(schema,2,1,cellMask[1],coefA,coefB))
        observedPropagation++;
    }
  }
}
assert.ok(observedStatelessFailure>=150,
  'Earlier stateless decoder should fail on PC2');
assert.ok(observedPropagation>=150,'Previous PC must influence later row masks');
const source='local function add(x,y)return x+y end;print(add(18,24))';
const options={hardened:true,target:'LuaU',protectionLevel:'Maximum',
  vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone'};
const built=compile(source,options);
assert.equal(built.chainedInstructionEncoding,true);
assert.ok(built.chainedPrototypeCount>=2);
assert.equal(built.chainedEncodedCells,built.vmInstructions*4);
assert.equal(built.vmInterpreterCount,7);
assert.equal(built.autoFunctionEncryption,'standalone');
const another=compile(source,options);
assert.notEqual(built.code,another.code,'Build-specific chain schema and emitted runtime');
for(const variant of [
  {...options,autoFunctionEncryption:'off'},
  {...options,autoFunctionEncryption:'external-full'},
  {...options,protectionLevel:'Strong'}
]){
  const result=compile(source,variant);
  assert.equal(result.chainedInstructionEncoding,false,
    'Only Maximum standalone uses PC feedback; external formats remain compatible');
}
console.log('BLACKMAMER V4 chained cells: 160 AoS/SoA round-trips, tamper propagation, Maximum standalone compiler PASS');
