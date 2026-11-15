'use strict';
// Differential integration tests: real pinned Prometheus Vmify -> real
// BLACKMAMER Maximum standalone -> execution on target Lua interpreter.
// Run with LUAU_BIN=/path/to/luau to test Roblox Luau as well.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const {preprocess,available,PROMETHEUS_REVISION}=require('../prometheus-stage');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-double-runtime-'));
const lua=process.env.LUA51_BIN||'lua5.1';
const luajit=process.env.LUAJIT_BIN||'luajit';
const luau=process.env.LUAU_BIN;
const runtimes=[['Lua51',lua]];
if(process.env.DOUBLE_VM_TEST_LUAJIT==='1')runtimes.push(['LuaJIT',luajit]);
if(luau)runtimes.push(['LuaU',luau]);
const programs=[
 ['basic','local function sum(n)local s=0;for i=1,n do s=s+i end;return s end;print("sum",sum(7))'],
 ['closures','local function outer(a)return function(b)return a+b end end;print("closure",outer(11)(31))'],
 ['tables','local t={3,5,7};local s=0;for _,v in ipairs(t)do s=s+v end;print("table",s)'],
 ['multi','local function f()return 6,nil,8 end;local a,b,c=f();print(a,b==nil,c)'],
 ['varargs','local function count(...)return select("#",...) end;print(count(1,nil,3))']
];
function run(binary,source,tag){
 const file=path.join(dir,tag+'.lua');
 fs.writeFileSync(file,source);
 const result=spawnSync(binary,[file],{encoding:'utf8',timeout:28000,maxBuffer:1024*1024});
 if(result.error)throw Error(tag+': '+result.error.message);
 assert.equal(result.status,0,tag+': '+String(result.stderr).slice(-700));
 return result.stdout;
}
async function main(){
 assert.ok(available(),'Pinned Prometheus VM must be installed for double-VM regression');
 let count=0;
 for(const [target,binary] of runtimes){
  for(const [name,source] of programs){
   const expected=run(binary,source,target+'-'+name+'-plain');
   const stage=await preprocess(source,target);
   assert.equal(stage.meta.vm,true);
   assert.equal(stage.meta.revision,PROMETHEUS_REVISION);
   const compiled=compile(stage.source,{
      hardened:true,target,protectionLevel:'Maximum',
      vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone',
      doubleVmOptimized:true,antiTamper:true,antiDebug:true
   });
   assert.equal(compiled.vmInterpreterCount,7);
   assert.equal(compiled.chainedInstructionEncoding,true);
   assert.equal(compiled.doubleVmOptimized,true);
   assert.deepEqual(compiled.generatedKeys,[]);
   const begin=Date.now();
   const actual=run(binary,compiled.code,target+'-'+name+'-double');
   assert.equal(actual,expected,target+'/'+name+': double VM output mismatch');
   console.log('DOUBLE_VM_PASS',target,name,'inner',stage.meta.outputBytes,
     'outer',Buffer.byteLength(compiled.code),'runtimeMs',Date.now()-begin);
   count++;
  }
 }
 console.log('DOUBLE_VM_RUNTIME_SUCCESS',count);
}
main().catch(e=>{console.error('DOUBLE_VM_RUNTIME_FAILURE',e.stack||e);process.exitCode=1})
 .finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
