'use strict';
// A/B size and semantic parity for denser, still-shuffled sealed ciphertext
// segments, plus identifier sanitization for VM-owned boundary/preflight locals.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-fragment-density-'));
const targets=[
 ['Lua51',process.env.LUA51_BIN||'lua5.1'],
 ['LuaJIT',process.env.LUAJIT_BIN||'luajit'],
 ...(process.env.LUAU_BIN?[['LuaU',process.env.LUAU_BIN]]:[])
];
const literal='abcdefghijklmNOPQRSTUVWXYZ0123456789'.repeat(104);
const source='local k='+JSON.stringify(literal)+';local v=0;'+
 'for i=1,125 do v=v+(i%9) end;'+
 'local function wrap(x)return x+v end;'+
 'print("DENSE",#k,k:sub(1,7),wrap(11))';
const localNames=[
 'boundaryRawget','boundaryKeys','boundaryPresent','boundarySnapshot',
 'boundaryCheck','boundaryRead','boundaryWrite','boundaryPoll',
 '_bmEnvironmentPreflight','targetObject','targetMeta','sentinel','functionNames'
];
function execute(runtime,script,tag){
 const file=path.join(dir,tag+'.lua');fs.writeFileSync(file,script);
 return spawnSync(runtime,[file],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
}
const basic={hardened:true,protectionLevel:'Maximum',antiDebug:true,
 antiTamper:true,vmArchitecture:'seven-independent',
 autoFunctionEncryption:'standalone',doubleVmFull:true,doubleVmOptimized:true};
let checked=0;
try{
 for(const [target,runtime] of targets){
  const baseline=execute(runtime,source,target+'-source');
  assert.equal(baseline.status,0,target+' input: '+baseline.stderr);
  const compact=compile(source,{...basic,target});
  const legacy=compile(source,{...basic,target,fragmentPacking:'legacy'});
  assert.equal(compact.denseCipherFragments,true);
  assert.equal(legacy.denseCipherFragments,false);
  assert.equal(compact.vmInterpreterCount,7);
  assert.equal(legacy.vmInterpreterCount,7);
  assert.equal(compact.environmentPreflight,true);
  assert.equal(compact.protectedApiBoundary,true);
  assert.equal(compact.chainedInstructionEncoding,true);
  assert.ok(compact.cipherFragmentCount<legacy.cipherFragmentCount/2,
   'Expected at least 2x fewer independently shuffled fragments on '+target);
  for(const name of localNames){
   const pattern=new RegExp('\\b'+name+'\\b');
   assert.doesNotMatch(compact.code,pattern,target+' identifier not randomized: '+name);
  }
  const compactBytes=Buffer.byteLength(compact.code);
  const legacyBytes=Buffer.byteLength(legacy.code);
  assert.ok(compactBytes<legacyBytes,
   target+' dense ciphertext must be smaller: '+compactBytes+' vs '+legacyBytes);
  for(const [label,built] of [['compact',compact],['legacy',legacy]]){
   const result=execute(runtime,built.code,target+'-'+label);
   assert.equal(result.status,0,target+'/'+label+' runtime: '+result.stderr);
   assert.equal(result.stdout,baseline.stdout,target+'/'+label+' output parity');
   checked++;
  }
  console.log('DENSE_CIPHER_SIZE',JSON.stringify({target,legacyBytes,compactBytes,
   savedBytes:legacyBytes-compactBytes,percent:Math.round((legacyBytes-compactBytes)/legacyBytes*1000)/10,
   oldFragments:legacy.cipherFragmentCount,newFragments:compact.cipherFragmentCount,
   aliases:compact.runtimeAliasCount}));
 }
 console.log('BLACKMAMER COMPACT CIPHERTEXT PASS '+checked+' runtime comparisons');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
