'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const LUAU=path.resolve(process.env.LUAU_BIN||'./luau-build/luau');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bm-vm-user-patterns-'));
// Reduced tests derived from uploaded LuaU scripts. Complete user sources
// are not committed to the public repository.
const cases=[
  [
    "visual-direct-array",
    "local GIFs={{Name=\"Smile\",FPS=12},{Name=\"Wave\",FPS=15},{Name=\"Smile\",FPS=12}}\nlocal list,seen={},{}\nfor _,g in GIFs do\n if not seen[g.Name] then\n   seen[g.Name]=true\n   table.insert(list,{Name=g.Name,FPS=g.FPS})\n end\nend\nprint(#list,list[1].Name,list[2].Name)"
  ],
  [
    "visual-direct-dictionary",
    "local t={top=5,bottom=7}\nlocal total=0\nfor key,value in t do total+=value end\nprint(total)"
  ],
  [
    "visual-effect-handler",
    "local strobe=false\nlocal function eventHandler(effect,phase)\n if effect==\"A1\" and phase==\"down\" then strobe=true\n elseif effect==\"A1\" and phase==\"up\" then strobe=false end\nend\neventHandler(\"A1\",\"down\");print(strobe)\neventHandler(\"A1\",\"up\");print(strobe)"
  ],
  [
    "visual-callback",
    "local event={OnServerInvoke=nil}\nlocal GIFs={{Name=\"One\",Image=\"a\"}}\nevent.OnServerInvoke=function()\n local out={}\n for _,g in GIFs do table.insert(out,{Name=g.Name,Image=g.Image}) end\n return out\nend\nprint(event.OnServerInvoke()[1].Image)"
  ],
  [
    "saweria-pcall",
    "local function requestJson(raw)\n local ok,v=pcall(function()if raw then return {ok=true} else error(\"offline\") end end)\n if not ok then return nil,tostring(v) end\n return v\nend\nlocal a,err=requestJson(false)\nlocal b=requestJson(true)\nprint(a==nil,err~=nil,b.ok)"
  ],
  [
    "saweria-headers",
    "local Config={Connection={SecretHeaderName=\"X-Test\",SecretToken=\"mock\"}}\nlocal request={Headers={[\"content-type\"]=\"application/json\",[Config.Connection.SecretHeaderName]=Config.Connection.SecretToken}}\nprint(request.Headers[\"content-type\"],request.Headers[\"X-Test\"])"
  ],
  [
    "saweria-effect-routing",
    "local function chooseEffect(amount)\n local thresholds={Zeus=100,Mech=50}\n for _,name in ipairs({\"Zeus\",\"Mech\"}) do\n  if amount>=thresholds[name] then return name end\n end\n return nil\nend\nprint(chooseEffect(75),chooseEffect(3)==nil)"
  ],
  [
    "antitcs-normalize",
    "local map={[\"0\"]=\"o\",[\"1\"]=\"i\",[\"@\"]=\"a\",[\"$\"]=\"s\"}\nlocal function normalize(name)\n name=string.lower(tostring(name or \"\"))\n for from,to in pairs(map) do name=string.gsub(name,from,to) end\n return name\nend\nprint(normalize(\"TCSM0D\")==\"tcsmod\")"
  ],
  [
    "antitcs-ban",
    "local Players={BanAsync=function(self,data) return data.UserIds[1],data.ApplyToUniverse,data.Duration end}\nlocal function ban(player)\n local ok,res=pcall(function()\n  local id,all,duration=Players:BanAsync({UserIds={player.UserId},ApplyToUniverse=true,Duration=-1})\n  return tostring(id)..\":\"..tostring(all)..\":\"..tostring(duration)\n end)\n return ok,res\nend\nlocal ok,res=ban({UserId=10});print(ok,res)"
  ],
  [
    "iterator-continue",
    "local total=0\nfor k,v in {5,6,7,8} do\n if v%2==0 then continue end\n total+=v\nend\nprint(total)"
  ],
  [
    "nested-closures",
    "local values={a=3,b=9}\nlocal function outer(x)\n return function()\n  local sum=0\n  for k,v in values do sum+=v end\n  return sum*x\n end\nend\nprint(outer(2)())"
  ]
];

function run(source,name){
 const file=path.join(temp,name+'.luau');fs.writeFileSync(file,source,'utf8');
 const child=spawnSync(LUAU,[file],{encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
 if(child.status!==0||child.error)
   throw new Error(name+': '+(child.stderr||child.error?.message||child.stdout));
 return (child.stdout||'').trim().replace(/\r\n/g,'\n');
}
try{
 let passed=0;
 for(const [name,source] of cases){
  const expected=run(source,name+'-plain');
  for(const mode of ['tree','shard']){
   for(let variant=0;variant<3;variant++){
    const out=compile(source,{antiTamper:true,antiDebug:true,dispatchMode:mode});
    assert.equal(out.dispatchStructure,mode);
    assert.ok(out.code.includes('BLACKMAMER VM V3'));
    const actual=run(out.code,name+'-'+mode+'-'+variant);
    assert.equal(actual,expected,name+'/'+mode+'/'+variant);
    passed++;
   }
  }
  console.log('PASS',name,expected.replace(/\n/g,' | '));
 }
 console.log('PASS '+passed+'/'+passed+' Luau comparisons covering all 3 user script patterns');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
