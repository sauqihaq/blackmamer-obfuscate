'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const file=path.resolve(__dirname,'../netlify-frontend/index.html');
const html=fs.readFileSync(file,'utf8');

assert.match(html,/BLACKMAMER STUDIO/);
assert.match(html,/MAXIMUM V4 • AUTO/);
assert.match(html,/value="LuaU" selected/);
assert.match(html,/value="Lua51"/);
assert.match(html,/value="LuaJIT"/);
assert.match(html,/<details class="advanced">/);
for(const obsolete of ['id="runtimeMode"','id="runtimeLicensePanel"',
  'id="runtimeLicense"','id="protectionLevel"','id="autoFunctionEncryption"',
  'id="keysPanel"','id="antiTamper"','id="antiDebug"']){
 assert.ok(!html.includes(obsolete),'One-click UI must hide '+obsolete);
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
byId('target').value='LuaU';
let calls=[],badKeys=false,badProfile=false,wrongTarget=false;
const fetchMock=async(url,options)=>{
 calls.push({url,options});
 if(url.includes('/api/health'))return {ok:true,json:async()=>({status:'ready'})};
 const request=JSON.parse(options.body);
 return {ok:true,json:async()=>({
   obfuscated:'-- BLACKMAMER V4 output\nreturn true',
   engine:'BLACKMAMER V4 Native VM',
   target:wrongTarget?'Lua51':request.target,
   blackmamerVM:{oneClick:true,protectionLevel:badProfile?'Light':'Maximum',
     autoFunctionEncryption:'standalone',nestedVM:true,autoEncryptedFunctions:2,
     applied:true,fallback:false,vmArchitecture:'seven-independent',
     vmInterpreterCount:7,astStringEncryption:true,astEncryptedStrings:3},
   securityModel:{executionContext:request.executionContext||'unspecified',warnings:[]},
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
 assert.equal(p.runtimeMode,'standalone');
 assert.equal(p.executionContext,undefined,'Default one-click supports client or server');
 assert.equal(p.protectionLevel,undefined);
 assert.equal(p.autoFunctionEncryption,undefined);
 assert.equal(p.antiDebug,undefined);
 assert.equal(request.options.headers['X-License-Key'],undefined);
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
 assert.equal(p.executionContext,'portable');
 assert.equal(p.runtimeMode,'standalone');

 byId('target').value='LuaJIT';
 byId('target').handlers.change();
 calls=[];await byId('obfuscate').click();
 request=calls.find(x=>x.url.endsWith('/api/obfuscate'));
 p=JSON.parse(request.options.body);
 assert.equal(p.target,'LuaJIT');

 badKeys=true;
 await byId('obfuscate').click();
 assert.equal(byId('download').disabled,true);
 assert.equal(byId('result').value,'');
 assert.match(byId('feedback').textContent,/provider key tambahan/);
 badKeys=false;

 badProfile=true;
 await byId('obfuscate').click();
 assert.equal(byId('download').disabled,true);
 assert.match(byId('feedback').textContent,/Maximum V4/);
 badProfile=false;

 wrongTarget=true;
 await byId('obfuscate').click();
 assert.equal(byId('download').disabled,true);
 assert.match(byId('feedback').textContent,/Runtime output/);
 wrongTarget=false;

 byId('clear').click();
 calls=[];await byId('obfuscate').click();
 assert.equal(calls.filter(x=>x.url.endsWith('/api/obfuscate')).length,0);
 console.log('V4 universal one-click frontend: Roblox all placements, Maximum-only, optional Lua51/LuaJIT, fails closed PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
