'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {lowerLuau}=require('../luau-compat-lowering');
const {Parser}=require('../blackmamer-vm3');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-luau-compat-'));
const luau=process.env.LUAU_BIN||null;
const lua=process.env.LUA51_BIN||'lua5.1';
function run(bin,src,name){
 const file=path.join(dir,name+'.lua');
 fs.writeFileSync(file,src);
 return spawnSync(bin,[file],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
}
const fixtures=[
 ['compound-and-iter',
 'local total=0;local obj={n=1};local ids={1,2,3,4};'+
 'for _,v in ids do if v==2 then continue end; if v==4 then break end;total+=v;obj.n+=2 end;'+
 'print("LOOP",total,obj.n)'],
 ['once-index',
 'local obj={n=8};local calls=0;'+
 'local function objFn()calls+=1;return obj end;'+
 'local function keyFn()calls+=1;return "n" end;'+
 'objFn()[keyFn()]+=3;print("ONCE",obj.n,calls)'],
 ['nested-continue',
 'local n=0;for i in {1,2,3} do for j in {1,2,3} do '+
 'if j==2 then continue end;if i==2 and j==3 then break end;'+
 'n+=i+j end end;print("NESTED",n)'],
 ['compound-operators',
 'local a=3; a+=2;a*=4;a-=5;a/=3;print("OPS",a)'],
 ['conditional-expression',
 'local x=if 1==2 then 8 elseif 2==2 then 42 else 5;print("IF",x)'],
 ['inherited-string-and-comments',
 'local a=1;local text="a += 9";-- i += 10\n'+
 'a+=2;print("LITERAL",text,a)'],
 ['break-continue-in-repeat',
 'local i=0;local count=0;repeat i+=1;if i==2 then continue end;'+
 'if i==4 then break end;count+=i until i>7;'+
 'print("REPEAT",i,count)'],
 ['plain-code-unchanged',
 'local sum=0;for i=1,4 do sum=sum+i end;print("PLAIN",sum)']
];
let checks=0;
try{
 for(const [id,source] of fixtures){
  const adjusted=lowerLuau(source);
  new Parser(adjusted.source).parse();
  if(id==='plain-code-unchanged'){
   assert.equal(adjusted.applied,false);
   assert.equal(adjusted.source,source);
  }else{
   assert.equal(adjusted.applied,true);
   assert.doesNotMatch(adjusted.source,/\+=|\bcontinue\b/);
  }
  const native=run(lua,adjusted.source,id+'-lua51');
  assert.equal(native.status,0,id+' Lua 5.1 lowered failed: '+native.stderr);
  checks++;
  if(luau){
   const expected=run(luau,source,id+'-luau-original');
   assert.equal(expected.status,0,id+' Luau original failed: '+expected.stderr);
   const got=run(luau,adjusted.source,id+'-luau-lowered');
   assert.equal(got.status,0,id+' Luau lowered failed: '+got.stderr);
   assert.equal(got.stdout,expected.stdout,id+' changed Luau behavior');
   assert.equal(native.stdout,expected.stdout,id+' portable result parity');
   checks+=3;
  }
  console.log('LUAU_LOWERING_CASE',id,adjusted.features.join(','));
 }
 console.log('BLACKMAMER LUAU LOWERING PARITY PASS',checks);
}finally{fs.rmSync(dir,{recursive:true,force:true})}
