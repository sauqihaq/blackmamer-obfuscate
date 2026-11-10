'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const file=path.resolve(__dirname,'../netlify-frontend/index.html');
const html=fs.readFileSync(file,'utf8');
assert.match(html,/BLACKMAMER STUDIO/);
assert.match(html,/value="NativeV4"/);
assert.match(html,/id="protectionLevel"/);
assert.match(html,/value="Maximum"/);
assert.match(html,/value="Lua51"/);
assert.match(html,/value="LuaJIT"/);
assert.doesNotMatch(html,/value="NativeV3"|value="RobloxStrong"|value="Weak"/);
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
byId('protectionLevel').value='Strong';
byId('target').value='LuaU';
byId('autoFunctionEncryption').value='standalone';
byId('antiTamper').checked=true;
byId('antiDebug').checked=true;
let calls=[];
const fetchMock=async(url,options)=>{
 calls.push({url,options});
 return url.includes('/api/health')?
  {ok:true,json:async()=>({status:'ready'})}:
  {ok:true,json:async()=>({
    obfuscated:'-- BLACKMAMER V4 output\nreturn true',
    engine:'BLACKMAMER V4 Native VM',
    blackmamerVM:{enabled:true,applied:true,nestedVM:true,protectionLevel:'Strong',
      vmInstructions:15,fallback:false},
    externalKeys: options?.body && JSON.parse(options.body).script.includes('BM_ENCFUNC')?
      [{id:'premium',key:'a1'.repeat(32)}]:[]
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
 assert.equal(p.protectionLevel,'Strong');
 assert.equal(p.target,'LuaU');
 assert.equal(p.autoFunctionEncryption,'standalone');
 assert.equal(byId('download').disabled,false);
 assert.equal(byId('result').value,'-- BLACKMAMER V4 output\nreturn true');
 byId('target').value='Lua51';
 byId('protectionLevel').value='Maximum';
 byId('protectionLevel').handlers.change();
 assert.equal(byId('target').disabled,false);
 calls=[];await byId('obfuscate').click();
 request=calls.find(x=>x.url.endsWith('/api/obfuscate'));
 p=JSON.parse(request.options.body);
 assert.equal(p.target,'Lua51');
 assert.equal(p.protectionLevel,'Maximum');
 await byId('sampleProtected').click();
 assert.match(byId('source').value,/BM_ENCFUNC/);
 await byId('obfuscate').click();
 assert.equal(byId('keysPanel').hidden,false);
 assert.match(byId('keysResult').value,/BlackmamerKeyProvider/);
 byId('clear').click();
 assert.equal(byId('keysPanel').hidden,true);
 byId('source').value='';
 calls=[];await byId('obfuscate').click();
 assert.equal(calls.filter(x=>x.url.endsWith('/api/obfuscate')).length,0);
 console.log('V4-only frontend smoke: engine, 5 levels, Lua51 target, output and external keys passed');
})().catch(e=>{console.error(e);process.exitCode=1});
