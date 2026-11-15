'use strict';
// Adversarial Roblox host-boundary test. A plain LuaU process cannot create
// genuine Roblox Instances; it must fail closed when a table proxy is supplied.
// A successful genuine-Instance run must be checked separately in Roblox Studio.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const luau=process.env.LUAU_BIN||'luau';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-anti-hook-'));
function run(code,name){
 const file=path.join(dir,name+'.luau');fs.writeFileSync(file,code);
 return spawnSync(luau,[file],{encoding:'utf8',timeout:30000,maxBuffer:131072});
}
try{
 const source='print("UNTRUSTED_CODE_EXECUTED")';
 const opts={target:'LuaU',hardened:true,protectionLevel:'Maximum',
   vmArchitecture:'seven-independent',antiTamper:true,antiDebug:true,
   autoFunctionEncryption:'standalone'};
 const strict=compile(source,{...opts,robloxApiGuard:true});
 const portable=compile(source,opts);
 assert.equal(strict.robloxApiGuard,true);
 assert.equal(portable.robloxApiGuard,false);
 const benign=run(portable.code,'portable');
 assert.equal(benign.status,0,'Normal portable LuaU remains compatible: '+benign.stderr);
 assert.match(benign.stdout,/UNTRUSTED_CODE_EXECUTED/);
 const attacks=[
  ['nil-globals',''],
  ['table-proxy',[
    'local trace={}',
    'game=setmetatable({}, {__index=function(_,k) trace[#trace+1]=k; return function()return true end end})',
    'script=setmetatable({}, {__index=function(_,k) trace[#trace+1]=k; return function()return true end end})',
    'task={wait=function()end}', 'typeof=function()return "Instance" end'
   ].join('\n')],
  ['custom-env',[
    'local globalEnv=getfenv()',
    'setfenv(1,setmetatable({game={},script={},task={wait=function()end},',
    'typeof=function()return "Instance"end},{__index=globalEnv}))'
   ].join('\n')]
 ];
 for(const [name,prefix] of attacks){
   const result=run(prefix+'\n'+strict.code,'adversarial-'+name);
   assert.notEqual(result.status,0,name+' must fail before script execution');
   assert.doesNotMatch(result.stdout,/UNTRUSTED_CODE_EXECUTED/,
     name+' unexpectedly executed protected program');
 }
 console.log('ROBLOX_HOST_ANTI_HOOK_ADVERSARIAL_PASS '+attacks.length+
   ' proxy/custom-environment cases; portable Luau parity preserved');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
