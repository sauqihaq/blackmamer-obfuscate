'use strict';

// Read-only live smoke tests for user's public Netlify + Render site.
// Sends only two small, harmless Luau snippets; no external code executed.
const FRONT='https://blackmamerstudioobfuscated.netlify.app/';
const BACK='https://blackmamer-obfuscate.onrender.com';
const ALT='https://blackmamerstudioobfuscate.netlify.app/';
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const LUAU_BIN=path.resolve(process.env.LUAU_BIN||'./luau-build/luau');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'blackmamer-live-test-'));
const results=[];
const report=(name,ok,info)=>{const entry={test:name,pass:!!ok,...info};results.push(entry);console.log(JSON.stringify(entry));};
async function req(url,options={},timeout=70000){
  const start=Date.now();
  try{
    const res=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(timeout),...options});
    const body=await res.text();
    return {ok:res.ok,status:res.status,finalUrl:res.url,ms:Date.now()-start,headers:res.headers,body};
  }catch(error){
    return {ok:false,status:0,ms:Date.now()-start,error:String(error.cause||error)};
  }
}
function jsonBody(r){try{return JSON.parse(r.body);}catch{return null;}}
async function main(){
  console.log('LIVE BLACKMAMER TEST - '+new Date().toISOString());
  const page=await req(FRONT,{},35000);
  const html=page.body||'';
  report('Netlify website HTTP GET',page.ok && /<html\b/i.test(html),{
    status:page.status,ms:page.ms,url:page.finalUrl||FRONT,
    length:html.length,error:page.error||null,
    title:(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||null
  });
  report('BLACKMAMER UI and NativeV3 selector',page.ok&&html.includes('BLACKMAMER')&&/NativeV3|Native V3/.test(html),{
    brandVisible:html.includes('BLACKMAMER'),
    hasNativeV3:/NativeV3|Native V3/.test(html),
    hasRobloxStrong:html.includes('RobloxStrong'),
    hasUpload:/type=["']file["']/.test(html),
    hasObfuscate:/obfuscat/i.test(html),
    apiReference:html.includes('blackmamer-obfuscate.onrender.com')
  });
  if(!page.ok){
    const alt=await req(ALT,{},25000);
    report('Diagnostic alternate Netlify address (not substitute)',alt.ok&&/<html\b/i.test(alt.body||''),{
      url:alt.finalUrl||ALT,status:alt.status,ms:alt.ms,error:alt.error||null
    });
  }
  const health=await req(BACK+'/api/health',{},100000);
  const healthData=jsonBody(health)||{};
  report('Render backend /api/health',health.ok&&healthData.status==='ready'&&healthData.vm3Available===true,{
    status:health.status,ms:health.ms,health:healthData,error:health.error||null,
    snippet:health.body&&!healthData.status?health.body.slice(0,220):undefined
  });

  const preflight=await req(BACK+'/api/obfuscate',{
    method:'OPTIONS',
    headers:{
      Origin:FRONT.replace(/\/$/,''),
      'Access-Control-Request-Method':'POST',
      'Access-Control-Request-Headers':'content-type'
    }
  },45000);
  const allowOrigin=preflight.headers?.get('access-control-allow-origin')||'';
  const allowMethods=preflight.headers?.get('access-control-allow-methods')||'';
  report('Cross-origin CORS preflight from Netlify',preflight.status>=200&&preflight.status<300
     &&(allowOrigin==='*'||allowOrigin===FRONT.replace(/\/$/,''))&&/POST/i.test(allowMethods),{
      status:preflight.status,ms:preflight.ms,allowOrigin,allowMethods,error:preflight.error||null
  });

  const snippets=[
    {name:'NativeV3 Hello World',script:'print("Hello World")',expected:'Hello World'},
    {name:'NativeV3 numeric for',script:'local sum=0\nfor i=1,5 do sum=sum+i end\nprint(sum)',expected:'15'}
  ];
  for(const item of snippets){
    const payload={script:item.script,preset:'NativeV3',target:'LuaU',
      vmMode:'native-v3',blackmamerVM:true,antiTamper:true,antiDebug:true};
    const res=await req(BACK+'/api/obfuscate',{
      method:'POST',
      headers:{'content-type':'application/json','origin':FRONT.replace(/\/$/,'')},
      body:JSON.stringify(payload)
    },120000);
    const data=jsonBody(res)||{};
    const output=data.obfuscated||'';
    const metadata=data.blackmamerVM||{};
    const valid=res.ok&&typeof output==='string'&&output.length>150
      &&output.includes('BLACKMAMER VM V3.')
      &&metadata.mode==='native-v3'&&metadata.fallback===false;
    report(item.name+' HTTP compile',valid,{
      status:res.status,ms:res.ms,engine:data.engine||null,
      outputBytes:Buffer.byteLength(output),bannerVersion:(output.match(/BLACKMAMER VM V[\d.]+/)||[])[0]||null,
      mode:metadata.mode||null,fusedInstructions:metadata.fusedInstructions??null,
      fallback:metadata.fallback??null,
      encryptedLiteral:!output.includes(item.expected),
      error:data.error||res.error||null,detail:data.detail||null,
      responseSnippet:!res.ok?(res.body||'').slice(0,250):undefined
    });
    // Numeric text ("15") may appear inside an unrelated opcode/seed. Never
    // treat substring matches in obfuscated code as proof of literal leakage.
    if(valid){
      const stem=item.name.includes('Hello')?'hello':'for';
      const input=path.join(scratch,stem+'.source.luau');
      const compiled=path.join(scratch,stem+'.compiled.luau');
      fs.writeFileSync(input,item.script);
      fs.writeFileSync(compiled,output);
      const execute=file=>spawnSync(LUAU_BIN,[file],{encoding:'utf8',timeout:12000,maxBuffer:1024*1024});
      const plain=execute(input),obfuscated=execute(compiled);
      report(item.name+' generated Luau execution matches source',plain.status===0&&obfuscated.status===0
        &&plain.stdout.trim()===item.expected
        &&obfuscated.stdout.trim()===plain.stdout.trim(),{
        originalOutput:plain.stdout.trim().slice(0,100),
        obfuscatedOutput:obfuscated.stdout.trim().slice(0,100),
        originalExit:plain.status,obfuscatedExit:obfuscated.status,
        stderr:(obfuscated.stderr||'').slice(0,400),
        executionError:obfuscated.error?.message||null
      });
    }
  }
  const fail=results.filter(x=>!x.pass);
  console.log('\nRESULT '+(results.length-fail.length)+'/'+results.length+' passed');
  for(const f of fail)console.log('FAILED: '+f.test);
  if(fail.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.rmSync(scratch,{recursive:true,force:true}));
