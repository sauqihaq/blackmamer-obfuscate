'use strict';
const assert=require('node:assert/strict');
const BASE='https://blackmamer-obfuscate.onrender.com';
const SOURCE='https://raw.githubusercontent.com/sauqihaq/blackmamer-obfuscate/main/tests/fixtures/bm-saweria-donation-cinematic.luau';
const opts={signal:AbortSignal.timeout(120000)};
async function check(){
 const sourceRes=await fetch(SOURCE,{signal:AbortSignal.timeout(30000)});
 assert.equal(sourceRes.status,200,'Exact Donation Cinematic fixture should be accessible');
 const script=await sourceRes.text();
 assert.equal(script.length,6136);
 const healthRes=await fetch(BASE+'/api/health',{signal:AbortSignal.timeout(100000)});
 assert.equal(healthRes.status,200);
 const health=await healthRes.json();
 console.log(JSON.stringify({test:'Render health',status:healthRes.status,vm3Available:health.vm3Available,ready:health.status==='ready'}));
 const started=Date.now();
 const resp=await fetch(BASE+'/api/obfuscate',{
   method:'POST',headers:{'Content-Type':'application/json','Origin':'https://blackmamerstudioobfuscated.netlify.app'},
   body:JSON.stringify({script,preset:'NativeV3',target:'LuaU',vmMode:'native-v3',blackmamerVM:true,antiTamper:true,antiDebug:true}),
   ...opts
 });
 let data;const body=await resp.text();
 try{data=JSON.parse(body)}catch{data={error:'Non-JSON response: '+body.slice(0,240)};}
 const vm=data.blackmamerVM||{};
 const output=data.obfuscated||'';
 console.log(JSON.stringify({
   test:'Exact user Donation Cinematic over public Render',
   status:resp.status,elapsedMs:Date.now()-started,scriptCharacters:script.length,
   outputBytes:Buffer.byteLength(output),engine:data.engine||null,
   mode:vm.mode||null,fallback:vm.fallback??null,instructions:vm.vmInstructions??null,
   fused:vm.fusedInstructions??null,version:(output.match(/BLACKMAMER VM V[\d.]+/)||[])[0]||null,
   error:data.error||null,detail:data.detail||null
 }));
 assert.equal(resp.status,200,'Production backend does not yet support multi-return: '+(data.detail||data.error||resp.status));
 assert.equal(vm.mode,'native-v3');
 assert.equal(vm.fallback,false);
 assert.ok(output.includes('BLACKMAMER VM V3.4'));
 assert.ok(output.length>10000);
 console.log('PASS: Live Render successfully obfuscates exact 6,136-character Donation Cinematic without fallback');
}
check().catch(e=>{console.error(e.stack||e);process.exitCode=1});
