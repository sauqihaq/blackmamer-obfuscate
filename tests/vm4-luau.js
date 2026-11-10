'use strict';
// End-to-end output comparisons against the official Luau CLI.
// The VM and the original source must produce byte-identical stdout.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackmamer-v4-'));
const luau=process.env.LUAU_BIN || 'luau';
function run(source,filename) {
  const file=path.join(dir,filename+'.luau');
  fs.writeFileSync(file,source,'utf8');
  const result=spawnSync(luau,[file],{encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024});
  if(result.error || result.status!==0)
    throw new Error(filename+': '+(result.error?.message||result.stderr||'exit '+result.status));
  return result.stdout;
}
const fixtures=[
  ['hello','print("Hello World")'],
  ['math','local a=9*7;local b=2^4;print(a+b)'],
  ['if','local a=if true then 9 else 4;print(a)'],
  ['while','local i=0;while i<5 do i+=1 end;print(i)'],
  ['closure','local function f(a) return function(b) return a+b end end;print(f(12)(9))'],
  ['recursion','local function fib(n) if n<2 then return n end return fib(n-1)+fib(n-2) end;print(fib(7))'],
  ['table','local a={x=3};a.y=8;print(a.x+a.y)'],
  ['for','local s=0;for i=1,7 do s+=i end;print(s)'],
  ['string','print("snow".."man",string.len("abc"))'],
  ['method','local t={go=function(self,x) return x*2 end};print(t:go(6))'],
  ['return','local function both()return 5,6 end;local a,b=both();print(a,b)'],
  ['loop-continue','local s=0;for i=1,9 do if i%2==0 then continue end;s+=i end;print(s)'],
  ['periodic-hook-guard','local i=0;while i<320 do i+=1 end;print(i)']
];
try {
  let comparisons=0;
  for(const [name,src] of fixtures) {
    const expected=run(src,name+'-source');
    for(let attempt=0;attempt<3;attempt++) {
      const compiled=compile(src,{hardened:true,nestedVM:true,antiTamper:true,antiDebug:true});
      assert.equal(compiled.engine,'BLACKMAMER V4 Native VM');
      assert.equal(compiled.hardened,true);
      assert.equal(compiled.nestedVM,true);
      assert.ok(compiled.outerVmInstructions>=10);
      assert.equal(compiled.runtimeBootstrap,true);
      assert.equal(compiled.opaquePredicates,true);
      assert.equal(compiled.periodicRuntimeGuard,true);
      assert.ok(compiled.code.includes('local BOOT=0'));
      assert.match(compiled.code,/BLACKMAMER V4 outer VM/);
      assert.match(compiled.code,/BLACKMAMER VM V4\.0/);
      assert.doesNotMatch(compiled.code,/local SALT=\d+;local CHECK=\d+/);
      const actual=run(compiled.code,name+'-'+attempt);
      assert.equal(actual,expected,name+' V4 bytecode output mismatch on build '+attempt);
      comparisons++;
    }
  }
  const legacy=compile('print("legacy")',{hardened:true,nestedVM:false});
  assert.equal(legacy.nestedVM,false);
  assert.equal(run(legacy.code,'legacy-v4'),run('print("legacy")','legacy-source'));
  const corrupted=compile('print("test")',{hardened:true,nestedVM:true});
  const tampered=corrupted.code.replace(/(local _[a-z]{7}=\{")([A-Za-z0-9_-])/,
    (_,prefix,c)=>prefix+(c==='A'?'B':'A'));
  assert.notEqual(tampered,corrupted.code);
  const tamperedFile=path.join(dir,'tampered.luau');
  fs.writeFileSync(tamperedFile,tampered,'utf8');
  const bad=spawnSync(luau,[tamperedFile],{encoding:'utf8',timeout:10000});
  assert.notEqual(bad.status,0,'V4 should reject modified payloads');
  console.log('V4 Luau: '+comparisons+' output comparisons and payload-tamper check passed');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
