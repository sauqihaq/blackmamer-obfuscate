#!/usr/bin/env node
'use strict';
// Local V4 CLI; --keys-out is mandatory for externally encrypted profiles.
const fs=require('node:fs');
const path=require('node:path');
const {compile}=require('./blackmamer-vm3');
const {getPreset}=require('./v4-presets');
const {checkRuntimePolicy}=require('./runtime-security-policy');
function main(argv){
  const opts={},input=[];
  for(const arg of argv){
    if(arg==='--help'||arg==='-h'){
      console.log('Usage: node cli.js --preset=fast|balanced|paranoid --target=LuaU|Lua51|LuaJIT --context=client|server|portable --out=output.lua [--keys-out=keys.json] input.lua');
      return;
    }
    const match=/^--(preset|target|context|out|keys-out)=(.+)$/.exec(arg);
    if(match)opts[match[1]]=match[2];
    else if(arg.startsWith('--'))throw Error('Unknown option '+arg);
    else input.push(arg);
  }
  if(input.length!==1)throw Error('Exactly one input Lua file is required');
  const preset=opts.preset||'balanced';
  const target=opts.target||'LuaU';
  const profile=getPreset(preset);
  if(!['LuaU','Lua51','LuaJIT'].includes(target))throw Error('Invalid target '+target);
  const policy=checkRuntimePolicy({
    target,preset,executionContext:opts.context,
    autoFunctionEncryption:profile.autoFunctionEncryption
  });
  if(!policy.ok)throw Error(policy.code+': '+policy.error);
  const src=fs.readFileSync(input[0],'utf8');
  const result=compile(src,{hardened:true,target,...profile});
  if(policy.context==='client'&&result.externallyKeyedFunctions>0)
    throw Error('CLIENT_FUNCTION_KEYS: BM_ENCFUNC is server-only. Client code cannot contain keyed functions.');
  if(result.generatedKeys.length&&!opts['keys-out'])
    throw Error(preset+' needs --keys-out=keys.json; configure BLACKMAMER_KEY_PROVIDER before executing output');
  const output=opts.out||input[0]+'.obfuscated.lua';
  if(path.resolve(output)===path.resolve(input[0]))throw Error('Output cannot overwrite input');
  if(opts['keys-out']&&path.resolve(output)===path.resolve(opts['keys-out']))
    throw Error('--keys-out cannot be the output Lua file');
  if(opts['keys-out']){
    fs.writeFileSync(opts['keys-out'],JSON.stringify(result.generatedKeys,null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  fs.writeFileSync(output,result.code+'\n',{flag:'wx'});
  console.log('BLACKMAMER V4 '+preset+' generated '+output+'; watermark '+result.buildWatermark);
  if(policy.context==='client')
    console.warn('Client output is observable; do not embed server secrets or authoritative game logic.');
  if(result.generatedKeys.length)console.log('External keys saved separately: '+opts['keys-out']);
}
try{main(process.argv.slice(2))}catch(error){console.error('BLACKMAMER CLI:',error.message);process.exitCode=1}
