'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const luau=path.resolve(process.env.LUAU_BIN||'./luau-build/luau');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackmamer-cinematic-'));
function run(text,name){
  const file=path.join(root,name+'.luau');
  fs.writeFileSync(file,text,'utf8');
  const r=spawnSync(luau,[file],{encoding:'utf8',timeout:12000,maxBuffer:1024*1024});
  assert.equal(r.status,0,name+' Luau error: '+(r.stderr||r.error?.message||r.stdout));
  return (r.stdout||'').trim();
}
const programs=[
 ['compound-local','local n=1\nn+=4;n*=2;n-=3;n/=7\nprint(n)'],
 ['compound-index','local t={x=5}\nt.x+=8;t["x"]-=2\nprint(t.x)'],
 ['compound-once','local count=0\nlocal function idx()count+=1;return "n"end\nlocal t={n=4};t[idx()]+=3\nprint(t.n,count)'],
 ['compound-concat','local s="A"\ns..="B"\nprint(s)'],
 ['compound-floor','local x=10\nx//=3\nprint(x)'],
 ['compound-modulo','local x=11\nx%=4;x^=2\nprint(x)'],
 ['floor-division','print(12//5, -7//3)'],
 ['continue-while','local i=0;local sum=0\nwhile i<6 do i+=1;if i%2==0 then continue end;sum+=i end\nprint(sum)'],
 ['continue-numeric','local sum=0\nfor i=1,8 do if i%2==0 then continue end;sum+=i end\nprint(sum)'],
 ['continue-generic','local sum=0\nfor _,v in ipairs({1,2,3,4,5}) do if v<3 then continue end;sum+=v end\nprint(sum)'],
 ['continue-repeat','local i=0;local total=0\nrepeat i+=1;if i<4 then continue end;total+=i until i>=5\nprint(total)'],
 ['continue-scopes','local n=0\nwhile n<4 do n+=1;do local temp=n;if temp<3 then continue end end;print(n) end'],
 ['cinematic-pattern','local sound={destroyed=false,Destroy=function(self)self.destroyed=true end}\nlocal Camera={CameraType="Old"}\nlocal Enum={CameraType={Custom="Custom"}}\nlocal waiting={Completed={Wait=function(self) return true end}}\nlocal gui={Destroy=function(self)self.done=true end}\nCamera.CameraType=Enum.CameraType.Custom\nwaiting.Completed:Wait()\ngui:Destroy()\nif sound then sound:Destroy() end\nlocal isPlaying=true\nisPlaying=false\nprint(Camera.CameraType,sound.destroyed,gui.done,isPlaying)']
];
try {
 let tested=0;
 for(const [name,src] of programs){
   const expected=run(src,name+'-original');
   for(let i=0;i<4;i++){
     const out=compile(src,{antiDebug:true,antiTamper:true});
     assert.ok(out.code.includes('BLACKMAMER VM V3.'));
     const actual=run(out.code,name+'-compiled-'+i);
     assert.equal(actual,expected,name+' build '+i);
     tested++;
   }
   console.log('PASS',name,expected.replace(/\n/g,' | '));
 }
 assert.throws(()=>compile('type MyType = number'),e=>e.code==='V3_UNSUPPORTED_SYNTAX'&&e.offset===0);
 console.log('PASS '+tested+'/'+tested+' native VM LuaU comparisons + syntax location check');
}finally{fs.rmSync(root,{recursive:true,force:true})}
