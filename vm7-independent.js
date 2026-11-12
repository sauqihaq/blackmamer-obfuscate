'use strict';
// Compile seven independently selectable FULL Lua bytecode interpreters.
// A prototype runs on exactly ONE engine; no stacked inner/outer decoders.
// Each engine has its own PC loop, call frames, register state, dispatcher,
// per-engine affine opcode ISA, and an independently shuffled opcode handler
// ordering. This is a family of engines, not 7 nested runtime layers.
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
 for(const variant of variants){
  const vmName='execVM'+variant.index;
  // Each engine gets unrelated route labels and short-lived route variables.
  const guard='_g'+variant.index+'_'+rand(1000000000).toString(36);
  const route='_r'+variant.index+'_'+rand(1000000000).toString(36);
  const state='_q'+variant.index+'_'+rand(1000000000).toString(36);
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
   '        if '+state+'=='+initialState+' then '+state+'='+route+'(op)'
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
  // Only the executing prototype's randomized palette keys this map.
  // It is computed once per function call, not on every VM instruction.
  engineBody.splice(specIndex+1,0,
    '    local '+route+'=setmetatable({'+routeEntries.join(',')+
      '},{__call=function(self,value)return self[value] or 0 end})');
  // Account for the new local statement when replacing the old dispatch.
  engineBody.splice(markerStart+1,markerEnd-markerStart+1,...replacement);
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
   stateMachine:true,statesPerEngine:variants.map(v=>v.index+3)};
}
module.exports={buildIndependentVmLines};
