'use strict';
// Pure compatibility probe. Does not alter production until parity passes.
// Run pinned upstream Prometheus all-step custom preset -> BLACKMAMER Maximum.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile}=require('../blackmamer-vm3');
const home=path.resolve(__dirname,'../vendor/prometheus');
const config=path.resolve(__dirname,'../prometheus-maximal.lua');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-prom-full-'));
const cases=[
  ['basic','local function f(n)local total=0 for i=1,n do total=total+i end return total end print(f(7))'],
  ['varargs','local function f(...)return select("#",...), ... end print(f(1,nil,3))'],
  ['closures','local function f(x)return function(y)return x+y end end print(f(7)(9))']
];
try {
 for(const target of ['LuaU','Lua51']){
  for(const [label,source] of cases){
   const infile=path.join(dir,'source.lua'),outfile=path.join(dir,'output.lua');
   fs.writeFileSync(infile,source);
   const t=Date.now();
   const p=spawnSync('lua5.1',['cli.lua','--config',config,
     target==='LuaU'?'--LuaU':'--Lua51','--nocolors','--out',outfile,infile],
     {cwd:home,encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
   if(p.error||p.status!==0){
      console.log('FULL_PROBE',target,label,'PROMETHEUS_ERROR',
       String(p.stderr||p.error?.message||p.stdout||'').slice(-1000));
      continue;
   }
   const data=fs.readFileSync(outfile,'utf8'),bytes=Buffer.byteLength(data);
   if(bytes>128*1024){
      console.log('FULL_PROBE',target,label,'TOO_LARGE',bytes,'ms',Date.now()-t);
      continue;
   }
   try{
     const result=compile(data,{
       hardened:true,target,protectionLevel:'Maximum',vmArchitecture:'seven-independent',
       autoFunctionEncryption:'standalone',doubleVmOptimized:true,doubleVmFull:true,
       antiTamper:true,antiDebug:true
     });
     console.log('FULL_PROBE',target,label,'COMPILE_OK',JSON.stringify({
       prometheusBytes:bytes,blackmamerBytes:Buffer.byteLength(result.code),
       vmInstructions:result.vmInstructions,functions:result.virtualizedFunctions,
       ms:Date.now()-t
     }));
   }catch(e){console.log('FULL_PROBE',target,label,'OUTER_ERROR',
       String(e.code||e.name),String(e.message).slice(-500),'innerBytes',bytes,'ms',Date.now()-t)}
  }
 }
}finally{fs.rmSync(dir,{recursive:true,force:true})}
