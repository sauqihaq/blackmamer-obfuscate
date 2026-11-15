'use strict';
// Compare the SAME full 11-step preset under Lua 5.1 and LuaJIT. Never reduce
// the protection stack or execute customer-supplied input in CI.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {preprocess,FULL_STEPS}=require('../prometheus-stage');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-prom-compiler-perf-'));
const fixtures=[
  ['basic','local function f(n)local total=0 for i=1,n do total=total+i end return total end print("sum",f(12))'],
  ['closures','local function outer(x)return function(y)return x+y end end local a=outer(13) print("closure",a(29))']
];
function execute(source,name){
  const file=path.join(dir,name+'.lua');
  fs.writeFileSync(file,source,{mode:0o600});
  const result=spawnSync('lua5.1',[file],{encoding:'utf8',timeout:10000,maxBuffer:128*1024});
  if(result.status!==0)throw Error(name+': '+String(result.stderr||result.error?.message||result.signal));
  return result.stdout;
}
async function main(){
  for(const [label,source] of fixtures){
    const expected=execute(source,'expected-'+label);
    const results={};
    for(const runner of ['lua5.1','luajit']){
      const started=Date.now();
      const {source:protectedSource,meta}=await preprocess(source,'Lua51',{
        profile:'full',timeoutMs:70000,luaBinary:runner
      });
      assert.equal(meta.allPrometheusSteps,true);
      assert.deepEqual(meta.steps,FULL_STEPS);
      assert.equal(meta.steps.length,11);
      const actual=execute(protectedSource,'protected-'+runner+'-'+label);
      assert.equal(actual,expected,runner+' changed program behavior in '+label);
      results[runner]={elapsedMs:Date.now()-started,outputBytes:meta.outputBytes};
    }
    console.log('BLACKMAMER_FULL_COMPILER_BENCHMARK',JSON.stringify({
      fixture:label,fullSteps:11,results,
      luaJitSpeedup:Number((results['lua5.1'].elapsedMs/results.luajit.elapsedMs).toFixed(2))
    }));
  }
  console.log('BLACKMAMER_FULL_COMPILER_PARITY_PASS');
}
main().catch(error=>{console.error('BLACKMAMER_FULL_COMPILER_PARITY_FAIL',error.stack||error);process.exitCode=1})
  .finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
