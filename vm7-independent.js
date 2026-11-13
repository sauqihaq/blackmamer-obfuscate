'use strict';
// Compile seven independently selectable FULL Lua bytecode interpreters.
// A prototype runs on exactly ONE engine; no stacked inner/outer decoders.
// Each engine has its own PC loop, call frames, register state, dispatcher,
// per-engine affine opcode ISA, and an independently shuffled opcode handler
// ordering. This is a family of engines, not 7 nested runtime layers.
const crypto=require('node:crypto');
const shuffle=(items,rand)=>{
 const out=items.slice();
 for(let i=out.length-1;i>0;i--){
  const j=rand(i+1);[out[i],out[j]]=[out[j],out[i]];
 }
 return out;
};
function buildIndependentVmLines(lines,variants,rand){
 if(variants.length!==7)throw new Error('Exactly seven independent VM engine descriptors required');
 const start=lines.findIndex(line=>line==='  exec=function(fid,passed,captured)');
 const returnIndex=lines.findIndex(line=>/^\s*return exec\(/.test(line));
 const end=returnIndex-1;
 if(start<0||returnIndex<start||lines[end]!=='  end')
  throw new Error('Missing or malformed source VM interpreter template');
 const body=lines.slice(start+1,end);
 const markerStart=body.findIndex(line=>/^\s*if op==O\./.test(line));
 const markerEnd=body.findIndex(line=>line.includes('else nativeError("BLACKMAMER V3 invalid opcode") end'));
 if(markerStart<0||markerEnd<markerStart)
  throw new Error('VM handler template not recognized');
 const handlers=[];let block=null;
 for(let i=markerStart;i<markerEnd;i++){
  const line=body[i];
  if(/^\s*(?:if|elseif) op==O\./.test(line)){
   if(block)handlers.push(block);
   block=[line];
  }else{
   if(!block)throw new Error('Orphan handler statement');
   block.push(line);
  }
 }
 if(block)handlers.push(block);
 if(handlers.length<35)throw new Error('Incomplete Lua opcode handler table');
 const all=[];
 const dispatchFingerprints=[];
 for(const variant of variants){
  const vmName='execVM'+variant.index;
  // Each engine gets unrelated route labels and short-lived route variables.
  const guard='_g'+variant.index+'_'+rand(1000000000).toString(36);
  const route='_r'+variant.index+'_'+rand(1000000000).toString(36);
  const state='_q'+variant.index+'_'+rand(1000000000).toString(36);
  // Metadata ends at spec[10]. Each engine chooses a distinct hidden cache
  // slot; a prototype only ever runs on its selected engine.
  const routeCacheSlot=11+rand(29);
  const usedStates=new Set();
  const allocState=()=>{let value;do{value=1000+rand(62000);}while(usedStates.has(value));
    usedStates.add(value);return value;};
  const initialState=allocState();
  const states=Array.from({length:variant.index+1},allocState);
  const decoys=Array.from({length:1+rand(3)},allocState);
  // A cloned elseif dispatcher is trivial to normalize. Each *independent*
  // interpreter therefore uses its own control-flow topology (2..8 handler
  // families) with a VM-local, sealed-palette-derived opcode route.
  // All families have full Lua instruction semantics, not micro-decoders.
  const familyCount=variant.index+1;
  const shuffled=shuffle(handlers,rand);
  const buckets=Array.from({length:familyCount},()=>[]);
  const routeEntries=[];
  shuffled.forEach((block,i)=>{
   const match=/^\s*(?:if|elseif) op==O\.([A-Z]+) then(.*)$/.exec(block[0]);
   if(!match)throw new Error('Malformed opcode handler definition');
   const bucket=(i%familyCount);
   buckets[bucket].push(block);
   routeEntries.push('[O.'+match[1]+']='+states[bucket]);
  });
  // Hash the actual per-family opcode handler membership AND ordering,
  // ignoring generated identifiers/state numbers. A changed fingerprint
  // therefore means the logical dispatch topology changed, not just names.
  const topology=buckets.map(bucket=>bucket.map(block=>{
    const hit=/^\s*(?:if|elseif) op==O\.([A-Z]+) then/.exec(block[0]);
    if(!hit)throw new Error('Missing handler identity for topology audit');
    return hit[1];
  }).join(',')).join('|');
  dispatchFingerprints.push(crypto.createHash('sha256').update(topology).digest('hex'));
  // A small table-based route resolver and a per-engine state machine
  // replace the stable nested elseif opcode tree. The first transition
  // resolves the op through the executing prototype's shuffled palette;
  // the second transition executes the one matching instruction family.
  // These are real VM control-flow states, not cosmetic source mangling.
  const replacement=[
   '      op=((op-'+variant.add+'+256)*'+variant.inverse+')%256',
   '      local '+guard+'=false',
   '      local '+state+'='+initialState,
   '      while '+state+'~=0 do',
   '        if '+state+'=='+initialState+' then '+state+'='+route+'[op]'
  ];
  for(let bucket=0;bucket<buckets.length;bucket++){
   replacement.push('        elseif '+state+'=='+states[bucket]+' then');
   replacement.push('          '+state+'=0');
   buckets[bucket].forEach((block,i)=>{
    const match=/^\s*(?:if|elseif) op==O\.([A-Z]+) then(.*)$/.exec(block[0]);
    replacement.push('          '+(i?'elseif':'if')+' op==O.'+match[1]+
      ' then '+guard+'=true;'+match[2]);
    replacement.push(...block.slice(1));
   });
   replacement.push('          end');
  }
  for(const decoy of decoys)
   replacement.push('        elseif '+state+'=='+decoy+' then '+state+'=0');
  replacement.push(
   '        else nativeError("BLACKMAMER invalid machine state")end',
   '      end',
   '      if not '+guard+' then nativeError("BLACKMAMER invalid opcode")end'
  );
  const engineBody=body.slice();
  const specIndex=engineBody.findIndex(x=>x==='    local spec=prototype(fid)');
  if(specIndex<0)throw new Error('Prototype fetch statement missing in engine template');
  engineBody[specIndex]='    spec=spec or prototype(fid)';
  // Build the route map once per SEALED prototype, not on every call of
  // that function. Its keys are still derived from spec[8]'s unique opcode
  // palette, and each engine keeps its independently randomized topology.
  // Use __index only on invalid opcodes; valid instructions take a direct
  // table lookup instead of invoking Lua's __call metamethod per tick.
  const routeInit=[
    '    local '+route+'=spec['+routeCacheSlot+']',
    '    if not '+route+' then',
    '      '+route+'=setmetatable({'+routeEntries.join(',')+
      '},{__index=function()return 0 end})',
    '      spec['+routeCacheSlot+']='+route,
    '    end'
  ];
  engineBody.splice(specIndex+1,0,...routeInit);
  // The new route-init statements precede the original opcode dispatcher.
  engineBody.splice(markerStart+routeInit.length,markerEnd-markerStart+1,...replacement);
  all.push('  local function '+vmName+'(fid,passed,captured,spec)',...engineBody,'  end');
 }
 // Encoded per-build engine routing via a function table. One selected
 // engine handles the entire prototype, just as before.
 const engineRoute='_v'+rand(1000000000).toString(36);
 const mul=1+rand(255),add=rand(257);
 const engineEntries=variants.map(v=>
  '['+((v.index*mul+add)%257)+']=execVM'+v.index).join(',');
 const router=[
  '  local '+engineRoute+'=setmetatable({'+engineEntries+
    '},{__index=function()nativeError("BLACKMAMER invalid virtual machine")end})',
  '  exec=function(fid,passed,captured)',
  '    local spec=prototype(fid)',
  '    local fn='+engineRoute+'[(spec[10]*'+mul+'+'+add+')%257]',
  '    return fn(fid,passed,captured,spec)',
  '  end'
 ];
 lines.splice(start,end-start+1,...all,...router);
 return {variantCount:variants.length,handlerCount:handlers.length,
   stateMachine:true,cachedRoutes:true,directTableDispatch:true,
   statesPerEngine:variants.map(v=>v.index+3),
   dispatchFingerprints};
}
module.exports={buildIndependentVmLines};
