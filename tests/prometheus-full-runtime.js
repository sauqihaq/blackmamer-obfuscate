'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compileFull,MAX_ATTEMPTS}=require('../full-prometheus-pipeline');
const {FULL_STEPS,FULL_PROFILE}=require('../prometheus-stage');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-full-runtime-'));
const runtimes=process.env.LUAU_BIN?[['LuaU',process.env.LUAU_BIN]]:
  [['Lua51',process.env.LUA51_BIN||'lua5.1']];
if(process.env.FULL_TEST_LUAJIT==='1')
  runtimes.push(['LuaJIT',process.env.LUAJIT_BIN||'luajit']);
const programs=[
 ['basic','local function f(n)local s=0;for i=1,n do s=s+i end;return s end;print("sum",f(7))'],
 ['closures','local function f(x)return function(y)return x+y end end;print(f(11)(31))'],
 ['multiple','local function f()return 6,nil,8 end;local a,b,c=f();print(a,b==nil,c)']
];
function run(bin,code,tag,timeoutMs){
 const file=path.join(dir,tag+'.lua');fs.writeFileSync(file,code);
 const start=Date.now();
 const r=spawnSync(bin,[file],{encoding:'utf8',timeout:timeoutMs,maxBuffer:1024*1024});
 return {status:r.status,stdout:r.stdout,stderr:r.stderr,
   signal:r.signal,error:r.error?.message,ms:Date.now()-start};
}
async function main(){
 let checks=0;
 for(const [target,bin] of runtimes){
  for(const [name,source] of programs){
   const expected=run(bin,source,target+'-'+name+'-original',5000);
   assert.equal(expected.status,0,JSON.stringify(expected));
   const {stage,result,attempts}=await compileFull(source,target,{
     antiTamper:true,antiDebug:true,debugRuntimeErrors:true
   });
   assert.equal(stage.meta.preset,FULL_PROFILE);
   assert.equal(stage.meta.allPrometheusSteps,true);
   assert.deepEqual(stage.meta.steps,FULL_STEPS);
   assert.equal(stage.meta.steps.length,11);
   assert.ok(attempts>=1&&attempts<=MAX_ATTEMPTS);
   const intermediate=run(bin,stage.source,target+'-'+name+'-inner',10000);
   console.log('PROMETHEUS_FULL_INNER',JSON.stringify({
     target,name,status:intermediate.status,signal:intermediate.signal,
     actual:intermediate.stdout?.trim(),error:intermediate.stderr?.slice(0,300),
     runtimeMs:intermediate.ms,attempts
   }));
   assert.equal(intermediate.status,0,'Inner 11-step Prometheus execution failure');
   assert.equal(intermediate.stdout,expected.stdout,'Inner Prometheus changed stdout');
   assert.equal(result.chainedInstructionEncoding,true);
   assert.equal(result.vmInterpreterCount,7);
   const size=Buffer.byteLength(result.code);
   const outcome=run(bin,result.code,target+'-'+name+'-full',25000);
   console.log('PROMETHEUS_FULL_RUN',JSON.stringify({
     target,name,original:expected.stdout?.trim(),actual:outcome.stdout?.trim(),
     status:outcome.status,error:outcome.error,signal:outcome.signal,
     runtimeMs:outcome.ms,innerBytes:stage.meta.outputBytes,outerBytes:size,
     attempts,instructions:result.vmInstructions
   }));
   assert.equal(outcome.status,0,'Full stack failed '+target+'/'+name+': '+
     String(outcome.stderr||outcome.error).slice(0,500));
   assert.equal(outcome.stdout,expected.stdout,'Full stack changed stdout '+target+'/'+name);
   checks++;
  }
 }
 console.log('PROMETHEUS_FULL_PARITY_PASS',checks);
}
main().catch(e=>{console.error('PROMETHEUS_FULL_PARITY_FAIL',e.stack||e);process.exitCode=1})
 .finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
