'use strict';
// BLACKMAMER VM V4: graph-safe IR optimizer and non-executing bytecode mosaic.
// This transforms BLACKMAMER's own 4-cell VM instruction rows, not Lua text.
// All real jump targets are relocated after optimizations/padding; padding is
// placed ONLY after unconditional control-flow barriers to avoid hot-path cost.
const crypto=require('node:crypto');
const rand=max=>crypto.randomInt(max);
const RETURN_NAMES=['RET','RETM','RETVOID','KRET','GETRET','MOVRET'];
function optimizer(rows,codes){
 if(!Array.isArray(rows)||rows.length===0)return {rows,removed:0};
 const len=rows.length,seen=new Uint8Array(len+1),pending=[1];
 const terminal=new Set(RETURN_NAMES.map(name=>codes[name]));
 while(pending.length){
  const pc=pending.pop();
  if(pc===len+1)continue;
  if(!Number.isInteger(pc)||pc<1||pc>len)
   return {rows,removed:0}; // preserve original for unsupported CFG edges
  if(seen[pc])continue;
  seen[pc]=1;
  const row=rows[pc-1],op=row[0];
  if(terminal.has(op))continue;
  if(op===codes.JUMP)pending.push(row[1]);
  else if(op===codes.JF||op===codes.JT)pending.push(pc+1,row[2]);
  else pending.push(pc+1);
 }
 const kept=[],locations=new Map();
 for(let pc=1;pc<=len;pc++){
  if(seen[pc]){locations.set(pc,kept.length+1);kept.push(rows[pc-1].slice());}
 }
 if(kept.length===len)return {rows,removed:0};
 const output=kept.map(row=>{
  if(row[0]===codes.JUMP){
   const target=locations.get(row[1]);
   if(!target)return null;
   row[1]=target;
  }else if(row[0]===codes.JF||row[0]===codes.JT){
   const target=locations.get(row[2]);
   if(!target)return null;
   row[2]=target;
  }
  return row;
 });
 if(output.includes(null))return {rows,removed:0};
 return {rows:output,removed:len-output.length};
}
function dummyRows(count,codes,constantCount){
 const result=[];
 const key=()=>1+rand(Math.max(1,constantCount));
 const reg=()=>1+rand(1800);
 // Only syntactically valid VM instructions. None of these rows are reached.
 // Branch operands are resolved to positions inside the same dummy block.
 for(let i=0;i<count;i++){
  const roll=rand(15),a=reg(),b=reg(),c=reg();
  let row,target=null;
  switch(roll){
   case 0: row=[codes.K,a,key(),0];break;
   case 1: row=[codes.GET,a,key(),0];break;
   case 2: row=[codes.SET,key(),a,0];break;
   case 3: row=[codes.TABLE,a,0,0];break;
   case 4: row=[codes.ADD,a,b,c];break;
   case 5: row=[codes.SUB,a,b,c];break;
   case 6: row=[codes.MUL,a,b,c];break;
   case 7: row=[codes.CAT,a,b,c];break;
   case 8: row=[codes.MOV,a,b,0];break;
   case 9: row=[codes.EQ,a,b,c];break;
   case 10: row=[codes.JUMP,0,0,0];target=1+rand(count);break;
   case 11: row=[codes.JF,a,0,0];target=1+rand(count);break;
   case 12: row=[codes.JT,a,0,0];target=1+rand(count);break;
   case 13: row=[codes.RET,a,0,0];break;
   default: row=[codes.K,a,key(),0];break;
  }
  result.push({row,target});
 }
 if(result.length)result[result.length-1]={row:[codes.RETVOID,0,0,0],target:null};
 return result;
}
function mosaic(rows,codes,constantCount,{density=2.5,budget=1024}={}){
 const len=rows.length;
 if(len<1||density<=0||budget<=0)return {rows,added:0,blocks:0};
 // Keep hard 12k instructions/prototype limit, and bound startup decode work.
 const desired=Math.max(16,Math.floor(len*density));
 const total=Math.min(desired,budget,1024,12000-len);
 if(total<1)return {rows,added:0,blocks:0};
 const terminal=new Set([...RETURN_NAMES.map(k=>codes[k]),codes.JUMP]);
 const candidates=[];
 for(let pc=1;pc<=len;pc++)if(terminal.has(rows[pc-1][0]))candidates.push(pc);
 if(!candidates.includes(len))candidates.push(len);
 // Spread decoy islands across real unconditional barriers when available.
 for(let i=candidates.length-1;i>0;i--){
  const j=rand(i+1);[candidates[i],candidates[j]]=[candidates[j],candidates[i]];
 }
 const selected=candidates.slice(0,Math.min(14,candidates.length,total));
 const shares=Array(selected.length).fill(1);
 for(let i=selected.length;i<total;i++)shares[rand(shares.length)]++;
 const inserts=new Map(selected.map((pc,i)=>[pc,dummyRows(shares[i],codes,constantCount)]));
 const result=[],mapping=Array(len+1).fill(0),patches=[];
 const decoyPositions=new Set();
 for(let pc=1;pc<=len;pc++){
  mapping[pc]=result.length+1;
  result.push(rows[pc-1].slice());
  if(!inserts.has(pc))continue;
  const slab=inserts.get(pc),start=result.length+1;
  for(let i=0;i<slab.length;i++){
   const newPC=result.length+1;
   decoyPositions.add(newPC);
   const row=slab[i].row.slice();
   result.push(row);
   if(slab[i].target!==null)patches.push({
    pc:newPC,op:row[0],target:start+slab[i].target-1
   });
  }
 }
 // True control flow is unchanged; conditional fallthrough always maps to the
 // next real row because padding follows an unconditional terminal barrier.
 for(let old=1;old<=len;old++){
  const row=result[mapping[old]-1];
  if(row[0]===codes.JUMP){
   if(!mapping[rows[old-1][1]])throw new Error('V4 decoy relocation: bad jump');
   row[1]=mapping[rows[old-1][1]];
  }else if(row[0]===codes.JF||row[0]===codes.JT){
   if(!mapping[rows[old-1][2]])throw new Error('V4 decoy relocation: bad conditional');
   row[2]=mapping[rows[old-1][2]];
  }
 }
 for(const p of patches){
  const row=result[p.pc-1];
  if(p.op===codes.JUMP)row[1]=p.target;
  else row[2]=p.target;
 }
 return {rows:result,added:total,blocks:selected.length,
  // Audit-only to verify unreachable decoys without exposing them in Lua.
  audit:{realPositions:[...mapping.slice(1)],decoyPositions:[...decoyPositions]}};
}
module.exports={optimizer,mosaic};
