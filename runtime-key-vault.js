'use strict';
// Server-only authenticated key vault for BLACKMAMER Native V4.
// Stores runtime keys encrypted with AES-256-GCM and binds them to licensed users.
// Privileged server owners can still dump decrypted VM bytes after execution.
const crypto=require('node:crypto');
const {Pool}=require('pg');
// Accept both legacy 64-hex secrets and branded BM_ + 64-hex secrets.
// The prefix is only presentation; AES-256-GCM still receives exactly 32 bytes.
const rawMasterKey=process.env.BLACKMAMER_VAULT_MASTER_KEY||'';
const masterHex=rawMasterKey.startsWith('BM_')?
  rawMasterKey.slice(3):rawMasterKey;
const enabled=process.env.LICENSE_ENFORCED==='true'&&Boolean(process.env.DATABASE_URL)&&
  /^[a-f0-9]{64}$/i.test(masterHex);
const master=enabled?Buffer.from(masterHex,'hex'):null;
const pool=enabled?new Pool({
 connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:6000,
 ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true}:undefined
}):null;
const fail=(res,status,code,message)=>res.status(status).json({code,error:message});
const isUuid=s=>typeof s==='string'&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const isKey=s=>typeof s==='string'&&/^[a-fA-F0-9]{64}$/.test(s);
const isLicense=s=>typeof s==='string'&&/^BM-[A-F0-9-]{35,45}$/.test(s);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const attempts=new Map();
let ready;
function setup(){
 if(!enabled)throw new Error('Vault requires licensing, PostgreSQL and a 32-byte master key');
 if(!ready)ready=pool.query(
  'CREATE TABLE IF NOT EXISTS bms_runtime_artifacts ('+
   'id UUID PRIMARY KEY,'+
   'license_id UUID NOT NULL REFERENCES bms_licenses(id),'+
   'universe_id BIGINT,'+
   'key_iv BYTEA NOT NULL,'+
   'key_tag BYTEA NOT NULL,'+
   'key_cipher BYTEA NOT NULL,'+
   'revoked BOOLEAN NOT NULL DEFAULT FALSE,'+
   'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),'+
   "expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '365 days')"
 ).catch(e=>{ready=null;throw e});
 return ready;
}
function encrypted(artifactId,licenseId,keys){
 if(!master||!isUuid(artifactId)||!isUuid(licenseId))throw new Error('Vault is not configured');
 const entries=Object.entries(keys);
 if(entries.length!==1||entries[0][0]!=='BMAUTO_V4'||!isKey(entries[0][1]))
  throw new Error('Expected exactly one automatic function key');
 const iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv('aes-256-gcm',master,iv);
 cipher.setAAD(Buffer.from(artifactId+':'+licenseId));
 const bytes=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(keys))),cipher.final()]);
 return {iv,tag:cipher.getAuthTag(),cipher:bytes};
}
function decrypted(artifactId,licenseId,record){
 if(!master)throw new Error('Vault is not configured');
 const decipher=crypto.createDecipheriv('aes-256-gcm',master,record.key_iv);
 decipher.setAAD(Buffer.from(artifactId+':'+licenseId));
 decipher.setAuthTag(record.key_tag);
 const raw=Buffer.concat([decipher.update(record.key_cipher),decipher.final()]);
 const keys=JSON.parse(raw.toString('utf8'));
 if(!keys||Object.keys(keys).length!==1||!isKey(keys.BMAUTO_V4))
  throw new Error('Invalid keys in vault record');
 return keys;
}
async function store({artifactId,licenseId,keys,universeId=null}){
 await setup();
 if(universeId!==null&&(!Number.isSafeInteger(universeId)||universeId<1))
  throw new Error('Invalid universeId');
 const payload=encrypted(artifactId,licenseId,keys);
 await pool.query(
  'INSERT INTO bms_runtime_artifacts '+
  '(id,license_id,universe_id,key_iv,key_tag,key_cipher) VALUES($1,$2,$3,$4,$5,$6)',
  [artifactId,licenseId,universeId,payload.iv,payload.tag,payload.cipher]
 );
 return artifactId;
}
function registerRoutes(app){
 app.get('/api/runtime/config',(_req,res)=>res.json({
  enabled,storage:'postgresql-encrypted',auth:'roblox-secret-store',
  secretName:'BLACKMAMER_LICENSE',serverOnly:true,needsSetup:!enabled
 }));
 app.post('/api/runtime/key/:artifactId',async(req,res)=>{
  res.set('Cache-Control','no-store, private').set('Pragma','no-cache');
  if(!enabled)return fail(res,503,'VAULT_UNCONFIGURED',
    'Remote vault needs PostgreSQL, BLACKMAMER_VAULT_MASTER_KEY and enforced licenses');
  const id=req.params.artifactId;
  const credential=req.get('X-BM-License')||'';
  if(!isUuid(id)||!isLicense(credential))
   return fail(res,401,'VAULT_UNAUTHORIZED','Invalid runtime credential');
  // Best-effort process-local rate limit; add an edge limiter for multi-instance.
  const token=sha(credential),now=Date.now();
  const entry=attempts.get(token)||{count:0,until:now+60000};
  if(now>entry.until){entry.count=0;entry.until=now+60000}
  entry.count++;
  attempts.set(token,entry);
  if(attempts.size>2000)attempts.clear();
  if(entry.count>120)return fail(res,429,'VAULT_RATE_LIMIT','Too many runtime requests');
  try{
   await setup();
   const {rows}=await pool.query(
     'SELECT a.license_id,a.universe_id,a.key_iv,a.key_tag,a.key_cipher '+
     'FROM bms_runtime_artifacts a JOIN bms_licenses l ON l.id=a.license_id '+
     'WHERE a.id=$1 AND l.key_hash=$2 AND l.revoked=FALSE '+
     'AND l.expires_at>NOW() AND a.revoked=FALSE AND a.expires_at>NOW()',[id,token]);
   if(!rows.length)return fail(res,403,'VAULT_DENIED','Artifact or license not authorized');
   const artifact=rows[0];
   if(artifact.universe_id!==null){
    const claimed=req.get('X-BM-Universe')||'';
    if(!/^[1-9][0-9]{0,15}$/.test(claimed)||
       String(artifact.universe_id)!==claimed)
      return fail(res,403,'VAULT_UNIVERSE','Unexpected Roblox universe');
   }
   const keys=decrypted(id,artifact.license_id,artifact);
   return res.json({keys});
  }catch(e){
   console.error('[BLACKMAMER VAULT]',e.message);
   return fail(res,503,'VAULT_UNAVAILABLE','Runtime key service unavailable');
  }
 });
}
module.exports={enabled,store,registerRoutes,isUuid,isKey,encrypted,decrypted};
