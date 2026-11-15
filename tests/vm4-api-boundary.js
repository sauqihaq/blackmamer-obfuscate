'use strict';
// Tests for a portable API boundary protecting existing host-owned globals.
// It is best-effort against *post-startup* mutation, not preinstalled hooks.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bm-api-boundary-'));
const targets=[
 ['Lua51',process.env.LUA51_BIN||'lua5.1'],
 ['LuaJIT',process.env.LUAJIT_BIN||'luajit'],
 ...(process.env.LUAU_BIN?[['LuaU',process.env.LUAU_BIN]]:[])
];
function run(runtime,src,label){
 const file=path.join(folder,label+'.lua');fs.writeFileSync(file,src);
 return spawnSync(runtime,[file],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
}
function protectedScript(source,target){
 return compile(source,{
  target,hardened:true,protectionLevel:'Maximum',
  vmArchitecture:'seven-independent',antiTamper:true,antiDebug:true,
  autoFunctionEncryption:'standalone'
 });
}
let verified=0;
try{
 for(const [target,binary] of targets){
  const fixtures=[
   ['plain','local f=print; f("BOUNDARY",42)'],
   ['custom-game','game={GetService=function(_,s)return {Name=s}end}; print(game:GetService("Players").Name)'],
   ['intentional-rebinding',
    'local original=print; print=function(x)original("CUSTOM",x)end;print(7);print=original;print("RESTORED")']
  ];
  for(const [id,src] of fixtures){
   const baseline=run(binary,src,target+'-'+id+'-original');
   assert.equal(baseline.status,0,target+' '+id+' baseline '+baseline.stderr);
   const result=protectedScript(src,target);
   assert.equal(result.protectedApiBoundary,true,target+' API boundary metadata');
   assert.equal(result.robloxApiGuard,false,target+' universal mode must be host-neutral');
   const actual=run(binary,result.code,target+'-'+id+'-protected');
   assert.equal(actual.status,0,target+' '+id+' protected '+actual.stderr);
   assert.equal(actual.stdout,baseline.stdout,target+' '+id+' behavior regression');
   verified++;
  }
  // Modifying an already-present API through a direct global table lookup
  // bypasses VM SET. The boundary must reject it before the next API call.
  const mutation=[
   'local env=getfenv()',
   'env.print=function()end',
   'print("UNGUARDED_API_CALL")'
  ].join(';');
  const altered=protectedScript(mutation,target);
  const observed=run(binary,altered.code,target+'-external-api-mutation');
  assert.notEqual(observed.status,0,target+' post-startup API overwrite should be blocked');
  assert.doesNotMatch(observed.stdout,/UNGUARDED_API_CALL/);
  // Hardened output intentionally scrubs runtime error strings per build.
  // Validate that the guard actually tripped, not a specific plaintext message.
  assert.match(observed.stderr,/boundaryCheck|API boundary binding changed/,
   target+' must fail from guarded API boundary');
  verified++;
 }
 console.log('BLACKMAMER PROTECTED API BOUNDARY PASS '+verified+
  ' portable good-path/rebinding and tamper rejection checks');
}finally{fs.rmSync(folder,{recursive:true,force:true})}
