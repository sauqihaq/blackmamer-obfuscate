'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const luau=process.env.LUAU_BIN||'luau';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'blackmamer-external-key-'));
let runs=0;
function execute(code,name){
  const file=path.join(temp,name+'.luau');
  fs.writeFileSync(file,code,'utf8');
  return spawnSync(luau,[file],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
}
function provider(keys){
  const cases=Object.entries(keys).map(([id,key])=>
    'if id==' + JSON.stringify(id) + ' then return ' + JSON.stringify(key) + ' end').join(';');
  return 'BLACKMAMER_KEY_PROVIDER=function(id) '+cases+
    ';error("key unavailable") end\n';
}
const cases=[
  {name:'multiply',id:'multiply',source:
   'local secure=BM_ENCFUNC("multiply",function(n)return n*7 end)\nprint(secure(6))',expected:'42\n'},
  {name:'captured',id:'inner',source:
   'local secure=BM_ENCFUNC("inner",function(a) local function child(b) return a+b end return child(19) end)\nprint(secure(23))',expected:'42\n'},
  {name:'two-calls',id:'calls',source:
   'local s=BM_ENCFUNC("calls",function(a,b)return a+b end)\nprint(s(5,9),s(1,4))',expected:'14\t5\n'},
  {name:'multi-return',id:'results',source:
   'local s=BM_ENCFUNC("results",function()return "a",9 end)\nlocal a,b=s()\nprint(a,b)',expected:'a\t9\n'},
  {name:'recursive',id:'factorial',source:
   'local s=BM_ENCFUNC("factorial",function(n) local function fact(x) if x<=1 then return 1 end return x*fact(x-1) end return fact(n) end)\nprint(s(5))',expected:'120\n'}
];
try {
  for(const testcase of cases){
    for(let iteration=0;iteration<2;iteration++){
      const encoded=compile(testcase.source,{hardened:true,nestedVM:true,antiTamper:true});
      assert.equal(encoded.generatedKeys.length,1);
      const id=encoded.generatedKeys[0].id;
      assert.equal(id,testcase.id);
      const key=encoded.generatedKeys[0].key;
      assert.equal(encoded.code.includes(key),false);
      const good=execute(provider({[id]:key})+encoded.code,
        testcase.name+'-'+iteration+'-good');
      assert.equal(good.status,0,
        testcase.name+' failed: '+good.stderr+' '+good.stdout);
      assert.equal(good.stdout,testcase.expected,
        testcase.name+' output mismatch');
      runs++;
      const missing=execute(encoded.code,testcase.name+'-'+iteration+'-missing');
      assert.notEqual(missing.status,0,'No provider must fail');
      const wrong=execute(provider({[id]:crypto.randomBytes(32).toString('hex')})+
        encoded.code,testcase.name+'-'+iteration+'-wrong');
      assert.notEqual(wrong.status,0,'Wrong key must fail');
      assert.match(wrong.stderr+wrong.stdout,/invalid|ciphertext|key/i);
    }
  }
  // Verify the Roblox-style provider assignment INSIDE the virtualized
  // source can reference a server-only provider supplied by its host.
  const assignedSource='BLACKMAMER_KEY_PROVIDER=BLACKMAMER_EXTERNAL_PROVIDER\n'+
    'local s=BM_ENCFUNC("runtime",function(n)return n+4 end)\nprint(s(38))';
  const assigned=compile(assignedSource,{hardened:true,nestedVM:true});
  const assignedKey=assigned.generatedKeys[0].key;
  const wrapper='BLACKMAMER_EXTERNAL_PROVIDER=function(id) return '+
    JSON.stringify(assignedKey)+' end\n';
  const assignmentResult=execute(wrapper+assigned.code,'provider-assigned-from-source');
  assert.equal(assignmentResult.status,0,
    'VM global assignment must work: '+assignmentResult.stderr);
  assert.equal(assignmentResult.stdout,'42\n');
  runs++;
  // Automatic external-key mode protects nested function prototypes,
  // leaving only the root bootstrap able to install its server key provider.
  const autoSource='BLACKMAMER_KEY_PROVIDER=BLACKMAMER_EXTERNAL_PROVIDER\n'+
    'local function double(n) return n*2 end\nprint(double(21))';
  const autoExternal=compile(autoSource,{hardened:true,nestedVM:true,
    autoFunctionEncryption:'external'});
  assert.equal(autoExternal.autoEncryptedFunctions,1);
  assert.equal(autoExternal.generatedKeys.length,1);
  assert.equal(autoExternal.generatedKeys[0].id,'BMAUTO_V4');
  const extKey=autoExternal.generatedKeys[0].key;
  assert.equal(autoExternal.code.includes(extKey),false);
  const extWrapper='BLACKMAMER_EXTERNAL_PROVIDER=function(id) return '+
    JSON.stringify(extKey)+' end\n';
  const autoResult=execute(extWrapper+autoExternal.code,'auto-external-good');
  assert.equal(autoResult.status,0,autoResult.stderr);
  assert.equal(autoResult.stdout,'42\n');
  const extMissing=execute(autoExternal.code,'auto-external-missing');
  assert.notEqual(extMissing.status,0);
  const extWrong=execute('BLACKMAMER_EXTERNAL_PROVIDER=function(id) return '+
    JSON.stringify(crypto.randomBytes(32).toString('hex'))+' end\n'+
    autoExternal.code,'auto-external-badkey');
  assert.notEqual(extWrong.status,0);
  runs++;

  // Auto provider resolution from Roblox ServerScriptService requires no
  // source edits. The Luau CLI host is mocked to exercise this exact path.
  const bareAuto=compile('local function half(n)return n/2 end\nprint(half(84))',
    {hardened:true,nestedVM:true,autoFunctionEncryption:'external'});
  const bareKey=bareAuto.generatedKeys[0].key;
  const mockRoblox='game={GetService=function(self,name) return '+
    '{FindFirstChild=function(self,item) return {key=true} end} end}\n'+
    'require=function(module) return function(id) return '+
    JSON.stringify(bareKey)+' end end\n';
  const automatic=execute(mockRoblox+bareAuto.code,'auto-server-provider-resolution');
  assert.equal(automatic.status,0,automatic.stderr);
  assert.equal(automatic.stdout,'42\n');
  runs++;

  // Standalone mode protects the root too, and ships a reconstructible
  // split key: never requires any external module or server key.
  for(const script of [
    'print("standalone-root")',
    'local function square(n) return n*n end\nprint(square(7))',
    'local function outer(a) return function(b) return a+b end end\nprint(outer(11)(31))'
  ]){
    const encoded=compile(script,{hardened:true,nestedVM:true,autoFunctionEncryption:'standalone'});
    assert.equal(encoded.generatedKeys.length,0);
    assert.equal(encoded.autoEncryptedFunctions,encoded.virtualizedFunctions);
    assert.match(encoded.code,/embeddedAutoKey/);
    const name='auto-standalone-'+runs;
    const original=execute(script,name+'-src');
    assert.equal(original.status,0,original.stderr);
    const result=execute(encoded.code,name+'-compiled');
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout,original.stdout);
    runs++;
  }
  const wholeScript='local function add(n) return n+2 end\nprint(add(40))';
  const whole=compile(wholeScript,{hardened:true,protectionLevel:'Strong',
    nestedVM:true,autoFunctionEncryption:'external-full'});
  assert.equal(whole.autoEncryptedFunctions,whole.virtualizedFunctions);
  assert.equal(whole.generatedKeys.length,1);
  const secret=whole.generatedKeys[0].key;
  assert.equal(whole.code.includes(secret),false);
  const host='BLACKMAMER_KEY_PROVIDER=function(id) return '+
    JSON.stringify(secret)+' end\n';
  const wholeGood=execute(host+whole.code,'external-full-root');
  assert.equal(wholeGood.status,0,wholeGood.stderr);
  assert.equal(wholeGood.stdout,'42\n');
  const wholeNoKey=execute(whole.code,'external-full-root-missing');
  assert.notEqual(wholeNoKey.status,0);
  runs++;
  console.log('Native V4 external-function encryption: '+runs+
    ' full Luau output comparisons; missing and wrong keys rejected');
} finally {fs.rmSync(temp,{recursive:true,force:true})}
