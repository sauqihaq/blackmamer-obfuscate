'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {sealBatch,available}=require('../native-sealer');
function jsSeal(bytes,seed,sbox){
  let state=seed,prev=0;
  return bytes.map((plain,i)=>{
    const j=i+1;state=(state*73+41+(j%251))%65521;
    const mask=(state%256)^((state>>>8)%256);
    const value=(sbox[plain]^mask^prev)&255; prev=value;return value;
  });
}
const sbox=Array.from({length:256},(_,i)=>i).reverse();
for(let i=0;i<100;i++){
  const chunks=Array.from({length:i%9},()=>[crypto.randomInt(65536),
    Array.from(crypto.randomBytes(crypto.randomInt(0,2000)))]);
  const output=sealBatch(chunks,sbox,(bytes,seed)=>jsSeal(bytes,seed,sbox));
  assert.equal(output.nativeUsed,available());
  assert.deepEqual(output.sealed,chunks.map(([seed,bytes])=>jsSeal(bytes,seed,sbox)));
}
console.log('Native sealer: 100 randomized parity cases passed ('+(available()?'C++':'JS fallback')+')');
