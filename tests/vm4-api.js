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
