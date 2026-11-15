'use strict';
// Diagnose semantic differences in Prometheus alone without touching V4.
// Never run untrusted inputs; fixed tiny locally authored test fixture.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),home=path.join(root,'vendor','prometheus');
const full=fs.readFileSync(path.join(root,'prometheus-maximal.lua'),'utf8');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bm-prom-semantic-'));
const input=path.join(dir,'src.lua'),config=path.join(dir,'config.lua'),output=path.join(dir,'out.lua');
const source='local function f()return 6,nil,8 end;local a,b,c=f();print(a,b==nil,c)';
fs.writeFileSync(input,source);
function removeStep(base,name){
 const begin=base.indexOf('    { Name = "'+name+'"');
 if(begin===-1)throw Error('Step missing '+name);
 // Match balanced braces by counting curly delimiters; no external input.
 let depth=0,end=begin;
 for(;end<base.length;end++){
  if(base[end]==='{')depth++;
  if(base[end]==='}'&&--depth===0){end++;break;}
 }
 while(base[end]===','||base[end]==='\n'||base[end]===' ')end++;
 return base.slice(0,begin)+base.slice(end);
}
function exec(bin,args,cwd,timeout=10000){
 return spawnSync(bin,args,{cwd,encoding:'utf8',timeout,maxBuffer:1024*1024});
}
for(const omitted of ['none','ProxifyLocals','AddVararg','SplitStrings',
 'Cff','ConstantArray','NumbersToExpressions','EncryptStrings','WrapInFunction',
 'WatermarkCheck','AntiTamper']){
 let matches=0,wrong=0,compileFail=0,timeout=0,bytes=0;
 for(let attempt=0;attempt<6;attempt++){
  fs.writeFileSync(config,omitted==='none'?full:removeStep(full,omitted));
  const p=exec('lua5.1',['cli.lua','--config',config,'--Lua51','--nocolors',
    '--out',output,input],home,40000);
  if(p.status!==0){compileFail++;continue}
  const s=fs.readFileSync(output,'utf8');
  bytes+=Buffer.byteLength(s);
  const r=exec('lua5.1',[output],home,3000);
  if(r.error?.code==='ETIMEDOUT')timeout++;
  else if(r.status===0&&r.stdout==='6\ttrue\t8\n')matches++;
  else wrong++;
 }
 console.log('PROM_SEMANTIC_ISOLATE',JSON.stringify({
   omitted,matches,wrong,compileFail,timeout,averageBytes:Math.round(bytes/6)
 }));
}
fs.rmSync(dir,{recursive:true,force:true});
