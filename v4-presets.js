'use strict';
// Explicit V4 profiles. NativeV4 remains the backwards-compatible API alias.
const PRESETS=Object.freeze({
  fast:Object.freeze({
    protectionLevel:'Light',antiTamper:true,antiDebug:false,
    nestedVM:false,vmArchitecture:'single',bytecodeLayout:'aos',
    dispatchFamilies:1,superInstructions:true,autoFunctionEncryption:'off'
  }),
  balanced:Object.freeze({
    protectionLevel:'Strong',antiTamper:true,antiDebug:true,
    nestedVM:true,vmArchitecture:'nested',bytecodeLayout:'poly',
    dispatchFamilies:3,superInstructions:true,autoFunctionEncryption:'off'
  }),
  paranoid:Object.freeze({
    protectionLevel:'Maximum',antiTamper:true,antiDebug:true,
    nestedVM:true,vmArchitecture:'nested',bytecodeLayout:'soa',
    dispatchFamilies:3,superInstructions:true,astStringEncryption:true,
    autoFunctionEncryption:'external-full'
  })
});
function getPreset(name){
  if(typeof name!=='string'||!Object.hasOwn(PRESETS,name))
    throw new TypeError('Unknown BLACKMAMER preset '+String(name));
  return {...PRESETS[name]};
}
module.exports={PRESETS,getPreset};
