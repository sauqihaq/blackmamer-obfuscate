'use strict';
// Compatibility patch against pinned Prometheus revision:
// ProxifyLocals rewrites "local a,b,c=f()" into wrapped one-result
// expressions, silently breaking Lua's multi-value tail-call expansion.
// Exempt ONLY local declarations that rely on this expansion; all eleven
// obfuscation steps remain enabled for every full-profile compilation.
// Prometheus source: https://github.com/prometheus-lua/Prometheus
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(process.argv[2]||path.join(__dirname,'vendor/prometheus'));
const file=path.join(root,'src','prometheus','steps','ProxifyLocals.lua');
const marker='\tvisitast(ast, function(node)\n';
const insert=[
  '\tvisitast(ast, function(node)',
  '\t\t-- BLACKMAMER compatibility: preserve Lua tail-call multiple returns.',
  '\t\t-- Proxifying missing declaration RHS slots changes "a,b,c=f()"',
  '\t\t-- into three single-valued proxy constructors, losing c.',
  '\t\tif node.kind == AstKind.LocalVariableDeclaration',
  '\t\t\tand #node.symbols > #node.expressions and #node.expressions > 0 then',
  '\t\t\tlocal tail = node.expressions[#node.expressions]',
  '\t\t\tif tail.kind == AstKind.FunctionCallExpression',
  '\t\t\t\tor tail.kind == AstKind.PassSelfFunctionCallExpression',
  '\t\t\t\tor tail.kind == AstKind.VarargExpression then',
  '\t\t\t\tfor _, symbol in ipairs(node.symbols) do disableMetatableInfo(symbol) end',
  '\t\t\tend',
  '\t\tend',
  ''
].join('\n');
let data=fs.readFileSync(file,'utf8');
if(data.includes('BLACKMAMER compatibility: preserve Lua tail-call multiple returns.')){
  console.log('Pinned ProxifyLocals patch already applied');
}else{
  if(data.split(marker).length!==2)throw Error('Pinned ProxifyLocals source has changed; refusing unverified patch');
  data=data.replace(marker,insert);
  fs.writeFileSync(file,data);
  console.log('Pinned Prometheus ProxifyLocals multiple-return patch applied');
}

// The pinned AntiTamper "UseDebug=false" implementation compares source line
// numbers from two protected pcall failures. When its generated code is further
// virtualized by BLACKMAMER, the two calls may traverse separate VM dispatcher
// variants even though both errors are authentic. The host-provided source
// line becomes an unreliable equality signal (false "Tamper Detected!").
// Keep all eleven steps and the remaining AntiTamper pcall/return/error
// integrity checks. Require both errors to have a valid numeric location
// rather than an identical location, which is VM-topology-dependent.
const antiFile=path.join(root,'src','prometheus','steps','AntiTamper.lua');
const antiMark='-- BLACKMAMER V4 nested VM error-location compatibility';
const oldLine='valid = valid and line == line2;';
const newLine='valid = valid and type(line) == "number" and line > 0 and type(line2) == "number" and line2 > 0;';
let anti=fs.readFileSync(antiFile,'utf8');
if(!anti.includes(antiMark)){
  if(anti.split(oldLine).length!==2)
    throw Error('Pinned AntiTamper source changed; refuse unverified patch');
  anti=anti.replace(oldLine,antiMark+'\\n'+newLine);
  fs.writeFileSync(antiFile,anti);
}
console.log('Pinned Prometheus AntiTamper nested-VM error location compatibility patch applied');
