'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const LUAU=path.resolve(process.env.LUAU_BIN||'./luau-build/luau');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'blackmamer-multireturn-'));
const cinematic=fs.readFileSync(path.join(__dirname,'fixtures/bm-saweria-donation-cinematic.luau'),'utf8');
const mock=fs.readFileSync(path.join(__dirname,'fixtures/bm-cinematic-roblox-mock.luau'),'utf8');
const programs=[
 ['five-tuple','local function f()\n return "gui", "top", "bottom", "text", "shadow"\nend\nlocal a,b,c,d,e=f()\nprint(a,b,c,d,e)'],
 ['nil-in-tuple','local function f() return nil,"fallback",nil,4 end\nlocal a,b,c,d=f()\nprint(a==nil,b,c==nil,d)'],
 ['multiple-locals','local x,y,z=1,2,3\nlocal function duo() return x,y,z end\nlocal a,b,c=duo()\nprint(a,b,c)'],
 ['tail-expansion','local function inner() return 11,nil,33 end\nlocal function outer() return "first",inner() end\nlocal a,b,c,d=outer()\nprint(a,b,c==nil,d)'],
 ['single-call-tail','local function inner() return "A","B",nil end\nlocal function wrapper() return inner() end\nlocal a,b,c=wrapper()\nprint(a,b,c==nil)'],
 ['pcall-tail','local function operation() return "OK",42 end\nlocal function wrapper() return pcall(operation) end\nlocal ok,a,b=wrapper()\nprint(ok,a,b)'],
 ['explicit-nil','local function returnsNil() return nil end\nlocal function returnsNoValues() return end\nlocal ok,a=pcall(returnsNil)\nlocal yes,b=pcall(returnsNoValues)\nprint(ok,a==nil,yes,b==nil)'],
 ['multireturn-method','local t={hello=function(self)return self.n, "World"end,n=17}\nlocal function run() return t:hello() end\nlocal a,b=run()\nprint(a,b)'],
 ['nested-branches','local function choose(flag)\n if flag then return 1,2,3 end\n return nil,4\nend\nlocal a,b,c=choose(true)\nlocal d,e=choose(false)\nprint(a,b,c,d==nil,e)']
];
function run(code,label){
 const filename=path.join(tmp,label+'.luau');
 fs.writeFileSync(filename,code,'utf8');
 const r=spawnSync(LUAU,[filename],{encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024});
 if(r.status!==0||r.error)throw new Error(label+' failed: '+(r.error?.message||r.stderr||r.stdout));
 return r.stdout.replace(/\r\n/g,'\n').trim();
}
try{
 let successful=0;
 for(const [name,source]of programs){
   const baseline=run(source,'original-'+name);
   for(let seed=0;seed<4;seed++){
     const output=compile(source,{antiTamper:true,antiDebug:true});
     assert.ok(output.code.includes('BLACKMAMER VM V3.'));
     const actual=run(output.code,'compiled-'+name+'-'+seed);
     assert.equal(actual,baseline,name+' build '+seed);
     successful++;
   }
   console.log('PASS',name,baseline.replace(/\n/g,'|'));
 }
 const baseline=run(mock+'\nlocal function startCinematic(...)\n'+cinematic+'\nend\nstartCinematic()\nreportCinematic()','cinematic-original');
 assert.match(baseline,/CINEMATIC_RESULT\s+Custom/);
 for(let seed=0;seed<4;seed++){
   const output=compile(cinematic,{antiTamper:true,antiDebug:true});
   assert.ok(output.vmInstructions>300,'Original cinematic must compile into VM instructions');
   const actual=run(mock+'\nlocal function startCinematic(...)\n'+output.code+'\nend\nstartCinematic()\nreportCinematic()','cinematic-compiled-'+seed);
   assert.equal(actual,baseline,'Full BM Saweria Donation Cinematic changed behavior build '+seed);
   successful++;
 }
 console.log('PASS full user Donation Cinematic, original output: '+baseline);
 console.log('MULTI-RETURN AND USER CINEMATIC: '+successful+'/'+successful+' Luau behavior comparisons passed');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
