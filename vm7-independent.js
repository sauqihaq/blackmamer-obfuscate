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
  const guard='_g'+variant.index;
  const replacement=[
   '      op=((op-'+variant.add+'+256)*'+variant.inverse+')%256',
   '      local '+guard+'=false'
  ];
  const shuffled=shuffle(handlers,rand);
  shuffled.forEach((block,i)=>{
   const match=/^\s*(?:if|elseif) op==O\.([A-Z]+) then(.*)$/.exec(block[0]);
   if(!match)throw new Error('Malformed opcode handler definition');
   replacement.push('      '+(i?'elseif':'if')+' op==O.'+match[1]+
     ' then '+guard+'=true;'+match[2]);
   replacement.push(...block.slice(1));
  });
  replacement.push('      end',
   '      if not '+guard+' then nativeError("BLACKMAMER invalid opcode")end');
  let engineBody=body.slice();
  // This engine receives the already decoded prototype selected by the
  // lightweight entry router, including sealed ISA variant identifier.
  const specIndex=engineBody.findIndex(x=>x==='    local spec=prototype(fid)');
  if(specIndex<0)throw new Error('Prototype fetch statement missing in engine template');
  engineBody[specIndex]='    spec=spec or prototype(fid)';
  engineBody.splice(markerStart,markerEnd-markerStart+1,...replacement);
  all.push('  local function '+vmName+'(fid,passed,captured,spec)',...engineBody,'  end');
 }
 const router=[
  '  exec=function(fid,passed,captured)',
  '    local spec=prototype(fid)',
  '    local variant=spec[10]',
  '    if variant==1 then return execVM1(fid,passed,captured,spec)',
  ...variants.slice(1).map(v=>
   '    elseif variant=='+v.index+' then return execVM'+v.index+'(fid,passed,captured,spec)'),
  '    else nativeError("BLACKMAMER invalid virtual machine")end',
  '  end'
 ];
 lines.splice(start,end-start+1,...all,...router);
 return {variantCount:variants.length,handlerCount:handlers.length};
}
module.exports={buildIndependentVmLines};
