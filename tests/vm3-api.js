'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const port=14000+process.pid%10000;
const root='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.js'],{
  cwd:require('node:path').resolve(__dirname,'..'),
  env:{...process.env,PORT:String(port)},
  stdio:['ignore','pipe','pipe']
});
let logs='';server.stdout.on('data',x=>{logs+=String(x)});server.stderr.on('data',x=>{logs+=String(x)});
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
    if(server.exitCode!==null)throw new Error('Server exited before startup: '+logs);
    try{const r=await fetch(root+'/');if(r.ok){online=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!online)throw new Error('Backend did not start: '+logs);
  const script='print("Hello World")';
  const good=await post({script,preset:'NativeV3',target:'LuaU',vmMode:'native-v3',antiTamper:true,antiDebug:true});
  assert.equal(good.status,200,JSON.stringify(good.data));
  assert.equal(good.data.engine,'BLACKMAMER V3 Native VM');
  assert.equal(good.data.blackmamerVM.mode,'native-v3');
  assert.equal(good.data.blackmamerVM.applied,true);
  assert.equal(good.data.blackmamerVM.fallback,false);
  assert.ok(Number.isInteger(good.data.blackmamerVM.fusedInstructions));
  assert.equal(good.data.protection.antiTamper,true);
  assert.equal(good.data.protection.antiDebug,true);
  assert.ok(good.data.obfuscated.includes('BLACKMAMER VM V3'));
  assert.ok(!good.data.obfuscated.includes('Hello World'));
  const unsupported=await post({script:'type ObfuscatorTest = number',preset:'NativeV3',target:'LuaU'});
  assert.equal(unsupported.status,422);
  assert.equal(unsupported.data.code,'V3_UNSUPPORTED_SYNTAX');
  assert.equal(unsupported.data.position?.line,1,'Backend should report the parser line');
  assert.equal(unsupported.data.position?.column,1,'Backend should report parser column');
  assert.match(unsupported.data.error,/baris 1, kolom 1/);
  assert.match(unsupported.data.detail,/Identifier expected|Unsupported/);
  const cinematic=await post({script:'local x=0\nwhile x<3 do x+=1;if x==2 then continue end end\nprint(x)',
    preset:'NativeV3',target:'LuaU'});
  assert.equal(cinematic.status,200,JSON.stringify(cinematic.data).slice(0,800));
  const rejected=await post({script,preset:'NativeV3',target:'Lua51'});
  assert.equal(rejected.status,400);
  const noProtection=await post({script,preset:'NativeV3',antiTamper:false,antiDebug:false});
  assert.equal(noProtection.status,200);
  assert.deepEqual(noProtection.data.protection,{antiTamper:false,antiDebug:false});
  const basic=await post({script,preset:'NativeV3',target:'LuaU',superInstructions:false});
  assert.equal(basic.status,200,JSON.stringify(basic.data));
  assert.equal(basic.data.blackmamerVM.fusedInstructions,0);
  const saweriaScript=require('node:fs').readFileSync(require('node:path').resolve(__dirname,'fixtures/bm-saweria-fake-donate-client.luau'),'utf8');
  const saweria=await post({script:saweriaScript,preset:'NativeV3',target:'LuaU',vmMode:'native-v3',blackmamerVM:true,antiTamper:true,antiDebug:true});
  assert.equal(saweria.status,200,JSON.stringify(saweria.data).slice(0,1200));
  assert.equal(saweria.data.blackmamerVM.fallback,false);
  assert.ok(saweria.data.blackmamerVM.vmInstructions>200);
  assert.ok(saweria.data.obfuscated.includes('BLACKMAMER VM V3.'));
  const cinematicScript=require('node:fs').readFileSync(require('node:path').resolve(__dirname,'fixtures/bm-saweria-donation-cinematic.luau'),'utf8');
  const cinematicFull=await post({script:cinematicScript,preset:'NativeV3',target:'LuaU',vmMode:'native-v3',
    blackmamerVM:true,antiTamper:true,antiDebug:true});
  assert.equal(cinematicFull.status,200,JSON.stringify(cinematicFull.data).slice(0,1000));
  assert.equal(cinematicFull.data.blackmamerVM.mode,'native-v3');
  assert.equal(cinematicFull.data.blackmamerVM.fallback,false);
  assert.ok(cinematicFull.data.blackmamerVM.vmInstructions>300);
  console.log('Native V3 API: 7 requests passed, including exact user Donation Cinematic source');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.kill());
