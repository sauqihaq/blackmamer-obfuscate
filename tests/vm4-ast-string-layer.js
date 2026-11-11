'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {encodeText,decodeText,protectAstStrings}=require('../ast-string-layer');
const {compile}=require('../blackmamer-vm3');
for(const value of ['LogService','ClearNow','BLACKMAMER','héllo 🌏',
 '\u0000binary\u0001','line\nfeed',''] ){
 for(let i=0;i<20;i++){
  const seed=1+crypto.randomInt(254),encoded=encodeText(value,seed);
  assert.equal(decodeText(encoded,seed),value);
  if(value.length)assert.equal(encoded.includes(Buffer.from(value).toString('hex')),false,
    'Encoded string must not retain original byte sequence verbatim');
 }
}
const ast=[
 {t:'local',name:'who',value:{t:'str',value:'LogService'}},
 {t:'local',name:'protected',value:{t:'call',
  fn:{t:'var',name:'BM_ENCFUNC'},args:[
   {t:'str',value:'premium'},
   {t:'fun',params:[],body:[
    {t:'return',values:[{t:'str',value:'ClearOutput'}]}
   ]}
  ]}},
 {t:'return',values:[{t:'str',value:'ClearCount'}]}
];
const output=protectAstStrings(ast,{ratio:1,minLength:2});
assert.equal(output.count,3);
assert.equal(ast[0].value.t,'aststring');
assert.equal(ast[1].value.args[0].value,'premium');
assert.equal(ast[1].value.args[0].t,'str');
assert.equal(ast[1].value.args[1].body[0].values[0].t,'aststring');
assert.equal(ast[2].values[0].t,'aststring');
const src=[
 'local function apply(a) local name="LogService" return name..a end',
 'local get=BM_ENCFUNC("premium",function() return "ClearOutput" end)',
 'print(apply("!").."|"..get())'
].join('\n');
const compiled=compile(src,{
 hardened:true,protectionLevel:'Maximum',
 vmArchitecture:'seven-independent',
 autoFunctionEncryption:'standalone'});
assert.ok(compiled.astStringEncryption);
assert.ok(compiled.astEncryptedStrings>=4);
assert.ok(compiled.astEncryptedBytes>=20);
assert.equal(compiled.vmInterpreterCount,7);
assert.equal(compiled.generatedKeys.length,0);
assert.doesNotMatch(compiled.code,/LogService|ClearOutput/);
const basic=compile('print("LogService")',{hardened:false});
assert.equal(basic.astEncryptedStrings,0);
console.log('V4 independent AST strings: pre-VM encrypted literals, macro ID compatibility, random literal roundtrips PASS');
