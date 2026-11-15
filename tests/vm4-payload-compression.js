'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {packVmBytes,unpackVmBytes}=require('../vm4-payload-compression');
const {compile}=require('../blackmamer-vm3');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-vm-compression-'));
const runtimes=[
 ['Lua51',process.env.LUA51_BIN||'lua5.1'],
 ['LuaJIT',process.env.LUAJIT_BIN||'luajit'],
 ...(process.env.LUAU_BIN?[['LuaU',process.env.LUAU_BIN]]:[])
];

function execute(bin,source,name){
 const file=path.join(dir,name+'.lua');fs.writeFileSync(file,source);
 return spawnSync(bin,[file],{encoding:'utf8',timeout:35000,maxBuffer:1024*1024});
}
const source=[
 'local Module={}',
 'function Module.new(v)',
 '  return {value=v,add=function(self,n)return self.value+n end}',
 'end',
 'local obj=Module.new(17)',
 'local total=0',
 'for i=1,17 do if i%3~=0 then total=total+i end end',
 'print("STANDALONE",obj:add(total),type(Module.new))',
 'return Module'
].join('\n');
const options={hardened:true,protectionLevel:'Maximum',
 vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone',
 doubleVmOptimized:true,antiDebug:true,antiTamper:true};
let checks=0;
try{
 // Pure JS codec tests verify binary data of all sizes, including random.
 let seed=0x10293847;
 const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed&255;};
 const fixtures=[
  [],[0],[1,2,3],
  Array.from({length:10000},()=>0),
  Array.from({length:450000},(_,i)=>i%137),
  ...[96,97,131,132,133,1024,10000,24000]
    .map(size=>Array.from({length:size},next))
 ];
 for(const plain of fixtures){
  const {bytes,compressed}=packVmBytes(plain);
  assert.deepEqual(unpackVmBytes(bytes),plain);
  if(compressed)assert.ok(bytes.length<plain.length);
  checks++;
 }
 for(const malicious of [
  [],[2],[1,9],[1,4,0,0,0,128,0,0],
  [1,4,0,0,0,0,7],
  [1,1,0,0,0,128,1,0]
 ]){
  assert.throws(()=>unpackVmBytes(malicious));
  checks++;
 }
 for(const [target,runtime] of runtimes){
  const original=execute(runtime,source,target+'-original');
  assert.equal(original.status,0,target+' source: '+original.stderr);
  const variants=[
   ['packed-default',{}],
   ['packed-forced',{vmPayloadForcePacked:true}],
   ['legacy',{vmPayloadCompression:false}]
  ];
  for(const [tag,extra] of variants){
   const vm=compile(source,{...options,target,...extra});
   assert.equal(vm.vmInterpreterCount,7,target+' VM engines');
   assert.equal(vm.protectedApiBoundary,true,target+' API boundary');
   assert.equal(vm.environmentPreflight,true,target+' startup preflight');
   assert.equal(vm.chainedInstructionEncoding,true,target+' opcode chaining');
   if(tag==='legacy'){
    assert.equal(vm.vmPayloadCompression,false);
    assert.equal(vm.vmPayloadCodec,'none');
   }else{
    assert.equal(vm.vmPayloadCompression,true);
    assert.equal(vm.vmPayloadCodec,'portable-lz-v1');
    if(tag==='packed-forced')
      assert.ok(vm.vmPayloadCompressedFunctions>0,
        target+' test-only build must exercise true LZ VM decode');
    assert.ok(vm.vmPayloadBytesAfter<=vm.vmPayloadBytesBefore+vm.virtualizedFunctions,
      target+' default codec must not bloat payload beyond mode flag');
   }
   const actual=execute(runtime,vm.code,target+'-'+tag);
   assert.equal(actual.status,0,target+'/'+tag+': '+actual.stderr);
   assert.equal(actual.stdout,original.stdout,target+'/'+tag+' parity');
   console.log('VM_COMPRESSION_RUNTIME',JSON.stringify({
    target,tag,outputBytes:Buffer.byteLength(vm.code),
    originalBytes:vm.vmPayloadBytesBefore,
    packedBytes:vm.vmPayloadBytesAfter,
    compressedFunctions:vm.vmPayloadCompressedFunctions
   }));
   checks++;
  }
 }
 console.log('BLACKMAMER VM PAYLOAD COMPRESSION PASS',checks);
}finally{fs.rmSync(dir,{recursive:true,force:true})}
