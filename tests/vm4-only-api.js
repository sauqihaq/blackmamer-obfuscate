'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawn}=require('node:child_process');
const port=23000+(process.pid%10000);
const backend=spawn(process.execPath,['server.js'],{
 cwd:path.join(__dirname,'..'),
 env:{...process.env,PORT:String(port),LICENSE_ENFORCED:'false',DATABASE_URL:''},
 stdio:['ignore','pipe','pipe']
});
let logs='';
backend.stdout.on('data',x=>logs+=String(x));
backend.stderr.on('data',x=>logs+=String(x));
async function api(route,body){
 const r=await fetch('http://127.0.0.1:'+port+route,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {status:r.status,data:await r.json()};
}
(async()=>{
 try{
  let ready=false;
  for(let i=0;i<70;i++){
   try{const r=await fetch('http://127.0.0.1:'+port+'/api/health');if(r.ok){ready=true;break}}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready,logs);
  const home=await(await fetch('http://127.0.0.1:'+port+'/')).json();
  assert.equal(home.engine,'BLACKMAMER Native V4');
  assert.deepEqual(home.levels,['Minify','Light','Medium','Strong','Maximum']);
  for(const target of ['LuaU','Lua51','LuaJIT','Lua']){
   for(const level of home.levels){
    const result=await api('/api/obfuscate',{
      preset:'NativeV4',target,protectionLevel:level,
      script:'local function get()return 42 end\nprint(get())',
      autoFunctionEncryption:'off'
    });
    assert.equal(result.status,200,
      target+'/'+level+': '+JSON.stringify(result.data).slice(0,1000));
    const info=result.data.blackmamerVM;
    assert.equal(info.mode,'native-v4');
    assert.equal(info.protectionLevel,level);
    assert.equal(info.target,target==='Lua'?'Lua51':target);
    assert.equal(info.stringEncryption,true);
    assert.equal(typeof info.astFlattenedGroups,'number');
    if(level==='Minify'||level==='Light')assert.equal(info.astFlattenedGroups,0);
    assert.ok(result.data.obfuscated.includes('BLACKMAMER VM V4.0'));
   }
  }
  const old=await api('/api/obfuscate',{preset:'Medium',script:'print(1)'});
  assert.equal(old.status,400);assert.equal(old.data.code,'V4_ONLY');
  const luaFeature=await api('/api/obfuscate',{
    preset:'NativeV4',target:'Lua51',script:'local x=1;x+=2'});
  assert.equal(luaFeature.status,422);
  const badLevel=await api('/api/obfuscate',{
    preset:'NativeV4',protectionLevel:'Insane',script:'print(1)'});
  assert.equal(badLevel.status,400);
  const external=await api('/api/obfuscate',{
    preset:'NativeV4',target:'Lua51',protectionLevel:'Maximum',
    script:'local function secure(x)return x*2 end\nprint(secure(21))',
    autoFunctionEncryption:'external'
  });
  assert.equal(external.status,200,JSON.stringify(external.data).slice(0,900));
  assert.equal(external.data.externalKeys.length,1);
  assert.equal(external.data.obfuscated.includes(external.data.externalKeys[0].key),false);
  assert.ok(external.data.blackmamerVM.cfgFlattenedBlocks>=1);
  const full=await api('/api/obfuscate',{
    preset:'NativeV4',target:'Lua51',protectionLevel:'Strong',
    script:'local function secure(x)return x*2 end;print(secure(21))',
    autoFunctionEncryption:'external-full'});
  assert.equal(full.status,200,JSON.stringify(full.data).slice(0,950));
  assert.equal(full.data.blackmamerVM.autoEncryptedFunctions,
    full.data.blackmamerVM.virtualizedFunctions);
  assert.equal(full.data.externalKeys.length,1);
  assert.equal(full.data.obfuscated.includes(full.data.externalKeys[0].key),false);
  const oneClick=await api('/api/obfuscate',{
    preset:'NativeV4',target:'LuaU',oneClick:true,
    protectionLevel:'Minify',antiTamper:false,antiDebug:false,
    nestedVM:false,autoFunctionEncryption:'off',functionKeys:{premium:'bad'},
    script:'local function secure(n)return n*2 end;print(secure(21))'
  });
  assert.equal(oneClick.status,200,JSON.stringify(oneClick.data).slice(0,950));
  assert.equal(oneClick.data.blackmamerVM.oneClick,true);
  assert.equal(oneClick.data.blackmamerVM.protectionLevel,'Maximum');
  assert.equal(oneClick.data.blackmamerVM.nestedVM,true);
  assert.equal(oneClick.data.blackmamerVM.autoFunctionEncryption,'standalone');
  assert.equal(oneClick.data.blackmamerVM.autoEncryptedFunctions,
    oneClick.data.blackmamerVM.virtualizedFunctions);
  assert.deepEqual(oneClick.data.externalKeys,[]);
  assert.equal(oneClick.data.protection.antiDebug,true);
  assert.equal(oneClick.data.protection.antiTamper,true);
  assert.match(oneClick.data.obfuscated,/_unfold/);
  assert.doesNotMatch(oneClick.data.obfuscated,/embeddedAutoKey/);
  console.log('V4-only API smoke: 20 target/preset combinations, licensing bypass in preview, external keys, and legacy rejection passed');
 }finally{backend.kill()}
})().catch(e=>{console.error(e);process.exitCode=1;backend.kill()});
