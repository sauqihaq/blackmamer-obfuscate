'use strict';
// BLACKMAMER V4 Maximum: five independent, bytecode-driven micro-interpreters.
// Existing language VM + existing outer decoder VM + these 5 = 7 interpreters.
// These stages actually decode successive opcode-encryption layers. They are
// neither full additional Lua language VMs nor a guarantee of anti-tracing.
const crypto=require('node:crypto');
const modes=['xor','add','rol','xor','add'];
function keyFor(stage,pc,opSeed){
 const n=stage.index;
 return (stage.seed+opSeed*(13+17*n)+pc*(29+11*n)+
   ((pc*pc)%251)*(7+n))%256;
}
function rol8(v,n){return ((v<<n)|(v>>(8-n)))&255;}
function ror8(v,n){return ((v>>>n)|(v<<(8-n)))&255;}
function buildLayers(rand){
 const names=['KEY','BRANCH','MIX','JUMP','MIX_ALT','CHECK','HALT'];
 return modes.map((mode,index)=>{
  const opcodes={};const used=new Set();
  for(const name of names){
   let op;do{op=27+rand(200)}while(used.has(op));
   used.add(op);opcodes[name]=op;
  }
  const seed=1000+rand(60000);
  const rows=[
   ['KEY',0],['BRANCH',5],['MIX',0],
   ['JUMP',6],['MIX_ALT',0],['CHECK',0],['HALT',0]
  ];
  const bytes=[rows.length];
  rows.forEach(([name,arg],pos)=>{
   const p=pos+1;
   bytes.push(opcodes[name]^((seed+p*53)%256));
   bytes.push(arg^((seed*3+p*17)%256));
  });
  return {index,mode,seed,opcodes,bytes};
 });
}
function encodeOpcode(value,pc,opSeed,layers){
 for(const stage of layers){
  const k=keyFor(stage,pc,opSeed);
  if(stage.mode==='xor')value^=k;
  else if(stage.mode==='add')value=(value+k)%256;
  else value=rol8(value,k%7+1);
 }
 return value;
}
function decodeOpcode(value,pc,opSeed,layers){
 for(let i=layers.length-1;i>=0;i--){
  const stage=layers[i],k=keyFor(stage,pc,opSeed);
  if(stage.mode==='xor')value^=k;
  else if(stage.mode==='add')value=(value-k+256)%256;
  else value=ror8(value,k%7+1);
 }
 return value;
}
function luaMicroDecoder(){
 return [
  '  local MICRO={}',
  '  for index,bundle in ipairs(V)do',
  '    local seed=bxor(bundle[1],(SALT+(4+3)*7919+index*1543)%65536)',
  '    local bytes=unseal(bundle[2],seed)',
  '    local count=bytes[1]',
  '    if count~=7 or #bytes~=1+2*count then nativeError("BLACKMAMER V4 invalid layer bytecode")end',
  '    local program={}',
  '    for pc=1,count do',
  '      local at=2+(pc-1)*2',
  '      program[pc]={bxor(bytes[at],(seed+pc*53)%256),',
  '        bxor(bytes[at+1],(seed*3+pc*17)%256)}',
  '    end',
  '    MICRO[index]={program,seed}',
  '  end',
  '  V=nil'
 ];
}
function luaStageRuntime(stages){
 const result=[];
 for(const stage of stages){
  const index=stage.index,ids=stage.opcodes,vm='_vm'+(3+index);
  const k='(layerSeed+opseed*'+(13+17*index)+
   '+pc*'+(29+11*index)+'+((pc*pc)%251)*'+(7+index)+')%256';
  let mix,mixAlt;
  if(stage.mode==='xor'){
   mix='r[1]=bxor(r[1],r[2])';
   mixAlt='r[1]=bxor(r[2],r[1])';
  }else if(stage.mode==='add'){
   mix='r[1]=(r[1]-r[2])%256';
   mixAlt='r[1]=(r[1]+256-r[2])%256';
  }else{
   mix='local shift=r[2]%7+1;local divider=2^shift;'+
       'r[1]=(math.floor(r[1]/divider)+(r[1]%divider)*(256/divider))%256';
   mixAlt='local shift=r[2]%7+1;'+
     'r[1]=((r[1]%(2^shift))*(2^(8-shift))+math.floor(r[1]/(2^shift)))%256';
  }
  result.push(
   '  local function '+vm+'(v,pc,opseed)',
   '    local section=MICRO['+(index+1)+']',
   '    local code=section[1];local layerSeed=section[2]',
   '    local ip=1;local steps=0;local r={v,0}',
   '    while true do',
   '      steps=steps+1;if steps>12 then nativeError("BLACKMAMER V4 layer budget exceeded")end',
   '      local ins=code[ip];if not ins then nativeError("BLACKMAMER V4 missing micro instruction")end',
   '      local opcode=ins[1];local arg=ins[2];local nextip=ip+1',
   '      if opcode=='+ids.KEY+' then r[2]='+k,
   '      elseif opcode=='+ids.BRANCH+' then',
   '        if ((pc+opseed+layerSeed)%2)==0 then nextip=arg end',
   '      elseif opcode=='+ids.MIX+' then '+mix,
   '      elseif opcode=='+ids.JUMP+' then nextip=arg',
   '      elseif opcode=='+ids.MIX_ALT+' then '+mixAlt,
   '      elseif opcode=='+ids.CHECK+' then',
   '        if r[1]<0 or r[1]>255 or r[1]%1~=0 then nativeError("BLACKMAMER V4 invalid micro value")end',
   '      elseif opcode=='+ids.HALT+' then return r[1]',
   '      else nativeError("BLACKMAMER V4 invalid micro opcode")end',
   '      ip=nextip',
   '    end',
   '  end'
  );
 }
 return result;
}
function luaStageCalls(){
 return Array.from({length:5},(_,i)=>
  '      op=_vm'+(7-i)+'(op,pc,spec[3])');
}
function fingerprints(layers){
 return layers.map(stage=>crypto.createHash('sha256')
  .update(Buffer.from(stage.bytes)).digest('hex'));
}
module.exports={buildLayers,encodeOpcode,decodeOpcode,
 luaMicroDecoder,luaStageRuntime,luaStageCalls,fingerprints,keyFor};
