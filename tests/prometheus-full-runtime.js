'use strict';
// Exact behavior parity: all seven Prometheus steps -> outer BLACKMAMER Maximum.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const {preprocess,FULL_STEPS,FULL_PROFILE}=require('../prometheus-stage');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-full-runtime-'));
const runtimes=[];
if(process.env.LUAU_BIN)runtimes.push(['LuaU',process.env.LUAU_BIN]);
else runtimes.push(['Lua51',process.env.LUA51_BIN||'lua5.1']);
if(process.env.FULL_TEST_LUAJIT==='1')runtimes.push(['LuaJIT',process.env.LUAJIT_BIN||'luajit']);
const programs=[
 ['basic','local function f(n)local s=0;for i=1,n do s=s+i end;return s end;print("sum",f(7))'],
 ['closures','local function f(x)return function(y)return x+y end end;print(f(11)(31))'],
 ['multiple','local function f()return 6,nil,8 end;local a,b,c=f();print(a,b==nil,c)']
];
function run(bin,code,tag,timeoutMs){
 const file=path.join(dir,tag+'.lua');fs.writeFileSync(file,code);
 const start=Date.now();
 const result=spawnSync(bin,[file],{encoding:'utf8',timeout:timeoutMs,maxBuffer:1024*1024});
 return {status:result.status,stdout:result.stdout,stderr:result.stderr,
   signal:result.signal,error:result.error?.message,
   ms:Date.now()-start};
}
async function main(){
 let checks=0;
 for(const [target,bin] of runtimes){
  for(const [name,source] of programs){
   const expected=run(bin,source,target+'-'+name+'-original',5000);
   assert.equal(expected.status,0,JSON.stringify(expected));
   const inner=await preprocess(source,target,{profile:'full'});
   assert.equal(inner.meta.preset,FULL_PROFILE);
   assert.equal(inner.meta.allPrometheusSteps,true);
   assert.deepEqual(inner.meta.steps,FULL_STEPS);
   const intermediate=run(bin,inner.source,target+'-'+name+'-prometheus',10000);
   console.log('PROMETHEUS_FULL_INNER',JSON.stringify({
     target,name,status:intermediate.status,signal:intermediate.signal,
     actual:intermediate.stdout?.trim(),error:intermediate.stderr?.slice(0,500),
     runtimeMs:intermediate.ms
   }));
   assert.equal(intermediate.status,0,'Prometheus Full stage alone failed');
   assert.equal(intermediate.stdout,expected.stdout,'Prometheus Full stage changed stdout');
   let transformed;
   try{
     transformed=compile(inner.source,{
       hardened:true,target,protectionLevel:'Maximum',
       vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone',
       doubleVmFull:true,doubleVmOptimized:true,antiTamper:true,antiDebug:true,
       debugRuntimeErrors:true
     });
   }catch(e){
     const m=/ at ([0-9]+)/.exec(String(e.message));
     const offset=m?Number(m[1]):-1;
     console.error('PROMETHEUS_FULL_COMPILE_CONTEXT',JSON.stringify({
       target,name,offset,
       around:inner.source.slice(Math.max(0,offset-130),offset+160),
       first:inner.source.slice(0,550)
     }));
     throw e;
   }
   assert.equal(transformed.chainedInstructionEncoding,true);
   assert.equal(transformed.vmInterpreterCount,7);
   const size=Buffer.byteLength(transformed.code);
   const result=run(bin,transformed.code,target+'-'+name+'-full',25000);
   console.log('PROMETHEUS_FULL_RUN',JSON.stringify({
     target,name,original:expected.stdout?.trim(),actual:result.stdout?.trim(),
     status:result.status,error:result.error,signal:result.signal,
     runtimeMs:result.ms,innerBytes:inner.meta.outputBytes,outerBytes:size,
     instructions:transformed.vmInstructions
   }));
   assert.equal(result.status,0,'Full stack failed to execute '+target+'/'+name+': '+
     String(result.stderr||result.error).slice(0,600));
   assert.equal(result.stdout,expected.stdout,'Full stack changed stdout '+target+'/'+name);
   checks++;
  }
 }
 console.log('PROMETHEUS_FULL_PARITY_PASS',checks);
}
main().catch(e=>{console.error('PROMETHEUS_FULL_PARITY_FAIL',e.stack||e);process.exitCode=1})
  .finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
