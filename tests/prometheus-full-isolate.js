'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const root=path.resolve(__dirname,'..'),home=path.join(root,'vendor','prometheus');
const base=fs.readFileSync(path.join(root,'prometheus-maximal.lua'),'utf8');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-full-isolate-'));
const source='local function f(x)return function(y)return x+y end end;print(f(11)(31))';
function omitStep(source,name){
 const start=source.indexOf('    { Name = "'+name+'"');
 if(start<0)throw Error('Missing step '+name);
 const next=source.indexOf('\n    { Name = "',start+1);
 const end=next<0?source.indexOf('\n  }\n}',start):next;
 if(end<start)throw Error('Malformed config '+name);
 return source.slice(0,start)+source.slice(end);
}
function execScript(script,tag,timeout=25000){
 const p=path.join(dir,tag+'.lua');fs.writeFileSync(p,script);
 const t=Date.now(),res=spawnSync('lua5.1',[p],{encoding:'utf8',timeout});
 return {status:res.status,stdout:res.stdout?.trim(),stderr:res.stderr?.slice(0,220),
   elapsed:Date.now()-t,error:res.error?.message};
}
for(const removed of ['none','SplitStrings','ProxifyLocals','AddVararg','WatermarkCheck']){
 const cfg=path.join(dir,'cfg.lua'),inp=path.join(dir,'input.lua'),out=path.join(dir,'output.lua');
 fs.writeFileSync(cfg,removed==='none'?base:omitStep(base,removed));fs.writeFileSync(inp,source);
 const p=spawnSync('lua5.1',['cli.lua','--config',cfg,'--Lua51','--nocolors',
   '--out',out,inp],{cwd:home,encoding:'utf8',timeout:35000});
 if(p.status!==0){
   console.log('ISOLATE',removed,'PROMETHEUS_FAILED',String(p.stderr||p.error).slice(-500));continue;
 }
 const content=fs.readFileSync(out,'utf8'),bytes=Buffer.byteLength(content);
 if(bytes>128*1024){console.log('ISOLATE',removed,'TOO_LARGE',bytes);continue}
 const inner=execScript(content,'inner-'+removed,3000);
 try{
  const build=compile(content,{hardened:true,target:'Lua51',protectionLevel:'Maximum',
   vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone',
   doubleVmFull:true,doubleVmOptimized:true,antiDebug:true,antiTamper:true,
   debugRuntimeErrors:true});
  const result=execScript(build.code,'outer-'+removed,25000);
  console.log('ISOLATE',removed,JSON.stringify({bytes,outerBytes:Buffer.byteLength(build.code),
    instructions:build.vmInstructions,inner,outer:result}));
 }catch(e){console.log('ISOLATE',removed,'COMPILE_ERROR',String(e.message).slice(0,500))}
}
fs.rmSync(dir,{recursive:true,force:true});
