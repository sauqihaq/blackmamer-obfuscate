'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const port=14000+process.pid%10000;
const root='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.js'],{
  cwd:require('node:path').resolve(__dirname,'..'),
  env:{...process.env,PORT:String(port)},
  stdio:'ignore'
});
async function post(body){
  const r=await fetch(root+'/api/obfuscate',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  return {status:r.status,data:await r.json()};
}
async function main(){
  let online=false;
  for(let attempt=0;attempt<70;attempt++){
    if(server.exitCode!==null)throw new Error('Server exited before startup');
    try{const r=await fetch(root+'/');if(r.ok){online=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!online)throw new Error('Backend did not start');
  const script='print("Hello World")';
  const good=await post({script,preset:'NativeV3',target:'LuaU',vmMode:'native-v3',antiTamper:true,antiDebug:true});
  assert.equal(good.status,200,JSON.stringify(good.data));
  assert.equal(good.data.engine,'BLACKMAMER V3 Native VM');
  assert.equal(good.data.blackmamerVM.mode,'native-v3');
  assert.equal(good.data.blackmamerVM.applied,true);
  assert.equal(good.data.blackmamerVM.fallback,false);
  assert.equal(good.data.protection.antiTamper,true);
  assert.equal(good.data.protection.antiDebug,true);
  assert.ok(good.data.obfuscated.includes('BLACKMAMER VM V3'));
  assert.ok(!good.data.obfuscated.includes('Hello World'));
  const unsupported=await post({script:'continue',preset:'NativeV3',target:'LuaU'});
  assert.equal(unsupported.status,422);
  assert.equal(unsupported.data.code,'V3_UNSUPPORTED_SYNTAX');
  const rejected=await post({script,preset:'NativeV3',target:'Lua51'});
  assert.equal(rejected.status,400);
  const noProtection=await post({script,preset:'NativeV3',antiTamper:false,antiDebug:false});
  assert.equal(noProtection.status,200);
  assert.deepEqual(noProtection.data.protection,{antiTamper:false,antiDebug:false});
  console.log('Native V3 API: 4 requests passed, native engine selected and unsupported syntax fails closed');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.kill());
