'use strict';
// Database-backed integration, executed only in CI with a disposable PG service.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {Pool}=require('pg');
const port=28000+(process.pid%5000);
const url='http://127.0.0.1:'+port;
const conn=process.env.TEST_DATABASE_URL||
  'postgresql://blackmamer:ci-password@127.0.0.1:5432/blackmamer';
const master=crypto.randomBytes(32).toString('hex');
const env={...process.env,PORT:String(port),DATABASE_URL:conn,
 LICENSE_ENFORCED:'true',ADMIN_USERNAME:'admin',
 ADMIN_PASSWORD:'temporary-ci-password-strong',
 ADMIN_SESSION_SECRET:'CI-secret-'.repeat(7),
 BLACKMAMER_VAULT_MASTER_KEY:master,
 BLACKMAMER_RUNTIME_PUBLIC_ORIGIN:'https://blackmamer.example'};
const child=spawn(process.execPath,['server.js'],{
 cwd:path.join(__dirname,'..'),env,stdio:['ignore','pipe','pipe']});
let logs='';
child.stdout.on('data',d=>logs+=String(d));
child.stderr.on('data',d=>logs+=String(d));
const db=new Pool({connectionString:conn});
async function call(endpoint,body={},headers={}){
 const response=await fetch(url+endpoint,{
  method:'POST',headers:{'Content-Type':'application/json',...headers},
  body:JSON.stringify(body)});
 return {status:response.status,headers:response.headers,data:await response.json()};
}
(async()=>{
 try{
  let running=false;
  for(let i=0;i<80;i++){
   try{const r=await fetch(url+'/api/runtime/config');if(r.ok){running=true;break}}catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(running,true,logs);
  const health=await(await fetch(url+'/api/runtime/config')).json();
  assert.equal(health.enabled,true);
  const login=await call('/api/admin/login',{username:'admin',password:env.ADMIN_PASSWORD});
  assert.equal(login.status,200,JSON.stringify(login.data));
  const auth={Authorization:'Bearer '+login.data.token};
  const expiry=new Date(Date.now()+1000*86400*100).toISOString().slice(0,10);
  async function issue(name){
   const r=await call('/api/admin/licenses',{customer:name,
    plan:'Creator',dailyLimit:100,expiresAt:expiry},auth);
   assert.equal(r.status,201,JSON.stringify(r.data));
   return {key:r.data.key,id:r.data.license.id};
  }
  const owner=await issue('Owner of scripts'),attacker=await issue('Other customer');
  const script='local function revenue(x)return x+2 end\nprint(revenue(40))';
  const obfuscated=await call('/api/obfuscate',{
   preset:'NativeV4',target:'LuaU',oneClick:true,
   runtimeMode:'server-vault',universeId:1234,script
  },{'X-License-Key':owner.key});
  assert.equal(obfuscated.status,200,JSON.stringify(obfuscated.data).slice(0,1000));
  const d=obfuscated.data;
  assert.equal(d.blackmamerVM.autoFunctionEncryption,'external-full');
  assert.equal(d.blackmamerVM.autoEncryptedFunctions,d.blackmamerVM.virtualizedFunctions);
  assert.equal(d.blackmamerVM.runtimeMode,'server-vault');
  assert.deepEqual(d.externalKeys,[]);
  assert.equal(d.runtimeKeyVault.enabled,true);
  assert.match(d.obfuscated,/GetSecret/);
  assert.match(d.obfuscated,/BLACKMAMER_LICENSE/);
  assert.doesNotMatch(d.obfuscated,/_unfold/);
  const id=d.runtimeKeyVault.artifactId;
  const keyUrl='/api/runtime/key/'+id;
  const empty=await call(keyUrl,{});
  assert.equal(empty.status,401);
  const foreign=await call(keyUrl,{}, {'X-BM-License':attacker.key,'X-BM-Universe':'1234'});
  assert.equal(foreign.status,403);
  const invalidUniverse=await call(keyUrl,{}, {'X-BM-License':owner.key,'X-BM-Universe':'9999'});
  assert.equal(invalidUniverse.status,403);
  const valid=await call(keyUrl,{}, {'X-BM-License':owner.key,'X-BM-Universe':'1234'});
  assert.equal(valid.status,200,JSON.stringify(valid.data));
  const secret=valid.data.keys.BMAUTO_V4;
  assert.match(secret,/^[0-9a-f]{64}$/);
  assert.equal(d.obfuscated.includes(secret),false);
  assert.match(valid.headers.get('cache-control'),/no-store/);
  const row=await db.query('SELECT key_cipher,key_iv,key_tag,universe_id,license_id FROM bms_runtime_artifacts WHERE id=$1',[id]);
  assert.equal(row.rows.length,1);
  assert.equal(String(row.rows[0].license_id),owner.id);
  assert.equal(Number(row.rows[0].universe_id),1234);
  assert.equal(row.rows[0].key_iv.length,12);
  assert.equal(row.rows[0].key_tag.length,16);
  assert.equal(row.rows[0].key_cipher.includes(Buffer.from(secret)),false);
  const revoke=await call('/api/admin/licenses/'+owner.id,
   {revoked:true},auth); // PATCH below, use direct request
  // POST is intentionally unavailable, so use the authorized PATCH action.
  assert.notEqual(revoke.status,200);
  const patched=await fetch(url+'/api/admin/licenses/'+owner.id,{
   method:'PATCH',headers:{'Content-Type':'application/json',...auth},
   body:JSON.stringify({revoked:true})});
  assert.equal(patched.status,200,await patched.text());
  const blocked=await call(keyUrl,{}, {'X-BM-License':owner.key,'X-BM-Universe':'1234'});
  assert.equal(blocked.status,403);
  console.log('Remote vault PostgreSQL integration: license issuance, owner binding, universe, AES-at-rest, revocation and no plaintext response PASS');
 }finally{
  child.kill();
  await db.end();
 }
})().catch(e=>{console.error(e);console.error(logs.slice(-3000));process.exitCode=1;child.kill();db.end().catch(()=>{})});
