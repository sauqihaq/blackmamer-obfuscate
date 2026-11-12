'use strict';
// Structural regression for a common static deobfuscator assumption:
// "one build => one global opcode ID map and one operand layout per function".
// This tests real compiler internal allocations without asserting invulnerability.
const assert=require('node:assert/strict');
const {compile}=require('../blackmamer-vm3');

const src=[
 'local function add(a,b) return a+b end',
 'local function mul(a,b) return a*b end',
 'local function wrap(x) return function(y) return add(x,y)+mul(x,y) end end',
 'print(wrap(3)(4))'
].join('\n');
const seenBuilds=new Set();
for(let attempt=0;attempt<12;attempt++){
  const r=compile(src,{hardened:true,nestedVM:true,auditPalettes:true});
  assert.equal(r.perFunctionOpcodePalette,true);
  assert.equal(r.perInstructionOperandRotation,true);
  assert.equal(r.dispatchStructure,'per-function-palette');
  assert.equal(r.dispatcherVariants,2);
  assert.ok(r.scrubbedRuntimeErrors>=10);
  assert.doesNotMatch(r.code,/nativeError\("BLACKMAMER/);
  assert.ok(r.runtimeAliasCount>=30,'VM internal locals must be polymorphic');
  assert.ok(r.virtualizedFunctions>=4);
  assert.equal(r.opcodePaletteFingerprints.length,r.virtualizedFunctions);
  assert.equal(new Set(r.opcodePaletteFingerprints).size,r.virtualizedFunctions,
    'Each function must have an independent randomized opcode alphabet');
  const signature=r.opcodePaletteFingerprints.join('|');
  assert.equal(seenBuilds.has(signature),false,'New build should reshuffle opcode palettes');
  seenBuilds.add(signature);
  // Random literal data can include short words; audit named locals separately.
  assert.ok(r.runtimeAliasCount>=30,'Compiler-owned VM locals are randomized');
  assert.doesNotMatch(r.code,/\b(?:if|elseif) op==\d+\b/,
    'No single static numeric opcode discriminator in V4 dispatcher');
  assert.doesNotMatch(r.code,/opcodePaletteFingerprints/,
    'Test-only palette hashes must never leak into client output');
}
const maximum=compile(src,{hardened:true,nestedVM:true,
  protectionLevel:'Maximum',auditPalettes:true});
assert.ok(maximum.soaPrototypes>=1,'At least one prototype must use SoA in Maximum');
assert.ok(maximum.soaPrototypes<=maximum.virtualizedFunctions);
if(maximum.virtualizedFunctions>1)
 assert.ok(maximum.soaPrototypes<maximum.virtualizedFunctions,
   'Multi-prototype Maximum output must also include AoS instructions');
assert.equal(maximum.bytecodeLayout,'per-prototype-aos-or-soa-shuffled-12-or-16');
const returnSource='local function lit() return 17 end;local function id(v) return v end;print(lit(),id(25))';
const returned=compile(returnSource,{
  hardened:true,protectionLevel:'Maximum',superInstructions:true});
assert.deepEqual(Object.keys(returned.superInstructionKinds),
  ['GETK','KGET','KK','KDECL','KRET','GETRET','MOVRET']);
assert.ok(returned.superInstructionKinds.KRET>=1,
  'A direct literal return should compile to a fused KRET');
assert.ok(returned.superInstructionKinds.GETRET>=1,
  'A direct local-variable return should compile to a fused GETRET');
const v3=compile(src,{hardened:false,auditPalettes:true});
assert.equal(v3.soaPrototypes,0);
assert.equal(v3.perFunctionOpcodePalette,false);
assert.equal(v3.dispatcherVariants,1);
assert.equal(v3.scrubbedRuntimeErrors,0);
assert.equal(v3.perInstructionOperandRotation,false);
assert.ok(v3.opcodePaletteFingerprints.every(x=>x===null),
  'V3 remains unchanged');
console.log('V4 structural audit: 12 independently shuffled builds, per-function palettes, and rotating operands verified');
