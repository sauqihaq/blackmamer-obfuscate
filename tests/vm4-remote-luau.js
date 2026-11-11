'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const luau=process.env.LUAU_BIN||'luau';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'blackmamer-remote-vault-'));
const artifactId=crypto.randomUUID();
function execute(src,label){
 const file=path.join(folder,label+'.luau');fs.writeFileSync(file,src,'utf8');
 return spawnSync(luau,[file],{encoding:'utf8',timeout:30000,maxBuffer:1048576});
}
const cases=[
 ['script','local function secure(x)return x*7 end\nprint(secure(6))','42\n'],
 ['module','return {premium=function(x) return x*7 end}','42\n']
];
try{
 let runs=0;
 for(const [type,source,expected] of cases){
  const built=compile(source,{
   hardened:true,protectionLevel:'Maximum',nestedVM:true,antiTamper:true,
   target:'LuaU',autoFunctionEncryption:'external-full',
   remoteRuntime:{artifactId,apiBaseUrl:'https://blackmamer.example'}
  });
  assert.equal(built.autoEncryptedFunctions,built.virtualizedFunctions);
  assert.equal(built.remoteRuntimeEnabled,true);
  assert.equal(built.generatedKeys.length,1);
  const key=built.generatedKeys[0].key;
  assert.equal(built.code.includes(key),false);
  assert.doesNotMatch(built.code,/_BK=_unfold|BlackmamerKeyProvider/);
  assert.match(built.code,/BLACKMAMER_LICENSE/);
  assert.match(built.code,/GetSecret/);
  assert.match(built.code,/https:\/\/blackmamer\.example\/api\/runtime\/key\//);
  const apiMock=k=>[
   'local requests=0',
   'game={GameId=123,GetService=function(self,name)',
   ' if name=="RunService" then return {IsServer=function()return true end} end',
   ' if name=="HttpService" then return {',
   '  GetSecret=function(self,id) if id~="BLACKMAMER_LICENSE"then error("missing secret")end return "FAKE" end,',
   '  RequestAsync=function(self,options)',
   '    requests=requests+1',
   '    assert(options.Headers["X-BM-License"]=="FAKE")',
   '    assert(options.Headers["X-BM-Universe"]=="123")',
   '    assert(options.Method=="POST")',
   '    return {Success=true,StatusCode=200,Body="mock"}',
   '  end,',
   '  JSONDecode=function(self,body) return {keys={BMAUTO_V4='+JSON.stringify(k)+'}} end',
   ' } end',
   ' error("Unexpected service "..name)',
   'end}',
   ''
  ].join('\n');
  const payload=type==='module'?
    'local module=(function(...)\n'+built.code+'\nend)()\nprint(module.premium(6))\n':
    built.code;
  const success=execute(apiMock(key)+payload,'remote-'+type+'-good');
  assert.equal(success.status,0,success.stderr);
  assert.equal(success.stdout,expected);
  const wrong=execute(apiMock(crypto.randomBytes(32).toString('hex'))+payload,
    'remote-'+type+'-wrong');
  assert.notEqual(wrong.status,0,'Wrong runtime key must fail');
  assert.match(wrong.stderr+wrong.stdout,/E[0-9a-f]{12}|key|ciphertext|invalid/i);
  const noHttp=execute('game={GetService=function()error("HTTP disabled")end}\n'+payload,
    'remote-'+type+'-nohttp');
  assert.notEqual(noHttp.status,0,'Missing trusted environment must fail');
  runs++;
 }
 console.log('Native V4 remote vault: '+runs+
   ' Script/ModuleScript executions with no embedded key; wrong key and HTTP errors rejected');
}finally{fs.rmSync(folder,{recursive:true,force:true})}
