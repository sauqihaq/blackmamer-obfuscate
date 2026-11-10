'use strict';
// Production access control for commercial obfuscator deployments.
// Requires DATABASE_URL (PostgreSQL), ADMIN_PASSWORD (>=12 chars),
// ADMIN_SESSION_SECRET (>=32 chars). Enable with LICENSE_ENFORCED=true.
const crypto=require('node:crypto');
const {Pool}=require('pg');
const enforce=process.env.LICENSE_ENFORCED==='true';
const secret=process.env.ADMIN_SESSION_SECRET||'';
const adminPass=process.env.ADMIN_PASSWORD||'';
const adminUser=process.env.ADMIN_USERNAME||'admin';
const configured=Boolean(process.env.DATABASE_URL&&secret.length>=32&&adminPass.length>=12);
const pool=process.env.DATABASE_URL?new Pool({
 connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:6000,
 ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true}:undefined
}):null;
let ready;
const hash=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
const sign=x=>crypto.createHmac('sha256',secret).update(x).digest('base64url');
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const fail=(res,status,error,code)=>res.status(status).json({error,code});
async function setup(){
 if(!pool)throw Error('DATABASE_URL unavailable');
 if(!ready)ready=(async()=>{
  await pool.query('CREATE TABLE IF NOT EXISTS bms_licenses (id UUID PRIMARY KEY,key_hash CHAR(64) UNIQUE NOT NULL,key_prefix VARCHAR(22) NOT NULL,customer VARCHAR(120) NOT NULL,plan VARCHAR(24) NOT NULL,daily_limit INTEGER NOT NULL CHECK(daily_limit BETWEEN 1 AND 20000),expires_at TIMESTAMPTZ NOT NULL,revoked BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_used_at TIMESTAMPTZ)');
  await pool.query('CREATE TABLE IF NOT EXISTS bms_usage (license_id UUID NOT NULL REFERENCES bms_licenses(id) ON DELETE CASCADE,usage_day DATE NOT NULL,used INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(license_id,usage_day))');
  await pool.query('CREATE TABLE IF NOT EXISTS bms_events (id BIGSERIAL PRIMARY KEY,license_id UUID REFERENCES bms_licenses(id) ON DELETE SET NULL,kind VARCHAR(24) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  await pool.query('CREATE INDEX IF NOT EXISTS bms_events_created ON bms_events(created_at DESC)');
 })().catch(e=>{ready=null;throw e});
 return ready;
}
const shape=r=>({
 id:r.id,prefix:r.key_prefix,customer:r.customer,plan:r.plan,
 dailyLimit:r.daily_limit,usedToday:Number(r.used_today||0),expiresAt:r.expires_at,
 revoked:r.revoked,createdAt:r.created_at,lastUsedAt:r.last_used_at,
 status:r.revoked?'revoked':new Date(r.expires_at).getTime()<=Date.now()?'expired':'active'
});
async function findKey(key){
 await setup();
 if(typeof key!=='string'||!/^BM-[A-F0-9-]{35,45}$/.test(key))return null;
 const {rows}=await pool.query("SELECT l.*,COALESCE(u.used,0) AS used_today FROM bms_licenses l LEFT JOIN bms_usage u ON u.license_id=l.id AND u.usage_day=(NOW() AT TIME ZONE 'UTC')::date WHERE key_hash=$1",[hash(key.trim())]);
 return rows[0]||null;
}
const attempts=new Map();
function sessionToken(){
 const payload=Buffer.from(JSON.stringify({role:'admin',exp:Date.now()+8*60*60*1000,nonce:crypto.randomBytes(12).toString('hex')})).toString('base64url');
 return payload+'.'+sign(payload);
}
function isAdmin(req){
 const token=String(req.headers.authorization||'').match(/^Bearer (\S+)$/)?.[1];
 if(!token||!configured)return false;
 const parts=token.split('.');
 if(parts.length!==2||!equal(sign(parts[0]),parts[1]))return false;
 try{const p=JSON.parse(Buffer.from(parts[0],'base64url').toString());return p.role==='admin'&&Number.isFinite(p.exp)&&Date.now()<p.exp}catch{return false}
}
function admin(req,res,next){if(!isAdmin(req))return fail(res,401,'Sesi admin tidak valid.','ADMIN_UNAUTHORIZED');next()}
function dateEnd(x){if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return null;const v=new Date(x+'T23:59:59.999Z');return Number.isFinite(v.getTime())&&v.getTime()>Date.now()?v:null}
async function gate(req,res,next){
 if(!enforce)return next();
 if(!configured)return fail(res,503,'Lisensi belum dikonfigurasi di Render.','LICENSE_NOT_CONFIGURED');
 // Invalid request bodies are rejected by existing API validation, uncharged.
 if(typeof req.body?.script!=='string'||!req.body.script.trim()||Buffer.byteLength(req.body.script)>1024*1024)return next();
 const key=req.headers['x-license-key'];
 if(typeof key!=='string'||key.length>120)return fail(res,401,'Masukkan lisensi aktif.','LICENSE_REQUIRED');
 let db;
 try{
  await setup();db=await pool.connect();await db.query('BEGIN');
  const {rows}=await db.query('SELECT * FROM bms_licenses WHERE key_hash=$1 FOR UPDATE',[hash(key.trim())]);
  const lic=rows[0];
  if(!lic||lic.revoked||new Date(lic.expires_at).getTime()<=Date.now()){
   await db.query('ROLLBACK');return fail(res,403,'Lisensi tidak aktif atau kedaluwarsa.','LICENSE_INVALID')
  }
  const hit=await db.query("INSERT INTO bms_usage(license_id,usage_day,used) VALUES($1,(NOW() AT TIME ZONE 'UTC')::date,1) ON CONFLICT(license_id,usage_day) DO UPDATE SET used=bms_usage.used+1 WHERE bms_usage.used<$2 RETURNING used",[lic.id,lic.daily_limit]);
  if(!hit.rowCount){await db.query('ROLLBACK');return fail(res,429,'Kuota harian sudah habis.','QUOTA_EXCEEDED')}
  await db.query('UPDATE bms_licenses SET last_used_at=NOW() WHERE id=$1',[lic.id]);
  await db.query('INSERT INTO bms_events(license_id,kind) VALUES($1,$2)',[lic.id,'obfuscate']);
  await db.query('COMMIT');req.bmsLicense={id:lic.id,plan:lic.plan};next();
 }catch(e){if(db)try{await db.query('ROLLBACK')}catch{}console.error('[LICENSE]',e.message);fail(res,503,'Database lisensi tidak tersedia.','LICENSE_DB_ERROR')}
 finally{db?.release()}
}
function registerRoutes(app){
 app.get('/api/access/config',(_req,res)=>res.json({licensingEnabled:enforce,adminAvailable:configured,manualPayments:true,revision:'commercial-v1'}));
 app.post('/api/access/check',async(req,res)=>{
  if(!enforce)return res.json({active:true,preview:true,plan:'Preview',dailyLimit:null,usedToday:0});
  if(!configured)return fail(res,503,'Lisensi belum dikonfigurasi.','LICENSE_NOT_CONFIGURED');
  try{const r=await findKey(req.body?.key);
   if(!r||shape(r).status!=='active')return fail(res,403,'Lisensi tidak valid atau sudah kedaluwarsa.','LICENSE_INVALID');
   const v=shape(r);res.json({active:true,plan:v.plan,customer:v.customer,dailyLimit:v.dailyLimit,usedToday:v.usedToday,expiresAt:v.expiresAt,prefix:v.prefix});
  }catch(e){console.error('[LICENSE CHECK]',e.message);fail(res,503,'Database tidak tersedia.','LICENSE_DB_ERROR')}
 });
 app.post('/api/admin/login',async(req,res)=>{
  if(!configured)return fail(res,503,'Admin belum dikonfigurasi: DATABASE_URL, ADMIN_PASSWORD, ADMIN_SESSION_SECRET.','ADMIN_NOT_CONFIGURED');
  const ip=String(req.ip||req.socket.remoteAddress||'remote').slice(0,90);
  const entry=attempts.get(ip)||{count:0,until:0};
  if(entry.until>Date.now())return fail(res,429,'Terlalu banyak percobaan. Coba lagi nanti.','RATE_LIMIT');
  const good=equal(hash(req.body?.password||''),hash(adminPass))&&equal(String(req.body?.username||''),adminUser);
  if(!good){entry.count++;entry.until=entry.count>=7?Date.now()+15*60*1000:0;
   attempts.set(ip,entry);if(attempts.size>1000)attempts.clear();
   return fail(res,401,'Username atau password salah.','WRONG_CREDENTIALS')}
  attempts.delete(ip);
  try{await setup();res.json({token:sessionToken(),expiresInSeconds:28800,username:adminUser})}
  catch(e){console.error('[ADMIN DB]',e.message);fail(res,503,'Database admin belum tersedia.','ADMIN_DB_ERROR')}
 });
 app.get('/api/admin/summary',admin,async(req,res)=>{
  try{await setup();
   const [count,trend,recent]=await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE NOT revoked AND expires_at>NOW())::int AS active,COUNT(*) FILTER(WHERE revoked)::int AS revoked,COUNT(*) FILTER(WHERE expires_at<=NOW() AND NOT revoked)::int AS expired FROM bms_licenses'),
    pool.query("SELECT usage_day::text AS day,SUM(used)::int AS count FROM bms_usage WHERE usage_day>=((NOW() AT TIME ZONE 'UTC')::date-6) GROUP BY usage_day ORDER BY usage_day"),
    pool.query('SELECT e.kind,e.created_at,l.key_prefix,l.customer FROM bms_events e LEFT JOIN bms_licenses l ON l.id=e.license_id ORDER BY e.id DESC LIMIT 12')
   ]);res.json({counts:count.rows[0],trend:trend.rows,recent:recent.rows});
  }catch(e){console.error('[ADMIN SUMMARY]',e.message);fail(res,503,'Gagal memuat statistik.','ADMIN_DB_ERROR')}
 });
 app.get('/api/admin/licenses',admin,async(req,res)=>{
  try{await setup();const {rows}=await pool.query("SELECT l.*,COALESCE(u.used,0) AS used_today FROM bms_licenses l LEFT JOIN bms_usage u ON u.license_id=l.id AND u.usage_day=(NOW() AT TIME ZONE 'UTC')::date ORDER BY l.created_at DESC LIMIT 500");
   res.json({licenses:rows.map(shape)});
  }catch(e){console.error('[ADMIN LIST]',e.message);fail(res,503,'Gagal memuat lisensi.','ADMIN_DB_ERROR')}
 });
 app.post('/api/admin/licenses',admin,async(req,res)=>{
  const customer=typeof req.body?.customer==='string'?req.body.customer.trim().slice(0,120):'';
  const plan=req.body?.plan,limit=Number(req.body?.dailyLimit),end=dateEnd(req.body?.expiresAt);
  if(!customer||!['Starter','Creator','Studio'].includes(plan)||!Number.isSafeInteger(limit)||limit<1||limit>20000||!end)
   return fail(res,400,'Nama, paket, kuota, dan tanggal kedaluwarsa harus valid.','INVALID_LICENSE');
  const key='BM-'+crypto.randomBytes(18).toString('hex').toUpperCase().match(/.{1,6}/g).join('-');
  try{await setup();const {rows}=await pool.query('INSERT INTO bms_licenses(id,key_hash,key_prefix,customer,plan,daily_limit,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[crypto.randomUUID(),hash(key),key.slice(0,16),customer,plan,limit,end]);
   await pool.query('INSERT INTO bms_events(license_id,kind) VALUES($1,$2)',[rows[0].id,'issued']);
   res.status(201).json({license:shape(rows[0]),key,warning:'Kunci hanya ditampilkan sekali. Simpan dan kirim secara privat.'});
  }catch(e){console.error('[ADMIN CREATE]',e.message);fail(res,503,'Gagal membuat lisensi.','ADMIN_DB_ERROR')}
 });
 app.patch('/api/admin/licenses/:id',admin,async(req,res)=>{
  if(!/^[a-f0-9-]{36}$/i.test(req.params.id))return fail(res,400,'ID tidak valid.','INVALID_ID');
  const b=req.body||{},parts=[],args=[];
  if(typeof b.revoked==='boolean'){args.push(b.revoked);parts.push('revoked=$'+args.length)}
  if(b.customer!==undefined){const name=typeof b.customer==='string'?b.customer.trim().slice(0,120):'';if(!name)return fail(res,400,'Nama tidak valid.','INVALID_CUSTOMER');args.push(name);parts.push('customer=$'+args.length)}
  if(b.plan!==undefined){if(!['Starter','Creator','Studio'].includes(b.plan))return fail(res,400,'Paket tidak valid.','INVALID_PLAN');args.push(b.plan);parts.push('plan=$'+args.length)}
  if(b.dailyLimit!==undefined){const n=Number(b.dailyLimit);if(!Number.isSafeInteger(n)||n<1||n>20000)return fail(res,400,'Kuota tidak valid.','INVALID_QUOTA');args.push(n);parts.push('daily_limit=$'+args.length)}
  if(b.expiresAt!==undefined){const d=dateEnd(b.expiresAt);if(!d)return fail(res,400,'Tanggal tidak valid.','INVALID_DATE');args.push(d);parts.push('expires_at=$'+args.length)}
  if(!parts.length)return fail(res,400,'Tidak ada perubahan.','NO_CHANGES');
  args.push(req.params.id);
  try{await setup();const {rows}=await pool.query('UPDATE bms_licenses SET '+parts.join(',')+',updated_at=NOW() WHERE id=$'+args.length+' RETURNING *',args);
   if(!rows.length)return fail(res,404,'Lisensi tidak ditemukan.','NOT_FOUND');
   await pool.query('INSERT INTO bms_events(license_id,kind) VALUES($1,$2)',[req.params.id,b.revoked===true?'revoked':b.revoked===false?'restored':'updated']);
   res.json({license:shape(rows[0])});
  }catch(e){console.error('[ADMIN UPDATE]',e.message);fail(res,503,'Gagal memperbarui lisensi.','ADMIN_DB_ERROR')}
 });
}
module.exports={registerRoutes,gate};
