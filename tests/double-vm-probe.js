'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const home=path.resolve(__dirname,'../vendor/prometheus');
if(!fs.existsSync(path.join(home,'cli.lua')))throw Error('Prometheus source missing');
const source='local function f(x) local sum=0;for i=1,x do sum=sum+i end;return sum end;print(f(7))';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-double-probe-'));
try{
 for(const target of ['LuaU','Lua51']){
 for(const preset of ['Vmify','Medium','Strong','Weak']){
  const infile=path.join(dir,'input.lua'),outfile=path.join(dir,'output.lua');
  fs.writeFileSync(infile,source);
  const args=['cli.lua','--preset',preset,'--'+target,'--nocolors','--out',outfile,infile];
  const started=Date.now(),p=spawnSync('lua5.1',args,{cwd:home,timeout:35000,encoding:'utf8',maxBuffer:1024*1024});
  if(p.status!==0){console.log('PROBE',target,preset,'PROMETHEUS_ERROR',String(p.stderr||p.error).slice(-700));continue}
  const encoded=fs.readFileSync(outfile,'utf8'),length=Buffer.byteLength(encoded);
  if(length>128*1024){console.log('PROBE',target,preset,'TOO_LARGE',length);continue}
  try{
   const begin=Date.now();
   const result=compile(encoded,{hardened:true,target,protectionLevel:'Maximum',
       vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone',auditBindings:false});
   console.log('PROBE',target,preset,'PASS',JSON.stringify({
     inner:length,outer:Buffer.byteLength(result.code),functions:result.virtualizedFunctions,
     chained:result.chainedInstructionEncoding,elapsed:Date.now()-started,compileMs:Date.now()-begin}));
  }catch(err){console.log('PROBE',target,preset,'OUTER_PARSE_ERROR',err.name,String(err.message).slice(0,700),'inner',length,'atError',encoded.slice(Math.max(0,err.offset-80),err.offset+140),'firstOutput',encoded.slice(0,220))}
 }
 }
}finally{fs.rmSync(dir,{recursive:true,force:true})}
