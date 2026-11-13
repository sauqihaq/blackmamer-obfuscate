'use strict';

/**
 * Runtime trust-boundary policy for BLACKMAMER V4.
 *
 * Roblox client scripts are observable by their owner. No standalone
 * encryption mode can make a client-side decryption key secret.
 * This module intentionally keeps unspecified legacy requests compatible.
 */
const CONTEXTS=new Set(['client','server','portable']);
const EXTERNAL=new Set(['external','external-full']);

function checkRuntimePolicy({
  target,runtimeMode='standalone',executionContext,preset='NativeV4',
  autoFunctionEncryption='off',functionKeys
}){
  const context=executionContext===undefined||executionContext===null?
    (runtimeMode==='server-vault'?'server':target==='LuaU'?'unspecified':'portable'):
    executionContext;
  const reject=(code,error)=>({ok:false,code,error,context});
  if(context!=='unspecified'&&!CONTEXTS.has(context))
    return reject('INVALID_EXECUTION_CONTEXT',
      'executionContext must be client, server, or portable.');
  if((context==='client'||context==='server')&&target!=='LuaU')
    return reject('ROBLOX_CONTEXT_REQUIRES_LUAU',
      'Roblox client/server executionContext requires target LuaU.');
  if(runtimeMode==='server-vault'&&context!=='server')
    return reject('SERVER_VAULT_CONTEXT',
      'Remote key vault is only available for Roblox server scripts.');
  if(context==='client'){
    if(runtimeMode!=='standalone')
      return reject('CLIENT_RUNTIME_MODE',
        'LocalScripts must use standalone mode.');
    if(preset==='paranoid'||EXTERNAL.has(autoFunctionEncryption)||
       functionKeys!==undefined&&functionKeys!==null)
      return reject('CLIENT_KEY_POLICY',
        'Client code cannot use external function keys. Keep keyed code on the server.');
  }
  return {ok:true,context};
}

function describeRuntimeSecurity({context,runtimeMode,autoFunctionEncryption,
  externallyKeyedFunctions}){
  const remote=runtimeMode==='server-vault';
  const external=externallyKeyedFunctions>0;
  const keyLocation=remote?'authenticated-server-vault':
    external?'host-key-provider':
    autoFunctionEncryption==='standalone'?'embedded-reconstructible':'not-required';
  const warnings=[];
  if(context==='client'){
    warnings.push(
      'LocalScript bytecode and runtime secrets are observable to the client. Obfuscation only raises analysis cost.');
  }else if(remote){
    warnings.push(
      'Key is fetched by Roblox server only. Authorized or instrumented servers can still observe decrypted bytecode.');
  }else if(context==='server'){
    warnings.push(
      external?'Store the key provider in ServerScriptService; never ReplicatedStorage.':
        'Standalone decrypt material is reconstructible. Use server-vault for a separate server key.');
  }else if(keyLocation==='embedded-reconstructible'){
    warnings.push('Standalone decrypt material is reconstructible from the output.');
  }
  return {executionContext:context,runtimeMode,keyLocation,warnings};
}

module.exports={checkRuntimePolicy,describeRuntimeSecurity};
