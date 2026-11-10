'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
async function check(enforced){
  const port=21000+process.pid%10000+(enforced?10000:0);
  const child=spawn(process.execPath,['server.js'],{cwd:require('node:path').join(__dirname,'..'),
    env:{...process.env,PORT:String(port),LICENSE_ENFORCED:enforced?'true':'false',
      DATABASE_URL:'',ADMIN_PASSWORD:'',ADMIN_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']});
  let output='';child.stderr.on('data',b=>output+=b);child.stdout.on('data',b=>output+=b);
  const root='http://127.0.0.1:'+port;
  async function post(path,body){const r=await fetch(root+path,{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:r.status,json:await r.json()};}
  try{
    let online=false;
    for(let i=0;i<60;i++){
      try{const r=await fetch(root+'/api/access/config');if(r.ok){online=true;break}}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(online,true,output);
    const config=await(await fetch(root+'/api/access/config')).json();
    assert.equal(config.licensingEnabled,enforced);
    assert.equal(config.adminAvailable,false);
    const admin=await post('/api/admin/login',{username:'admin',password:'guess'});
    assert.equal(admin.status,503);
    assert.equal(admin.json.code,'ADMIN_NOT_CONFIGURED');
    if(enforced){
      const block=await post('/api/obfuscate',{script:'print("private")',preset:'NativeV4',target:'LuaU'});
      assert.equal(block.status,503);
      assert.equal(block.json.code,'LICENSE_NOT_CONFIGURED');
    }else{
      const preview=await post('/api/access/check',{});
      assert.equal(preview.status,200);assert.equal(preview.json.preview,true);
    }
  }finally{child.kill();}
}
(async()=>{await check(false);await check(true);console.log('Commercial access smoke: preview, admin fail closed, licensing fail closed PASS')})()
.catch(e=>{console.error(e);process.exitCode=1});
