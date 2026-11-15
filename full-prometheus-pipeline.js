'use strict';
// Full Prometheus 11-step prepass, then BLACKMAMER Maximum V4.
// Every retry executes the same complete security stack with fresh randomized
// output. No fallback to Vmify-only, lighter presets or unprotected code.
const {compile}=require('./blackmamer-vm3');
const {preprocess,PrometheusStageError,FULL_STEPS}=require('./prometheus-stage');
const MAX_ATTEMPTS=5;
const RETRYABLE_CODES=new Set([
  'PROMETHEUS_OUTPUT_TOO_LARGE','PROMETHEUS_STAGE_FAILED',
  'V3_UNSUPPORTED_SYNTAX'
]);
async function compileFull(source,target,options={},maxAttempts=MAX_ATTEMPTS){
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>MAX_ATTEMPTS)
    throw new TypeError('maxAttempts out of range');
  let lastError;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    try{
      const stage=await preprocess(source,target,{profile:'full'});
      const result=compile(stage.source,{
        ...options,target,hardened:true,protectionLevel:'Maximum',
        vmArchitecture:'seven-independent',autoFunctionEncryption:'standalone',
        doubleVmFull:true,doubleVmOptimized:true
      });
      return {result,stage:{...stage,meta:{...stage.meta,attempts:attempt,
        allPrometheusSteps:true,steps:FULL_STEPS.slice()}},attempts:attempt};
    }catch(error){
      lastError=error;
      if(!RETRYABLE_CODES.has(error.code))throw error;
    }
  }
  throw new PrometheusStageError('PROMETHEUS_FULL_UNSUPPORTED',
    'Semua 11 langkah Prometheus telah dicoba '+maxAttempts+
    ' kali, tetapi output tidak kompatibel dengan BLACKMAMER Maximum. '+
    'Proses dihentikan tanpa menurunkan tingkat proteksi.',lastError);
}
module.exports={compileFull,MAX_ATTEMPTS};
