'use strict';
const assert=require('node:assert/strict');
(async()=>{
  const target='https://blackmamer-obfuscate.onrender.com/api/obfuscate';
  const srcUrl='https://raw.githubusercontent.com/sauqihaq/blackmamer-obfuscate/main/tests/fixtures/bm-saweria-fake-donate-client.luau';
  const res=await fetch(srcUrl,{signal:AbortSignal.timeout(25000)});
  assert.equal(res.status,200,'Source fixture should be on main');
  const script=await res.text();
  assert.ok(script.includes('for _, userId in ipairs(Config.Admins.UserIds or {})'));
  assert.ok(script.includes('local okId, userId = pcall('));
  const health=await fetch('https://blackmamer-obfuscate.onrender.com/api/health',{signal:AbortSignal.timeout(80000)});
  const healthData=await health.json();
  console.log(JSON.stringify({test:'live backend health',status:health.status,data:healthData}));
  const started=Date.now();
  const request=await fetch(target,{
    method:'POST',
    headers:{'content-type':'application/json','origin':'https://blackmamerstudioobfuscated.netlify.app'},
    body:JSON.stringify({script,preset:'NativeV3',target:'LuaU',vmMode:'native-v3',
      blackmamerVM:true,antiTamper:true,antiDebug:true}),
    signal:AbortSignal.timeout(120000)
  });
  const text=await request.text();
  let result;
  try{result=JSON.parse(text)}catch{throw new Error('Non-JSON API: '+text.slice(0,300))}
  const output=result.obfuscated||'';
  console.log(JSON.stringify({test:'live BM Saweria NativeV3',
    httpStatus:request.status,ms:Date.now()-started,sourceBytes:Buffer.byteLength(script),
    outputBytes:Buffer.byteLength(output),engine:result.engine||null,
    mode:result.blackmamerVM?.mode||null,vmInstructions:result.blackmamerVM?.vmInstructions??null,
    fused:result.blackmamerVM?.fusedInstructions??null,
    fallback:result.blackmamerVM?.fallback??null,
    version:(output.match(/BLACKMAMER VM V[\d.]+/)||[])[0]||null,
    error:result.error||null,detail:result.detail||null
  }));
  assert.equal(request.status,200,'Production Render API still rejects BM Saweria source with status '+request.status+': '+(result.detail||result.error));
  assert.equal(result.blackmamerVM?.mode,'native-v3');
  assert.equal(result.blackmamerVM?.fallback,false);
  assert.ok(output.includes('BLACKMAMER VM V3.4'));
  console.log('PASS: full user BM Saweria source compiles on production Render!');
})().catch(err=>{console.error(err.stack||err);process.exitCode=1});
