'use strict';
// Differential regression: fifty small programs compared against unmodified
// Lua 5.1 output, not just compile-success or source-pattern assertions.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const {getPreset}=require('../v4-presets');
const bin=process.env.LUA51_BIN||'lua5.1';
const probe=spawnSync(bin,['-v'],{encoding:'utf8'});
if(probe.error&&probe.error.code==='ENOENT'&&!process.env.CI){
  console.log('SKIP: install Lua 5.1 or set LUA51_BIN to run differential-50');
  process.exit(0);
}
assert.equal(probe.status,0,'Lua 5.1 runtime missing: '+(probe.error?.message||probe.stderr));
const programs=[];
for(let i=1;i<=10;i++){
  programs.push(['arithmetic-'+i,
    'local a='+i+';local b='+(i+3)+';print(a+b,a*b,a-b,a%b,a^2)']);
  programs.push(['loop-'+i,
    'local n=0;for k=1,'+(i+3)+' do n=n+k end;local j=0;while j<'+i+' do n=n+j;j=j+1 end;print(n)']);
  programs.push(['closure-'+i,
    'local function make(x)return function(y)return x*y+'+i+' end end;print(make(3)(4))']);
  programs.push(['metatable-'+i,
    'local t=setmetatable({v='+i+'},{__index=function(_,k) if k=="bonus" then return '+(i*2)+' end end});print(t.v,t.bonus)']);
}
for(let i=1;i<=5;i++){
  programs.push(['coroutine-'+i,
    'local c=coroutine.create(function()coroutine.yield('+i+');return '+(i+1)+' end);local ok,a=coroutine.resume(c);print(ok,a);local ok2,b=coroutine.resume(c);print(ok2,b)']);
  programs.push(['oop-'+i,
    'local Counter={};Counter.__index=Counter;function Counter:new(v) return setmetatable({value=v},self) end;function Counter:add(n)self.value=self.value+n;return self.value end;local c=Counter:new('+i+');print(c:add(4),c:add(2))']);
}
assert.equal(programs.length,50);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-differential-'));
function run(source,name){
  const filename=path.join(dir,name+'.lua');
  fs.writeFileSync(filename,source,'utf8');
  const r=spawnSync(bin,[filename],{encoding:'utf8',timeout:15000,maxBuffer:1048576});
  if(r.error)throw r.error;
  assert.equal(r.status,0,name+': '+r.stderr);
  return r.stdout;
}
let comparisons=0;
try{
  for(const [name,source] of programs){
    const expected=run(source,name+'-original');
    for(const preset of ['balanced','paranoid']){
      const result=compile(source,{hardened:true,target:'Lua51',...getPreset(preset)});
      assert.equal(result.predecodedInstructions,true);
      assert.equal(result.parsedInstructionColumns,4);
      assert.ok(result.buildWatermark);
      if(preset==='paranoid'){
        assert.equal(result.soaPrototypes,result.virtualizedFunctions);
        assert.doesNotMatch(result.code,/_unfold/);
        assert.equal(result.generatedKeys.length,1);
      }
      const provider=result.generatedKeys.length?
        'BLACKMAMER_KEY_PROVIDER=function(id) if id~="BMAUTO_V4" then error("bad key id") end return '+
        JSON.stringify(result.generatedKeys[0].key)+' end\n':'';
      const output=run(provider+result.code,name+'-'+preset);
      assert.equal(output,expected,name+' '+preset+' output differed');
      comparisons++;
    }
  }
  console.log('BLACKMAMER differential-50 PASS: '+programs.length+' programs, '+comparisons+' protected comparisons');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
