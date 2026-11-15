'use strict';
// Test an actual multi-function source through *both* full Prometheus and
// BLACKMAMER Maximum V4, with constrained Node heap like Render Free.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compileFull}=require('../full-prometheus-pipeline');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-full-medium-'));
const target=process.env.BLACKMAMER_MEDIUM_TARGET==='LuaU'?'LuaU':'Lua51';
const runtime=target==='LuaU'?(process.env.LUAU_BIN||'luau'):'lua5.1';
const source=Array.from({length:12},(_,i)=>
  'local function f'+i+'(x) return x+'+i+' end').join('\n')+'\nprint("medium",f11(31))';
function execute(code,tag){
 const file=path.join(dir,tag+'.lua');
 fs.writeFileSync(file,code,{mode:0o600});
 const p=spawnSync(runtime,[file],{timeout:30000,maxBuffer:100000,encoding:'utf8'});
 if(p.status!==0)throw Error(tag+' failed: '+String(p.stderr||p.error?.message||p.signal).slice(0,300));
 return p.stdout;
}
async function main(){
 const expected=execute(source,'original');
 const started=Date.now();
 const full=await compileFull(source,target,{
   antiTamper:true,antiDebug:true,debugRuntimeErrors:true
 },1);
 assert.equal(full.stage.meta.allPrometheusSteps,true);
 assert.equal(full.stage.meta.steps.length,11);
 assert.equal(full.result.vmInterpreterCount,7);
 const got=execute(full.result.code,'protected');
 assert.equal(got,expected,'Full double-VM changed source behavior');
 console.log('BLACKMAMER_FULL_MEDIUM_PASS',JSON.stringify({
   target,sourceBytes:Buffer.byteLength(source),
   prometheusBytes:full.stage.meta.outputBytes,
   outerBytes:Buffer.byteLength(full.result.code),
   outerInstructions:full.result.vmInstructions,
   elapsedMs:Date.now()-started,
   runner:process.env.BLACKMAMER_PROMETHEUS_LUA||'lua5.1'
 }));
}
main().catch(err=>{console.error('BLACKMAMER_FULL_MEDIUM_FAIL',err.stack||err);
  if(err.cause)console.error('BLACKMAMER_FULL_MEDIUM_CAUSE',err.cause.code||err.cause.name,String(err.cause.message).slice(0,600));
  process.exitCode=1})
 .finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
