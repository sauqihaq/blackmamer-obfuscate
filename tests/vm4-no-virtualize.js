'use strict';
// BLACKMAMER Native V4 selective opt-out: native speed for marked functions,
// full VM+encryption protection for every unmarked function.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-no-virtualize-'));
const runtimes=[
 ['Lua51',process.env.LUA51_BIN||'lua5.1'],
 ['LuaJIT',process.env.LUAJIT_BIN||'luajit'],
 ...(process.env.LUAU_BIN?[['LuaU',process.env.LUAU_BIN]]:[])
];
const fixtures=[
 ['pure',
  'local f=BM_NO_VIRTUALIZE(function(x) return x*7 end);print(f(6))'],
 ['mutating-upvalue',
  'local total=0;local update=BM_NO_VIRTUALIZE(function(dt) total=total+dt;return total end);'+
   'print(update(4),update(5),total)'],
 ['independent-captures',
  'local function make(initial) local count=initial;'+
   'local inc=BM_NO_VIRTUALIZE(function(delta) count=count+delta;return count end);return inc end;'+
   'local a=make(10);local b=make(100);print(a(2),a(3),b(4),a(1))'],
 ['global-and-captured-table',
  'local store={value=10};local f=BM_NO_VIRTUALIZE(function(x)'+
   'store.value=store.value+math.abs(x);return store.value end);print(f(-2),f(5),store.value)'],
 ['nested-native-closure',
  'local prefix=6;local f=BM_NO_VIRTUALIZE(function(n)'+
   'local function nested(x)return x+prefix end;return nested(n) end);print(f(4),f(5))'],
 ['shadow-and-local-register',
  'local R=50;local f=BM_NO_VIRTUALIZE(function(R)'+
   'local x=R+1;return x end);print(f(5),R)'],
 ['callback-direct',
  'local function connect(callback)return callback(3)+callback(4) end;'+
   'local total=0;print(connect(BM_NO_VIRTUALIZE(function(v)'+
   'total=total+v;return total end)),total)'],
 ['multiple-hot-functions',
  'local count=0;local f=BM_NO_VIRTUALIZE(function(n) count=count+n;return count end);'+
   'local g=BM_NO_VIRTUALIZE(function(n) return f(n)*2 end);print(g(3),g(5),count)'],
 ['function-factory-nil-upvalue',
  'local function build() local flag=nil;local setFlag=BM_NO_VIRTUALIZE(function(x)'+
   'flag=x;return flag end);return setFlag end;local setFlag=build();'+
   'print(setFlag(8),setFlag(9))']
];
function execLua(binary,source,tag){
 const filename=path.join(dir,tag+'.lua');
 fs.writeFileSync(filename,source,'utf8');
 return spawnSync(binary,[filename],{encoding:'utf8',timeout:25000,maxBuffer:2*1024*1024});
}
let comparisons=0;
try{
 for(const [target,binary] of runtimes){
  const probe=spawnSync(binary,['-v'],{encoding:'utf8'});
  if(target!=='LuaU')assert.equal(probe.status,0,'Missing '+binary+': '+probe.error?.message);
  for(const [name,source] of fixtures){
   const identity='local BM_NO_VIRTUALIZE=function(fn)return fn end;';
   const baseline=execLua(binary,identity+source,target+'-'+name+'-original');
   assert.equal(baseline.status,0,name+' baseline: '+baseline.stderr);
   for(const level of ['Strong','Maximum']){
    const result=compile(source,{hardened:true,target,protectionLevel:level,
     vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone'});
    assert.equal(result.nativeExemptFunctions,
     name==='multiple-hot-functions'?2:1,name+' native marker count');
    assert.equal(result.autoEncryptedFunctions,result.virtualizedFunctions,
     'Every remaining virtualized prototype must stay encrypted');
    assert.equal(result.antiTamper,true);
    assert.equal(result.antiDebug,true);
    assert.doesNotMatch(result.code,/[\r\n]/);
    assert.ok(result.code.includes('function('),'Native function source must exist');
    const protectedRun=execLua(binary,result.code,target+'-'+name+'-'+level);
    assert.equal(protectedRun.status,0,
     target+'/'+name+'/'+level+' runtime: '+(protectedRun.stderr||protectedRun.stdout));
    assert.equal(protectedRun.stdout,baseline.stdout,
     target+'/'+name+'/'+level+' native/VM output parity');
    comparisons++;
   }
  }
 }
 for(const bad of [
  'local f=BM_NO_VIRTUALIZE(42)',
  'local f=BM_NO_VIRTUALIZE("id",function()return 2 end)',
  'local f=BM_NO_VIRTUALIZE(function()return BM_NO_VIRTUALIZE(function()return 3 end)end)'
 ])assert.throws(()=>compile(bad,{
   hardened:true,target:'Lua51',protectionLevel:'Maximum',
   vmArchitecture:'seven-independent'}),/BM_NO_VIRTUALIZE/);
 assert.throws(()=>compile('local f=BM_NO_VIRTUALIZE(function()return 1 end)',{
   hardened:false,target:'Lua51'}),/BM_NO_VIRTUALIZE requires NativeV4/);
 console.log('BLACKMAMER BM_NO_VIRTUALIZE: '+comparisons+
  ' native+VM runtime parity checks across supported binaries; capture and format failures PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
