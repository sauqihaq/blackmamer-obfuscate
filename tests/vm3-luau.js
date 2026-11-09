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
  ['nested-prototypes','local function outer(x)\n local function mid(y)\n  local function inner(z) return x+y+z end\n  return inner\n end\n return mid\nend\nprint(outer(1)(2)(3))'],
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
      assert.match(result.code, /buffer\.fromstring/, 'Runtime must materialize bytecode as Luau buffer');
      assert.match(result.code, /buffer\.readu32/, 'VM must stream 32-bit operands through buffer');
      assert.match(result.code, /local function prototype\(fid\)/, 'Prototype decoder must be callable on demand');
      assert.match(result.code, /local function K\(index\)/, 'Constants should decode lazily on access');
      assert.doesNotMatch(result.code, /for k,entry in ipairs\(Q\)/, 'Constants must not unseal during VM startup');
      assert.match(result.code, /off\+\(pc-1\)\*4\*width/, 'PC must use prototype-specific operand width');
      assert.match(result.code, /local SBOX_MASK=bit32\.bxor/, 'Per-build substitution mask must be reconstructed');
      assert.match(result.code, /local width=bufRead\(packed,5\)/, 'Prototype header must carry layout width');
      assert.match(result.code, /local function field\(at,logical\)/, 'VM operands need mapped reads');
      assert.doesNotMatch(result.code, /instructions\[j\]=\{/, 'No eager instruction array allowed');

      assert.ok(['shard','tree'].includes(result.dispatchStructure),'Expected polymorphic VM dispatch');
      assert.equal((result.code.match(/BLACKMAMER V3 invalid opcode/g)||[]).length,1,
        'Only one shared invalid opcode failure is allowed');
      assert.match(result.code,/if not _d[a-f0-9]{10} then nativeError\("BLACKMAMER V3 invalid opcode"\) end/);
      assert.doesNotMatch(result.code, /local P=\{\{\d/, 'P must be decoded on demand');

      const actual=execute(result.code,label+'-v3-'+attempt);
      assert.equal(actual,original,label+' changed output on build '+attempt);
      ok++;
    }
    console.log('PASS',label);
  }
  const roots=new Set();
  for(let build=0;build<30;build++){
    const variant=compile('local function outer(x) return function(y) return x+y end end\nprint(outer(3)(4))').code;
    const entry=/return exec\((\d+),\{\},nil\)/.exec(variant);
    assert.ok(entry,'VM entrypoint prototype missing');
    roots.add(Number(entry[1]));
    assert.match(variant,/local function prototype\(fid\)/,'VM must lazily decode prototype');
  }
  assert.ok(roots.size>=2,'Multiple function inputs should randomize the root prototype ID');

  const hybridSample='local function combo(x) return x+3,nil,x*4 end\nlocal a,b,c=combo(7)\nprint(a,b==nil,c)';
  const expectedHybrid=execute(hybridSample,'hybrid-source');
  for(const width of ['compact','wide']){
    for(const dispatcher of ['tree','shard']){
      for(let trial=0;trial<2;trial++){
        const built=compile(hybridSample,{bytecodeWidth:width,
          dispatchMode:dispatcher,antiTamper:true,antiDebug:true});
        assert.equal(built.bytecodeLayout,'per-prototype-shuffled-12-or-16');
        assert.equal(built.bytecodeWidths[width],built.virtualizedFunctions,
          'Forced prototype width must apply to every VM function');
        assert.equal(built.bytecodeWidths[width==='compact'?'wide':'compact'],0);
        const actualHybrid=execute(built.code,'hybrid-'+width+'-'+dispatcher+'-'+trial);
        assert.equal(actualHybrid,expectedHybrid,
          'Hybrid S-Box and '+width+' layout changed original Luau output');
      }
    }
  }

  const first=compile('print("Hello World")');
  const second=compile('print("Hello World")');
  assert.notEqual(first.code,second.code,'VM output must mutate between builds');
  assert.ok(!first.code.includes('Hello World'),'String constant should be encoded');
  assert.throws(()=>compile('local x: number = 1'),/V3_UNSUPPORTED_SYNTAX/);
  assert.throws(()=>compile('type ObfuscatorTest = number'),/V3_UNSUPPORTED_SYNTAX/);
  let damaged=first.code.replace(/local CHECK=(\d+)/,(_,n)=>'local CHECK='+String(Number(n)+1));
  assert.notEqual(damaged,first.code);
  const t=path.join(dir,'tampered.luau');
  fs.writeFileSync(t,damaged,'utf8');
  const bad=spawnSync(LUAU,[t],{encoding:'utf8',timeout:10000});
  assert.ok(bad.status!==0,'Edited bytecode must fail integrity verification');
  assert.match(first.code,/local _[a-z]{7}=\{"[A-Za-z0-9_-]+"/,
    'Encoded data should start with printable shuffled shards');
  assert.doesNotMatch(first.code,/\\[0-9]{3}/,
    'VM binary must not be emitted as decimal escaped byte strings');
  const damagedSBox=first.code.replace(/(local SBOX_MASK=bit32\.bxor\(SALT%256,)(\d+)/,
    (_match,prefix,value)=>prefix+String(Number(value)^1));
  assert.notEqual(damagedSBox,first.code,'S-Box masking input must be mutable for integrity test');
  const sboxTest=path.join(dir,'tampered-sbox.luau');
  fs.writeFileSync(sboxTest,damagedSBox,'utf8');
  const corruptedSBox=spawnSync(LUAU,[sboxTest],{encoding:'utf8',timeout:10000});
  assert.ok(corruptedSBox.status!==0,'Altered S-Box mask must fail integrity verification');

  const changedBlob=first.code.replace(/(local _[a-z]{7}=\{")([A-Za-z0-9_-])/,
    (_match,prefix,glyph)=>prefix+(glyph==='A'?'B':'A'));
  assert.notEqual(changedBlob,first.code,'Encoded shard must have an editable test byte');
  fs.writeFileSync(path.join(dir,'tampered-blob.luau'),changedBlob,'utf8');
  const tampered=spawnSync(LUAU,[path.join(dir,'tampered-blob.luau')],{encoding:'utf8',timeout:10000});
  assert.ok(tampered.status!==0,'Edited encoded bytecode must fail integrity verification');

  console.log('BLACKMAMER Native V3 Luau: '+ok+'/'+ok+' run comparisons passed; mutation, unsupported syntax, tamper tested');
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
