'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const {preprocess}=require('../prometheus-stage');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-double-perf-'));
function run(binary,code,label,timeout=12000){
  const file=path.join(dir,label+'.lua');fs.writeFileSync(file,code);
  const started=Date.now(),r=spawnSync(binary,[file],{
    encoding:'utf8',timeout,maxBuffer:256*1024});
  return {ms:Date.now()-started,status:r.status,signal:r.signal,
    message:String(r.stderr||r.error?.message||'').slice(0,280),
    stdout:r.stdout?.slice(0,200)};
}
(async()=>{
 const src='local function f(n) local s=0 for i=1,n do s=s+i end return s end print(f(7))';
 for(const [target,binary] of [
  ['LuaU',process.env.LUAU_BIN],
  ['LuaJIT',process.env.LUAJIT_BIN||'luajit'],
  ['Lua51',process.env.LUA51_BIN||'lua5.1']
 ]){
  if(!binary)continue;
  const p=spawnSync(binary,['-v'],{encoding:'utf8'});
  if(p.error?.code==='ENOENT'){console.log('PERF_SKIP',target);continue}
  const stage=await preprocess(src,target);
  const baseline=run(binary,src,target+'-plain',3000);
  const inner=run(binary,stage.source,target+'-prometheus',3000);
  for(const antiDebug of [false,true]){
   const v4=compile(stage.source,{hardened:true,target,protectionLevel:'Maximum',
     vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone',
     antiTamper:true,antiDebug,doubleVmOptimized:true});
   const outer=run(binary,v4.code,target+'-double-'+antiDebug);
   console.log('PERF',JSON.stringify({target,antiDebug,
     innerBytes:stage.meta.outputBytes,outerBytes:Buffer.byteLength(v4.code),
     baseline,inner,outer}));
  }
 }
})().catch(e=>{console.error(e.stack||e);process.exitCode=1})
 .finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
