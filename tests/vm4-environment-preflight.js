'use strict';
// Best-effort universal startup preflight. This detects malformed primitive
// semantics and callable-table API substitutes, not faithful preinstalled hooks.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bm-env-preflight-'));
const targets=[
 ['Lua51',process.env.LUA51_BIN||'lua5.1'],
 ['LuaJIT',process.env.LUAJIT_BIN||'luajit'],
 ...(process.env.LUAU_BIN?[['LuaU',process.env.LUAU_BIN]]:[])
];
function run(binary,code,name){
 const file=path.join(folder,name+'.lua');fs.writeFileSync(file,code,'utf8');
 return spawnSync(binary,[file],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
}
function protect(src,target,opts={}){
 return compile(src,{target,hardened:true,protectionLevel:'Maximum',
  vmArchitecture:'seven-independent',antiTamper:true,antiDebug:true,
  autoFunctionEncryption:'standalone',...opts});
}
let checked=0;
try{
 for(const [target,binary] of targets){
  // Ordinary custom Lua globals and inherited environments are still valid.
  const legitimate=[
   ['native','', 'print("ENV_PREFLIGHT_OK",42)'],
   ['custom-game','game=setmetatable({Value=7},{__index=function()return nil end});script={Name="Script"};',
     'print("CUSTOM_GAME",game.Value,script.Name)'],
   ['inherited-env','local base=getfenv();setfenv(1,setmetatable({game={Value=9}}, {__index=base}));',
     'print("INHERITED_ENV",game.Value)'],
   // A faithful function wrapper exists in legitimate uses and also in
   // malicious logging environments. We do not falsely claim detection.
   ['forwarding-function','local prior=print;print=function(...)return prior("WRAPPER",...)end;',
     'print("NORMAL")']
  ];
  for(const [name,prefix,script] of legitimate){
   const expected=run(binary,prefix+script,target+'-original-'+name);
   assert.equal(expected.status,0,target+' original '+name+': '+expected.stderr);
   const built=protect(script,target);
   assert.equal(built.environmentPreflight,true,target+' startup preflight enabled');
   assert.equal(built.robloxApiGuard,false,target+' no mandatory Roblox guard');
   const actual=run(binary,prefix+built.code,target+'-protected-'+name);
   assert.equal(actual.status,0,target+' '+name+': '+actual.stderr);
   assert.equal(actual.stdout,expected.stdout,target+'/'+name+' parity');
   checked++;
  }
  const attacks=[
   ['callable-print',
    'local prior=print;print=setmetatable({},{__call=function(_,...)return prior(...)end});'],
   ['callable-require',
    'require=setmetatable({},{__call=function()return {}end});'],
   ['lying-type',
    'local orig=type;type=function(x)if orig(x)=="number" then return "string" end return orig(x)end;'],
   ['rawget-index-hook',
    'rawget=function(t,k)return t[k]end;'],
   ['rawequal-always-true',
    'rawequal=function()return true end;']
  ];
  for(const [name,prefix] of attacks){
   const built=protect('print("ATTACK_SCRIPT_EXECUTED")',target);
   const result=run(binary,prefix+built.code,target+'-attack-'+name);
   assert.notEqual(result.status,0,target+'/'+name+' must reject malformed host primitives');
   assert.doesNotMatch(result.stdout,/ATTACK_SCRIPT_EXECUTED/,target+'/'+name+' must block before VM payload');
   checked++;
  }
  const disabled=protect('print("NO_PREFLIGHT")',target,{antiDebug:false});
  assert.equal(disabled.environmentPreflight,false,target+' antiDebug=false disables preflight');
  checked++;
 }
 console.log('BLACKMAMER ENVIRONMENT PREFLIGHT PASS '+checked+
  ' legitimate environment, preinstalled malformed host proxy, and opt-out checks');
}finally{fs.rmSync(folder,{recursive:true,force:true})}
