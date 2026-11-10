'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {available}=require('../native-sealer');
const port=25000+process.pid%12000;
const root='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.js'],{
  cwd:path.resolve(__dirname,'..'),
  env:{...process.env,PORT:String(port)},
  stdio:['ignore','pipe','pipe']
});
let logs='';
server.stdout.on('data',x=>logs+=x);
server.stderr.on('data',x=>logs+=x);
async function post(body) {
  const r=await fetch(root+'/api/obfuscate',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
}
async function main() {
  let ready=false;
  for(let i=0;i<80;i++) {
    if(server.exitCode!==null) throw new Error('Server exited: '+logs);
    try{const r=await fetch(root+'/');if(r.ok){ready=true;break}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!ready)throw new Error('Server failed to start: '+logs);
  const health=await (await fetch(root+'/api/health')).json();
  assert.equal(health.vm4Available,true);
  assert.equal(health.nativeSealerAvailable,available());
  const request={script:'local a=20*5\nprint(a)',preset:'NativeV4',
    target:'LuaU',vmMode:'native-v4',antiTamper:true,antiDebug:true};
  const first=await post(request);
  assert.equal(first.status,200,JSON.stringify(first.data).slice(0,800));
  assert.equal(first.data.engine,'BLACKMAMER V4 Native VM');
  assert.equal(first.data.blackmamerVM.mode,'native-v4');
  assert.equal(first.data.blackmamerVM.hardened,true);
  assert.equal(first.data.blackmamerVM.nestedVM,true);
  assert.ok(first.data.blackmamerVM.outerVmInstructions>=10);
  assert.equal(first.data.blackmamerVM.runtimeBootstrap,true);
  assert.equal(first.data.blackmamerVM.opaquePredicates,true);
  assert.equal(first.data.blackmamerVM.periodicRuntimeGuard,true);
  assert.equal(first.data.blackmamerVM.perFunctionOpcodePalette,true);
  assert.equal(first.data.blackmamerVM.perInstructionOperandRotation,true);
  assert.ok(first.data.blackmamerVM.opcodePaletteSize>=40);
  assert.equal(first.data.blackmamerVM.dispatchStructure,'per-function-palette');
  assert.ok(first.data.obfuscated.includes('spec[8]['),
    'Handler identifiers must depend on executing function prototype');
  assert.doesNotMatch(first.data.obfuscated,/\bif op==\d+\b/,
    'Hardcoded V4 op==numeric dispatch exposes a global opcode mapping');
  assert.ok(first.data.obfuscated.includes('local BOOT=0'));
  assert.ok(first.data.obfuscated.includes('control-flow guard failed'));
  assert.ok(first.data.obfuscated.includes('runtime API modified'));
  assert.ok(first.data.obfuscated.includes('BLACKMAMER V4 outer VM'),
    'A genuine second interpreter must be emitted in NativeV4');
  assert.equal(first.data.blackmamerVM.nativeSealer,available());
  assert.equal(first.data.blackmamerVM.applied,true);
  assert.equal(first.data.blackmamerVM.fallback,false);
  assert.ok(first.data.obfuscated.startsWith('--[[\n'),'Native V4 output must start with large ASCII-art banner');
  assert.match(first.data.obfuscated,/OBFUSCATED & SECURED BY BLACKMAMER STUDIO/);
  assert.ok(first.data.obfuscated.includes('BLACKMAMER VM V4.0'));
  assert.ok(!first.data.obfuscated.includes('print(a)'));
  const nativePayload=first.data.obfuscated.slice(first.data.obfuscated.indexOf('--[[BLACKMAMER VM V4.0]]'));
  assert.ok(nativePayload.startsWith('--[[BLACKMAMER VM V4.0]]return'));
  assert.equal(nativePayload.includes('\n'),false,'Native V4 VM payload stays one physical line');
  const second=await post(request);
  assert.equal(second.status,200);
  assert.notEqual(first.data.obfuscated,second.data.obfuscated);
  const unnested=await post({...request,nestedVM:false});
  assert.equal(unnested.status,200,JSON.stringify(unnested.data).slice(0,900));
  assert.equal(unnested.data.blackmamerVM.nestedVM,false);
  assert.equal(unnested.data.blackmamerVM.outerVmInstructions,0);
  assert.ok(!unnested.data.obfuscated.includes('BLACKMAMER V4 outer VM'));
  const protectedSource='local protected=BM_ENCFUNC("premium",function(x)return x*7 end)\nprint(protected(6))';
  const protectedReply=await post({...request,script:protectedSource});
  assert.equal(protectedReply.status,200,JSON.stringify(protectedReply.data).slice(0,950));
  assert.deepEqual(protectedReply.data.protectedFunctionIds,['premium']);
  assert.equal(protectedReply.data.blackmamerVM.protectedFunctions,1);
  assert.equal(protectedReply.data.externalKeys.length,1);
  assert.match(protectedReply.data.externalKeys[0].key,/^[0-9a-f]{64}$/);
  assert.equal(protectedReply.data.obfuscated.includes(protectedReply.data.externalKeys[0].key),false);
  const ownKey='ab'.repeat(32);
  const withOwnKey=await post({...request,script:protectedSource,functionKeys:{premium:ownKey}});
  assert.equal(withOwnKey.status,200);
  assert.deepEqual(withOwnKey.data.externalKeys,[]);
  const invalidMarker=await post({...request,script:'print(BM_ENCFUNC(123,function()return 1 end))'});
  assert.equal(invalidMarker.status,422);
  const invalidKey=await post({...request,script:protectedSource,functionKeys:{premium:'short'}});
  assert.equal(invalidKey.status,422);
  // Automatic encryption requires no BM_ENCFUNC marker in the source.
  const autoScript='local function twice(x) return x*2 end\nprint(twice(21))';
  const autoExt=await post({...request,script:autoScript,autoFunctionEncryption:'external'});
  assert.equal(autoExt.status,200,JSON.stringify(autoExt.data).slice(0,950));
  assert.equal(autoExt.data.blackmamerVM.autoFunctionEncryption,'external');
  assert.equal(autoExt.data.blackmamerVM.autoEncryptedFunctions,1);
  assert.equal(autoExt.data.externalKeys.length,1);
  assert.equal(autoExt.data.externalKeys[0].id,'BMAUTO_V4');
  assert.equal(autoExt.data.obfuscated.includes(autoExt.data.externalKeys[0].key),false);
  const autoStandalone=await post({...request,script:autoScript,autoFunctionEncryption:'standalone'});
  assert.equal(autoStandalone.status,200,JSON.stringify(autoStandalone.data).slice(0,950));
  assert.equal(autoStandalone.data.blackmamerVM.autoFunctionEncryption,'standalone');
  assert.equal(autoStandalone.data.blackmamerVM.autoEncryptedFunctions,2);
  assert.equal(autoStandalone.data.blackmamerVM.externallyKeyedFunctions,0);
  assert.deepEqual(autoStandalone.data.externalKeys,[]);
  assert.match(autoStandalone.data.obfuscated,/embeddedAutoKey/);
  const noNested=await post({...request,script:'print("no function")',autoFunctionEncryption:'external'});
  assert.equal(noNested.status,200);
  assert.equal(noNested.data.blackmamerVM.autoEncryptedFunctions,0);
  assert.deepEqual(noNested.data.externalKeys,[]);
  const invalidAuto=await post({...request,script:autoScript,autoFunctionEncryption:'unknown-mode'});
  assert.equal(invalidAuto.status,422);
  const collision=await post({...request,script:'print(BM_ENCFUNC("BMAUTO_V4",function() return 1 end))'});
  assert.equal(collision.status,422);
  const syntax=await post({...request,script:'type Foo = string'});
  assert.equal(syntax.status,422);
  assert.equal(syntax.data.code,'V3_UNSUPPORTED_SYNTAX');
  const lua51=await post({...request,target:'Lua51'});
  assert.equal(lua51.status,400);
  const disabled=await post({...request,blackmamerVM:false});
  assert.equal(disabled.status,400);
  const guards=await post({...request,antiTamper:false,antiDebug:false});
  assert.equal(guards.status,200);
  assert.deepEqual(guards.data.protection,{antiTamper:false,antiDebug:false});
  console.log('Native V4 API: 6 requests and protection/compatibility checks passed');
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>server.kill());
