'use strict';
// VM anti-hook checks must be platform-neutral by default. Roblox-only host
// validation is opt-in and should never reject ordinary Luau or Lua globals.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bm-universal-lua-'));
const targets=[
 ['Lua51',process.env.LUA51_BIN||'lua5.1'],
 ['LuaJIT',process.env.LUAJIT_BIN||'luajit'],
 ...(process.env.LUAU_BIN?[['LuaU',process.env.LUAU_BIN]]:[])
];
const fixtures=[
 ['no-roblox','local function square(n)return n*n end print("PORTABLE",square(7))',''],
 ['host-proxy','print("HOST_PROXY",game.Value,script.Name)',
  'game=setmetatable({Value=27},{__index=function(t,k)return rawget(t,k)end});script={Name="NativeLua"};']
];
function execute(runtime,source,tag){
 const f=path.join(folder,tag+'.lua');fs.writeFileSync(f,source,'utf8');
 return spawnSync(runtime,[f],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
}
try{
 let checks=0;
 for(const [target,runtime] of targets){
  for(const [id,source,prefix] of fixtures){
   const expected=execute(runtime,prefix+source,target+'-'+id+'-original');
   assert.equal(expected.status,0,target+' original '+id+': '+expected.stderr);
   const compiled=compile(source,{
    target,hardened:true,protectionLevel:'Maximum',
    vmArchitecture:'seven-independent',
    antiTamper:true,antiDebug:true,autoFunctionEncryption:'standalone'
   });
   assert.equal(compiled.robloxApiGuard,false,target+' must not require Roblox globals');
   assert.equal(compiled.portableApiIntegrityGuard,true);
   assert.doesNotMatch(compiled.code,/Roblox Instance proxy detected|game:IsA\("DataModel"\)/);
   const got=execute(runtime,prefix+compiled.code,target+'-'+id+'-protected');
   assert.equal(got.status,0,target+' protected '+id+': '+got.stderr);
   assert.equal(got.stdout,expected.stdout,target+'/'+id+' runtime parity');
   checks++;
  }
 }
 console.log('BLACKMAMER UNIVERSAL LUA RUNTIME PASS '+checks+
   ' portable native/CLI and mocked-host checks');
}finally{fs.rmSync(folder,{recursive:true,force:true})}
