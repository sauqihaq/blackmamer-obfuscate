'use strict';
const assert=require('node:assert/strict');
const target='https://blackmamer-obfuscate.onrender.com/api/obfuscate';
async function check(script){
 const response=await fetch(target,{
  method:'POST',headers:{'Content-Type':'application/json','Origin':'https://blackmamerstudioobfuscated.netlify.app'},
  body:JSON.stringify({script,preset:'NativeV3',target:'LuaU',vmMode:'native-v3',
   blackmamerVM:true,antiTamper:true,antiDebug:true}),
  signal:AbortSignal.timeout(120000)
 });
 const data=await response.json();
 return {status:response.status,data};
}
(async()=>{
  const syntax=await check('type CinematicTest = number');
  console.log(JSON.stringify({test:'live diagnostic',status:syntax.status,
    message:syntax.data.error||null,position:syntax.data.position||null,detail:syntax.data.detail||null}));
  assert.equal(syntax.status,422);
  assert.equal(syntax.data.position?.line,1);
  assert.equal(syntax.data.position?.column,1);
  assert.match(syntax.data.error,/baris 1, kolom 1/);
  const source='local Camera={CameraType="Scriptable"}\nlocal Enum={CameraType={Custom="Custom"}}\nlocal t=0\nfor i=1,5 do if i%2==0 then continue end;t+=i end\nCamera.CameraType=Enum.CameraType.Custom\nprint(t,Camera.CameraType)';
  const compiled=await check(source);
  const m=compiled.data.blackmamerVM||{};
  console.log(JSON.stringify({test:'live cinematic syntax',status:compiled.status,
    outputBytes:Buffer.byteLength(compiled.data.obfuscated||''),version:(compiled.data.obfuscated||'').match(/BLACKMAMER VM V[\d.]+/)?.[0]||null,
    mode:m.mode||null,fallback:m.fallback??null,error:compiled.data.error||null,detail:compiled.data.detail||null}));
  assert.equal(compiled.status,200);
  assert.equal(m.mode,'native-v3');
  assert.equal(m.fallback,false);
  console.log('PASS live NativeV3 cinematic syntax and line/column error diagnostics');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
