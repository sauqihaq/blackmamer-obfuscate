'use strict';
// Every public runtime target must produce one physical Lua line. We
// preserve quoted literals and executable semantics through separate
// official Luau/Lua5.1/LuaJIT differential regression suites.
const assert=require('node:assert/strict');
const {compile}=require('../blackmamer-vm3');
const {polymorphRuntime}=require('../runtime-polymorph');
const source=[
 'local function greet(x)',
 '  local message="Hi, "..x',
 '  return message',
 'end',
 'print(greet("BLACKMAMER"))'
].join('\n');
const unformatted='local x=1;\n\n  local y=2;\r\nprint(x+y)';
const lexed=polymorphRuntime(unformatted,{rename:false,chaos:true});
assert.doesNotMatch(lexed.code,/[\r\n]/);
for(const target of ['LuaU','Lua51','LuaJIT']){
 for(const protectionLevel of ['Strong','Maximum']){
  for(let build=0;build<2;build++){
   const r=compile(source,{target,hardened:true,protectionLevel,
    vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone'});
   assert.ok(r.code.startsWith('--[[BLACKMAMER VM V4.0]]'));
   assert.doesNotMatch(r.code,/[\r\n]/,`${target} ${protectionLevel} must be a single physical line`);
   assert.equal(r.runtimeChaosLineBreaks,0);
   assert.ok(r.runtimeAliasCount>=20);
   if(protectionLevel==='Maximum'){
    assert.equal(r.vmInterpreterCount,7);
    assert.equal(r.metatableEntrypoint,true);
   }
  }
 }
}
console.log('V4 single-line: 3 runtimes x 2 protection levels x 2 builds, no CR/LF PASS');
