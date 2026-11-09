'use strict';
const assert=require('node:assert/strict');
const {compactLuau}=require('../lua-output-compact');
const {compile}=require('../blackmamer-vm3');

const cases=[
  ['local a = 3\nlocal b = 5\nprint(a+b)', 'local a=3 local b=5 print(a+b)'],
  ['-- start comment\nprint("a -- b") -- tail\nprint("done")','print("a -- b")print("done")'],
  ['local x=1 --[[ multi\nline comment ]]\nprint(x)','local x=1 print(x)'],
  ['local x = 7 - -2\nprint(x)','local x=7- -2 print(x)'],
  ['print([=[hello world]=])','print([=[hello world]=])'],
  ['if true then\n  print("ok")\nend', 'if true then print("ok")end'],
  ['local x=1\nlocal s="\\\\\\\" -- string"\nprint(s,x)', 'local x=1 local s="\\\\\\\" -- string"print(s,x)']
];
for(const [input,expected] of cases)
 assert.equal(compactLuau(input),expected,'Luau compacting changed tokens');
assert.throws(()=>compactLuau('print("unterminated)'),/Unterminated Luau/);
assert.throws(()=>compactLuau('local s=[=[no close'),/Unterminated Luau/);
for(let build=0;build<80;build++){
 const code=compile('local function add(a,b)return a+b end\nprint(add(7,9))',
  {antiTamper:true,antiDebug:true}).code;
 assert.ok(code.startsWith('--[[BLACKMAMER VM V3.4]]return'));
 assert.equal(code.includes('\n'),false,'Generated VM must be one physical line');
 assert.equal(code.includes('\r'),false,'Generated VM must not contain CR');
 assert.ok(code.includes('local E={{'),'Encoded prototype map missing');
 assert.ok(code.includes('local SBOX_MASK=bit32.bxor'),'Hybrid S-Box no longer present');
 assert.equal((code.match(/BLACKMAMER V3 invalid opcode/g)||[]).length,1);
 assert.ok(code.length>1000);
}
console.log('PASS 80 one-line NativeV3 builds and 7 compactor regressions');
