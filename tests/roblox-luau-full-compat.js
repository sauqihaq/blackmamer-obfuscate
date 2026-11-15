'use strict';
// Synthetic Roblox-style source (no user code or asset identifiers in git).
// Exercises nested config callbacks, colon calls, module references and Luau
// syntax that previously caused size/parsing failures in full Prometheus.
const assert=require('node:assert/strict');
const {compileFull}=require('../full-prometheus-pipeline');
const {FULL_STEPS}=require('../prometheus-stage');
const source=[
 'local People=game:GetService("Players")',
 'local Storage=game:GetService("ReplicatedStorage")',
 'local Settings=require(Storage:WaitForChild("Settings"))',
 'local Module=require(script.Parent:WaitForChild("Service"))',
 'local Remote=Storage:WaitForChild("RPC")',
 'local handler=Module.new(Settings,{',
 ' clock=os.clock,',
 ' lookup=function(id) return People:GetPlayerByUserId(id) end,',
 ' grant=function(target,level)',
 '  local dm=_G.Manager',
 '  if not dm or not dm:IsLoaded(target) then return false,"Not ready" end',
 '  if type(_G.Refresh)~="function" then return false,"Unavailable" end',
 '  if dm:HasLevel(target,level) then return true,target.Name.." already has "..level end',
 '  dm:SetLevel(target,level,true)',
 '  if not dm:HasLevel(target,level) then return false,"Cannot grant" end',
 '  _G.Refresh(target)',
 '  dm:ForceSave(target)',
 '  return true,level.." given to "..target.Name',
 ' end',
 '})',
 'Remote.OnServerInvoke=function(user,targetId,level)',
 ' return handler.Give(user,targetId,level)',
 'end',
 'People.PlayerRemoving:Connect(handler.Forget)'
].join('\n');
const luauSource=[
 'local keys={1,2,3}',
 'local count=0',
 'for i,v in keys do',
 ' if i==2 then continue end',
 ' count+=v',
 'end',
 'print(count)'
].join('\n');
async function main(){
 let checks=0;
 for(const [name,script] of [['nested-services',source],['luau-syntax',luauSource]]){
  const result=await compileFull(script,'LuaU',{antiTamper:true,antiDebug:true});
  assert.equal(result.stage.meta.allPrometheusSteps,true);
  assert.deepEqual(result.stage.meta.steps,FULL_STEPS);
  assert.equal(result.result.vmInterpreterCount,7);
  assert.equal(result.result.protectedApiBoundary,true);
  assert.equal(result.result.environmentPreflight,true);
  assert.equal(result.result.chainedInstructionEncoding,true);
  if(name==='luau-syntax')
   assert.deepEqual(result.stage.meta.luauCompatibility.slice().sort(),
    ['compound-assignment','continue','generalized-iteration']);
  console.log('FULL_ROBLOX_COMPAT_PASS',JSON.stringify({
   name,sourceBytes:Buffer.byteLength(script),
   intermediateBytes:result.stage.meta.outputBytes,
   outerBytes:Buffer.byteLength(result.result.code),
   instructions:result.result.vmInstructions,
   attempts:result.attempts,lowering:result.stage.meta.luauCompatibility
  }));
  checks++;
 }
 console.log('FULL_ROBLOX_COMPAT_TOTAL_PASS',checks);
}
main().catch(error=>{console.error('FULL_ROBLOX_COMPAT_FAILURE',
 JSON.stringify({code:error.code,name:error.name,reason:String(error.message).slice(0,260),
 cause:error.cause?.message?.slice(0,260)}));process.exitCode=1});
