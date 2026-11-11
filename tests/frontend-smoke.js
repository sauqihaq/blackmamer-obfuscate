'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const file=path.resolve(__dirname,'../netlify-frontend/index.html');
const html=fs.readFileSync(file,'utf8');
assert.match(html,/BLACKMAMER STUDIO/);
assert.match(html,/MAXIMUM V4 • AUTO/);
assert.match(html,/value="NativeV4"/);
assert.match(html,/value="Lua51"/);
assert.match(html,/value="LuaJIT"/);
for(const legacy of ['id="protectionLevel"','id="autoFunctionEncryption"',
  'id="keysPanel"','id="sampleProtected"','id="antiTamper"','id="antiDebug"']){
 assert.ok(!html.includes(legacy),'One-click user must not see '+legacy);
}
const match=html.match(/<script>\s*([\s\S]*?)<\/script>/);
assert.ok(match,'Missing embedded frontend script');
const compiled=new vm.Script(match[1],{filename:file});
const elements=new Map();
function byId(id){
 if(!elements.has(id)){
  const handlers={};
  elements.set(id,{id,handlers,textContent:'',value:'',checked:false,disabled:false,
    hidden:false,style:{},className:'',focus(){},select(){},
    addEventListener(event,handler){handlers[event]=handler},
    click(){return handlers.click&&handlers.click()}});
 }
 return elements.get(id);
}
byId('preset').value='NativeV4';
byId('target').value='LuaU';
let calls=[],badKeys=false;
const fetchMock=async(url,options)=>{
 calls.push({url,options});
 return url.includes('/api/health')?
  {ok:true,json:async()=>({status:'ready'})}:
  {ok:true,json:async()=>({
    obfuscated:'-- BLACKMAMER V4 output\nreturn true',
    engine:'BLACKMAMER V4 Native VM',
    blackmamerVM:{oneClick:true,protectionLevel:'Maximum',autoFunctionEncryption:'standalone',
      nestedVM:false,autoEncryptedFunctions:2,applied:true,fallback:false,
      vmArchitecture:'seven-independent',vmInterpreterCount:7,
      astStringEncryption:true,astEncryptedStrings:3},
    externalKeys:badKeys?[{id:'premium',key:'a1'.repeat(32)}]:[]
  })};
};
const sandbox={
 document:{getElementById:byId,
  createElement:()=>({click(){},remove(){}}),body:{appendChild(){}}},
 navigator:{clipboard:{writeText:async()=>{}}},
 URL:{createObjectURL:()=>'',revokeObjectURL(){}},
 Blob,performance,setTimeout,clearTimeout,AbortController,fetch:fetchMock,console
};
compiled.runInContext(vm.createContext(sandbox));
(async()=>{
 byId('source').value='local function double(n)return n*2 end\nprint(double(5))';
 await byId('obfuscate').click();
 let request=calls.find(x=>x.url.endsWith('/api/obfuscate'));
 assert.ok(request);
 let p=JSON.parse(request.options.body);
 assert.equal(p.preset,'NativeV4');
 assert.equal(p.vmMode,'native-v4');
 assert.equal(p.oneClick,true);
 assert.equal(p.target,'LuaU');
 assert.equal(p.protectionLevel,undefined);
 assert.equal(p.autoFunctionEncryption,undefined);
 assert.equal(p.antiDebug,undefined);
 assert.equal(byId('download').disabled,false);
 assert.equal(byId('engineMetric').textContent,'7');
 assert.equal(byId('astStringMetric').textContent,'3');
 assert.equal(byId('result').value,'-- BLACKMAMER V4 output\nreturn true');
 byId('target').value='Lua51';
 byId('target').handlers.change();
 calls=[];await byId('obfuscate').click();
 request=calls.find(x=>x.url.endsWith('/api/obfuscate'));
 p=JSON.parse(request.options.body);
 assert.equal(p.target,'Lua51');
 badKeys=true;await byId('obfuscate').click();
 assert.equal(byId('download').disabled,true);
 assert.equal(byId('result').value,'');
 assert.match(byId('feedback').textContent,/provider key tambahan/);
 badKeys=false;
 byId('clear').click();
 calls=[];await byId('obfuscate').click();
 assert.equal(calls.filter(x=>x.url.endsWith('/api/obfuscate')).length,0);
 console.log('V4 one-click frontend: Maximum-only UI, Luau/Lua51, no external key panel, rejected key leakage PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
