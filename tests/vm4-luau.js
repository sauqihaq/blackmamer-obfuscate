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
  ['periodic-hook-guard','local i=0;while i<320 do i+=1 end;print(i)'],
  ['runtime-buffer-api',[
    'local b=buffer.create(24)',
    'buffer.writeu8(b,0,250)',
    'buffer.writeu16(b,1,517)',
    'buffer.writeu32(b,4,65539)',
    'buffer.writef32(b,8,1.25)',
    'buffer.writef64(b,12,2.5)',
    'print(buffer.readu8(b,0),buffer.readu16(b,1),buffer.readu32(b,4))',
    'print(buffer.readf32(b,8),buffer.readf64(b,12))'
  ].join('\\n')],
  ['runtime-bit32-api',[
    'print(bit32.lrotate(12345,3),bit32.rrotate(12345,7))',
    'print(bit32.countlz(16),bit32.countrz(16),bit32.extract(255,2,3))'
  ].join('\\n')],
  ['scope-shadow','local signal=17;do local signal=4;print("inner",signal) end;print("outer",signal)'],
  ['repeat-capture','local i=0;repeat local temp=i+1;i=temp until temp>=4;print(i)'],
  ['captured-locals','local secret=11;local function outer(a) local secret=a+1;return function(b)return secret+b end end;print(outer(5)(9),secret)'],
  ['local-methods','local obj={value=0};function obj:apply(n)self.value=self.value+n;return self.value end;print(obj:apply(21),obj:apply(7))'],
  ['roblox-service-mock',[
    'local service={ClearOutput=function(self) self.count=(self.count or 0)+1 end}',
    'local game={GetService=function(self,name) return service end}',
    'local script={attrs={},SetAttribute=function(self,k,v) self.attrs[k]=v end,',
    '  GetAttribute=function(self,k) return self.attrs[k] end}',
    'local LogService=game:GetService("LogService")',
    'local function clear()',
    '  local ok,err=pcall(function() LogService:ClearOutput() end)',
    '  script:SetAttribute("LastClearSucceeded",ok)',
    '  if ok then',
    '    script:SetAttribute("ClearCount",(script:GetAttribute("ClearCount") or 0)+1)',
    '    script:SetAttribute("LastError",nil)',
    '  else script:SetAttribute("LastError",tostring(err)) end',
    'end',
    'clear();print(script:GetAttribute("LastClearSucceeded"),script:GetAttribute("ClearCount"))'
  ].join('\n')]

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
      assert.equal(compiled.perFunctionOpcodePalette,true);
      assert.equal(compiled.perInstructionOperandRotation,true);
      assert.equal(compiled.randomizedRegisterAllocation,true);
      assert.ok(compiled.virtualizedLexicalBindings>=0);
      assert.equal(compiled.dispatchStructure,'per-function-palette');
      assert.equal(compiled.dispatcherVariants,2);
      assert.ok(compiled.scrubbedRuntimeErrors>=10);
      assert.match(compiled.code,/\(\(pc\+spec\[3\]\)%2\)/);
      assert.doesNotMatch(compiled.code,/nativeError\("BLACKMAMER/);
      assert.ok(compiled.opcodePaletteSize>=40);
      assert.match(compiled.code,/spec\[8\]\[/);
      assert.doesNotMatch(compiled.code,/\bif op==\d+\b/);
      assert.ok(compiled.code.includes('local BOOT=0'));
      assert.match(compiled.code,/local function outerVM/);
      assert.match(compiled.code,/BLACKMAMER VM V4\.0/);
      assert.doesNotMatch(compiled.code,/local SALT=\d+;local CHECK=\d+/);
      const actual=run(compiled.code,name+'-'+attempt);
      assert.equal(actual,expected,name+' V4 bytecode output mismatch on build '+attempt);
      comparisons++;
    }
  }
  // One-click Maximum has three independently shuffled handler families.
  const oneClick=compile('local b=buffer.create(4);buffer.writeu32(b,0,42);print(buffer.readu32(b,0))',
    {hardened:true,protectionLevel:'Maximum',nestedVM:true,
      autoFunctionEncryption:'standalone',antiTamper:true,antiDebug:true});
  assert.equal(oneClick.dispatcherVariants,3);
  assert.match(oneClick.code,/\\(\\(pc\\+spec\\[3\\]\\)%3\\)/);
  assert.equal(run(oneClick.code,'maximum-dispatch'),
    run('local b=buffer.create(4);buffer.writeu32(b,0,42);print(buffer.readu32(b,0))','maximum-source'));
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
