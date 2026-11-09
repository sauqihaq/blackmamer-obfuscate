'use strict';
// Compare source and standalone V3 bytecode VM output on the official Luau CLI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {compile} = require('../blackmamer-vm3');

const LUAU=process.env.LUAU_BIN||'luau';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackmamer-native-v3-'));
const cases=[
  ['hello','print("Hello World")'],
  ['math','local x=20*5\nlocal bonus=if 1 then 3 else 0\nprint(x+bonus)',false],
  ['arithmetic','local x=20*5\nlocal y = 4^2+3\nprint(x+y)'],
  ['precedence','print(-2^2,2^3^2,10%3)'],
  ['branch','local x=5\nif x>8 then print("no") elseif x==5 then print("yes") else print("oops") end'],
  ['while','local i=1\nlocal s=0\nwhile i<=5 do s=s+i;i=i+1 end\nprint(s)'],
  ['ifexpr','local a=if 7>3 then 100 else 200\nprint(a)'],
  ['fornum','local sum=0\nfor i=1,5 do sum=sum+i end\nprint(sum)'],
  ['forstep','for i=5,1,-2 do print(i) end'],
  ['repeat','local n=0\nrepeat n=n+1 until n==3\nprint(n)'],
  ['break','local i=0\nwhile true do i=i+1;if i==4 then break end end\nprint(i)'],
  ['table','local t={x=3, [4]="a"}\nt.x=t.x+2\nprint(t.x,t[4])'],
  ['closure','local function make(x)\n return function(y) return x+y end\nend\nlocal add=make(11)\nprint(add(4))'],
  ['recursive','local function fact(n)\n if n<=1 then return 1 end\n return n*fact(n-1)\nend\nprint(fact(5))'],
  ['scopes','local n=8\ndo local n=3 end\nprint(n)'],
  ['bool','print(not false, 0 and "yes" or "no", nil or 42)'],
  ['method','local game={GetService=function(self,name) return {Name=name} end}\nprint(game:GetService("Players").Name)'],
  ['strings','print("A\\nB", "halo".." dunia")'],
  ['returns','local function get() return 17 end\nprint(get())'],
  ['global','answer=42\nprint(answer)'],
  ['longstr','print([=[Hello World]=])']
].filter(x=>x[2]!==false);

function execute(src,file){
  const target=path.join(dir,file+'.luau');
  fs.writeFileSync(target,src,'utf8');
  const r=spawnSync(LUAU,[target],{encoding:'utf8',timeout:12000,maxBuffer:4*1024*1024});
  if(r.status!==0 || r.error) throw new Error(file+' errored: '+(r.error?.message||r.stderr||r.stdout));
  return r.stdout.replace(/\r\n/g,'\n').trim();
}
try {
  let ok=0;
  for (const [label,src] of cases) {
    const original=execute(src,label+'-source');
    for(let attempt=0;attempt<3;attempt++){
      const result=compile(src,{antiTamper:true,antiDebug:true});
      assert.equal(result.engine,'BLACKMAMER V3 Native VM');
      assert.ok(result.vmInstructions>0);
      assert.ok(!result.code.includes('Vmify'), 'Standalone runtime should not contain Vmify');
      assert.match(result.code, /local E=\{\{/, 'Bytecode should be sealed in blob entries');
      assert.doesNotMatch(result.code, /local O=\{/, 'No cleartext opcode map');
      assert.doesNotMatch(result.code, /\bO\.(GET|K|CALL|RET|JUMP)\b/, 'No named opcode symbols');
      assert.match(result.code, /op=bxor\(/, 'Opcode should decode using per-function and PC-dependent mask');
      assert.match(result.code, /\(\(op\*\d+\+\d+\)%[567]\)/, 'VM should dispatch through randomized opcode buckets');
      assert.doesNotMatch(result.code, /local P=\{\{\d/, 'P must be decoded on demand');

      const actual=execute(result.code,label+'-v3-'+attempt);
      assert.equal(actual,original,label+' changed output on build '+attempt);
      ok++;
    }
    console.log('PASS',label);
  }
  const first=compile('print("Hello World")');
  const second=compile('print("Hello World")');
  assert.notEqual(first.code,second.code,'VM output must mutate between builds');
  assert.ok(!first.code.includes('Hello World'),'String constant should be encoded');
  assert.throws(()=>compile('local x: number = 1'),/V3_UNSUPPORTED_SYNTAX/);
  assert.throws(()=>compile('continue'),/V3_UNSUPPORTED_SYNTAX/);
  let damaged=first.code.replace(/local CHECK=(\d+)/,(_,n)=>'local CHECK='+String(Number(n)+1));
  assert.notEqual(damaged,first.code);
  const t=path.join(dir,'tampered.luau');
  fs.writeFileSync(t,damaged,'utf8');
  const bad=spawnSync(LUAU,[t],{encoding:'utf8',timeout:10000});
  assert.ok(bad.status!==0,'Edited bytecode must fail integrity verification');
  const changedBlob=first.code.replace(/(local E=\{\{\d+,"\\)(\d{3})/,
    (_match,prefix,byte)=>prefix+String((Number(byte)+1)%256).padStart(3,'0'));
  assert.notEqual(changedBlob,first.code,'Sealed bytecode must have an editable test byte');
  fs.writeFileSync(path.join(dir,'tampered-blob.luau'),changedBlob,'utf8');
  const tampered=spawnSync(LUAU,[path.join(dir,'tampered-blob.luau')],{encoding:'utf8',timeout:10000});
  assert.ok(tampered.status!==0,'Edited encoded bytecode must fail integrity verification');

  console.log('BLACKMAMER Native V3 Luau: '+ok+'/'+ok+' run comparisons passed; mutation, unsupported syntax, tamper tested');
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
