'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackmamer-lua51-'));
const runtimes=[['Lua51',process.env.LUA51_BIN||'lua5.1'],['LuaJIT',process.env.LUAJIT_BIN||'luajit']];
const levels=['Minify','Light','Medium','Strong','Maximum'];
const programs=[
  ['math','local a=19;local b=5;print(a+b,a*b)'],
  ['ast-state','local x=1;x=x+1;x=x*3;print(x);print("ok")'],
  ['string','local s="hello";print(s.." world",#s)'],
  ['nested','local function plus(x) return function(y) return x+y end end;print(plus(18)(24))'],
  ['if','local i=5;if i>3 then i=i+2 else i=i-2 end;print(i)'],
  ['loop','local n=0;for i=1,9 do n=n+i end;print(n)'],
  ['table','local t={x=3,y=10};print(t.x+t.y)'],
  ['recursive','local function f(n) if n<2 then return 1 end return n*f(n-1) end;print(f(5))'],
  ['while','local x=0;while x<9 do x=x+1 end;print(x)'],
  ['generic','local s=0;local t={5,7,9};for _,v in ipairs(t) do s=s+v end;print(s)'],
  ['multiple','local function f() return 8,9 end;local a,b=f();print(a,b)']
];
let checks=0;
function run(binary,source,tag){
 const file=path.join(dir,tag+'.lua');
 fs.writeFileSync(file,source,'utf8');
 return spawnSync(binary,[file],{encoding:'utf8',timeout:25000,maxBuffer:1048576});
}
try{
 for(const [target,binary] of runtimes){
  const probe=spawnSync(binary,['-v'],{encoding:'utf8'});
  assert.equal(probe.status,0,'Missing runtime '+binary+': '+probe.error?.message);
  for(const [name,src] of programs){
   const baseline=run(binary,src,target+'-'+name+'-original');
   assert.equal(baseline.status,0,baseline.stderr);
   for(const level of levels){
    const v4=compile(src,{hardened:true,target,protectionLevel:level,
      autoFunctionEncryption:'off',antiTamper:true});
    assert.equal(v4.target,target);
    assert.equal(v4.protectionLevel,level);
    assert.equal(v4.stringEncryption,true);
    assert.equal(v4.nestedVM, !['Minify','Light'].includes(level));
    const compiled=run(binary,v4.code,target+'-'+name+'-'+level);
    assert.equal(compiled.status,0,target+' '+level+' '+name+': '+(compiled.stderr||compiled.stdout));
    assert.equal(compiled.stdout,baseline.stdout,target+' '+level+' '+name+' output differed');
    checks++;
   }
  }
  const encryptedSource='local function calc(x) return x*7 end;print(calc(6))';
  const standalone=compile(encryptedSource,{hardened:true,target,
    protectionLevel:'Strong',autoFunctionEncryption:'standalone'});
  const standRun=run(binary,standalone.code,target+'-standalone');
  assert.equal(standRun.status,0,standRun.stderr);
  assert.equal(standRun.stdout,'42\n');
  assert.deepEqual(standalone.generatedKeys,[]);
  checks++;
  const external=compile(encryptedSource,{hardened:true,target,
    protectionLevel:'Strong',autoFunctionEncryption:'external'});
  assert.equal(external.generatedKeys.length,1);
  assert.equal(external.code.includes(external.generatedKeys[0].key),false);
  const provider='BLACKMAMER_KEY_PROVIDER=function(id) return '+
    JSON.stringify(external.generatedKeys[0].key)+' end\n';
  const unlocked=run(binary,provider+external.code,target+'-external');
  assert.equal(unlocked.status,0,unlocked.stderr);
  assert.equal(unlocked.stdout,'42\n');
  const missing=run(binary,external.code,target+'-missing');
  assert.notEqual(missing.status,0);
  checks++;
 }
 for(const script of ['local n=1;n+=1','local i=0;while i<9 do i+=1 end','print(9//2)']){
  assert.throws(()=>compile(script,{hardened:true,target:'Lua51'}),/Lua 5.1\/LuaJIT target/);
 }
 console.log('V4 compatibility: '+checks+' differential Lua 5.1/LuaJIT cases passed across 5 presets');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
