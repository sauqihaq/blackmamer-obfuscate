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
  console.log('Pinned Prometheus compatibility patch already applied');
  process.exit(0);
}
if(data.split(marker).length!==2)throw Error('Pinned ProxifyLocals source has changed; refusing unverified patch');
data=data.replace(marker,insert);
fs.writeFileSync(file,data);
console.log('Pinned Prometheus ProxifyLocals multiple-return patch applied');
