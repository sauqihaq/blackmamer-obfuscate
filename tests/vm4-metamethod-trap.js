'use strict';
// Defensive test: an isolated __tostring metamethod probe must reject hooks
// and tampering without touching other people's tables/metatables.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-v4-metamethod-'));
const targets=[
 ['Lua51',process.env.LUA51_BIN||'lua5.1'],
 ['LuaJIT',process.env.LUAJIT_BIN||'luajit'],
 ...(process.env.LUAU_BIN?[['LuaU',process.env.LUAU_BIN]]:[])
];
const scripts=[
 ['basic','print("BM-META-OK")'],
 ['user-metatable',
  'local t=setmetatable({n=7},{__tostring=function(self)return "N"..self.n end});'+
  'print(tostring(t),getmetatable(t).__tostring~=nil)'],
 ['periodic',
  'local i=0;while i<400 do i=i+1 end;print("DONE",i)']
];
function exec(binary,src,name){
 const filename=path.join(dir,name+'.lua');
 fs.writeFileSync(filename,src,'utf8');
 return spawnSync(binary,[filename],{
  encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024
 });
}
function protect(source,target,level='Maximum',opts={}){
 return compile(source,{
  target,hardened:true,protectionLevel:level,
  vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone',
  ...opts
 });
}
let checks=0;
try{
 for(const [target,binary] of targets){
  if(target!=='LuaU'){
   const probe=spawnSync(binary,['-v'],{encoding:'utf8'});
   assert.equal(probe.status,0,'Missing runtime '+binary);
  }
  for(const [name,source] of scripts){
   const baseline=exec(binary,source,target+'-'+name+'-original');
   assert.equal(baseline.status,0,target+' original '+baseline.stderr);
   for(const level of ['Strong','Maximum']){
    const r=protect(source,target,level);
    assert.equal(r.metamethodTostringTrap,true);
    assert.equal(r.metamethodTrapPeriodic,true);
    assert.equal(r.antiTamper,true);
    assert.equal(r.periodicRuntimeGuard,true);
    assert.doesNotMatch(r.code,/[\r\n]/);
    const output=exec(binary,r.code,target+'-'+name+'-'+level);
    assert.equal(output.status,0,target+' '+level+' '+name+': '+output.stderr);
    assert.equal(output.stdout,baseline.stdout,target+' '+level+' '+name+' parity');
    checks++;
   }
  }
  const simple=protect('print("SHOULD_NOT_PRINT")',target);
  const attacks=[
   // Intercept before startup and mutate only the compiler-owned sentinel.
   ['metatable-overwrite',
    'local s=setmetatable;setmetatable=function(t,mt)'+
    'if type(mt)=="table" and type(rawget(mt,"__tostring"))=="function" then '+
    'rawset(mt,"__tostring",function()return "spoof"end) end;return s(t,mt)end;'],
   // A tostring replacement may return a plausible string without ever
   // triggering the corresponding __tostring dispatch.
   ['tostring-hook',
    'local s=tostring;tostring=function(v)'+
    'if type(v)=="table" then return "spoof" end;return s(v)end;'],
   ['setmetatable-suppress',
    'local s=setmetatable;setmetatable=function(t,mt)'+
    'if type(mt)=="table" and type(rawget(mt,"__tostring"))=="function" then return t end;'+
    'return s(t,mt) end;'],
   ['metamethod-exception',
    'local s=setmetatable;setmetatable=function(t,mt)'+
    'if type(mt)=="table" and type(rawget(mt,"__tostring"))=="function" then '+
    'rawset(mt,"__tostring",function()error("injected") end) end;return s(t,mt)end;']
  ];
  for(const [name,prefix] of attacks){
   const result=exec(binary,prefix+simple.code,target+'-attack-'+name);
   assert.notEqual(result.status,0,target+'/'+name+' must fail closed');
   assert.equal(result.stdout.includes('SHOULD_NOT_PRINT'),false);
   checks++;
  }
  // Mutate after the initial guard, while VM instructions are running.
  // The private __tostring probe must catch it through periodic runtimeGuard.
  const periodicSource=[
   'local i=0',
   'while i<700 do',
   ' i=i+1',
   ' if i==3 then __BM_TEST_TRAP.__tostring=function()return "spoof" end end',
   'end',
   'print("TAMPER_NOT_DETECTED")'
  ].join('\n');
  const periodic=protect(periodicSource,target);
  const prefix='local originalSetmetatable=setmetatable;'+
   'setmetatable=function(t,mt)'+
   'if type(mt)=="table" and type(rawget(mt,"__tostring"))=="function" then '+
   '_G.__BM_TEST_TRAP=mt end;return originalSetmetatable(t,mt) end;';
  const mutation=exec(binary,prefix+periodic.code,target+'-periodic-attack');
  assert.notEqual(mutation.status,0,target+' periodic trap tamper must be detected');
  assert.equal(mutation.stdout.includes('TAMPER_NOT_DETECTED'),false);
  checks++;

  const disabled=protect('print("OK")',target,'Maximum',{antiTamper:false});
  assert.equal(disabled.metamethodTostringTrap,false);
  assert.equal(disabled.metamethodTrapPeriodic,false);
  checks++;
 }
 console.log('V4 private tostring anti-tamper: '+checks+
  ' benign parity and adversarial hook/periodic-tamper tests PASS');
}finally{
 fs.rmSync(dir,{recursive:true,force:true});
}
