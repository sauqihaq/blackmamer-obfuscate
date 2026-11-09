'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const LUAU=path.resolve(process.env.LUAU_BIN||'./luau-build/luau');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'blackmamer-saweria-'));
const source=fs.readFileSync(path.resolve(__dirname,'fixtures/bm-saweria-fake-donate-client.luau'),'utf8');
const mock=fs.readFileSync(path.resolve(__dirname,'fixtures/bm-saweria-roblox-mock.luau'),'utf8');
const snippets=[
 ['ipairs-admin-loop', 'local found=false\nfor _, userId in ipairs({23,55,100}) do\n if userId==100 then found=true;break end\nend\nprint(found)'],
 ['pairs-map', 'local result=0\nfor key, val in pairs({a=1,b=2,c=3}) do result=result+val end\nprint(result)'],
 ['pcall-two-results', 'local ok,v=pcall(function() return "Hi" end)\nprint(ok,v)'],
 ['pcall-nil-value', 'local ok,v=pcall(function() return nil end)\nprint(ok,v==nil)'],
 ['multi-with-tail', 'local x,y,z = 1, pcall(function() return "fine", 123 end)\nprint(x,y,z)',false],
 ['multi-missing', 'local x,y,z=5\nprint(x,y==nil,z==nil)'],
 ['generic-next', 'local t={aa=3}\nfor k,v in next,t,nil do print(k,v) end'],
 ['generic-break', 'local count=0\nfor _,v in ipairs({1,2,3}) do count=count+v;if v==2 then break end end\nprint(count)'],
 ['closure-iterator', 'local funcs={}\nfor _,v in ipairs({5,8}) do\n table.insert(funcs,function()return v end)\nend\nprint(funcs[1](),funcs[2]())'],
 ['error-pcall', 'local ok,msg=pcall(function()error("boom")end)\nprint(ok,msg:find("boom")~=nil)'],
 ['nested-evals', 'local ok,a=pcall(function()return 4 end)\nlocal v= if ok then a*3 else 0\nprint(v)']
].filter(x=>x[2]!==false);
const suffix=String.raw;
const tail=[
'buttons.BMFD_ModeOther.Activated:fire()',
'input.Text="Tester"',
'buttons.BMFD_ValidateBtn.Activated:fire()',
'buttons.BMFD_EffectToggle.Activated:fire()',
'amount.Text="120"',
'buttons.BMFD_SendBtn.Activated:fire()',
'print("SENT",lastSend and lastSend.username,lastSend and lastSend.amount,',
' lastSend and lastSend.message,lastSend and tostring(lastSend.useEffect),',
' "GUI",panel.Visible,status.Text,buttons.BMFD_EffectToggle.Text,',
' targetPreview.Visible,targetName.Text,avatar.Image)'
].join('\n');
function runLua(script,label){
 const file=path.join(temp,label+'.luau');
 fs.writeFileSync(file,script);
 const result=spawnSync(LUAU,[file],{encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
 if(result.status!==0||result.error) throw new Error(label+': '+String(result.error||result.stderr||result.stdout));
 return (result.stdout||'').trim().replace(/\r\n/g,'\n');
}
(async()=>{
 try{
  let cases=0;
  for(const [name,src]of snippets){
    const expected=runLua(src,'source-'+name);
    for(let build=0;build<3;build++){
      const output=compile(src,{antiTamper:true,antiDebug:true});
      assert.equal(output.engine,'BLACKMAMER V3 Native VM');
      const actual=runLua(output.code,'obfuscated-'+name+'-'+build);
      assert.equal(actual,expected,name+' build '+build);
      cases++;
    }
    console.log('PASS',name,expected.replace(/\n/g,' | '));
  }
  assert.ok(source.includes('for _, userId in ipairs('));
  assert.ok(source.includes('local okId, userId = pcall('));
  const expected=runLua(mock+'\nlocal function runClient(...)\n'+source+'\nend\nrunClient()\n'+tail,'saweria-original');
  assert.match(expected,/SENT\s+Tester\s+120\s+welcome\s+false/);
  for(let build=0;build<3;build++){
    const compiled=compile(source,{antiTamper:true,antiDebug:true});
    const actual=runLua(mock+'\nlocal function runClient(...)\n'+compiled.code+'\nend\nrunClient()\n'+tail,'saweria-vm3-'+build);
    assert.equal(actual,expected,'full BM Saweria client GUI simulation changed at build '+build);
    cases++;
  }
  console.log('PASS full BM Saweria source: 3 obfuscated Luau GUI simulations match original');
  console.log('VM3 ROBLOX GENERIC FOR + MULTIRETURN '+cases+'/'+cases+' comparisons PASS');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
