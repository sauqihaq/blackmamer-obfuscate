'use strict';
/**
 * BLACKMAMER STUDIO V4-only obfuscation API.
 * Independent compiler/VM: no Prometheus code, runtime, or CLI dependency.
 * Source AST -> optional AST decoys -> control-flow transformed VM IR
 * -> native C++ sealed bytecode -> Luau or portable Lua 5.1 runtime.
 */
const express=require('express');
const crypto=require('node:crypto');
const cors=require('cors');
const {compile,SyntaxErrorV3}=require('./blackmamer-vm3');
const {available:nativeAvailable}=require('./native-sealer');
const {registerRoutes,gate:licenseGate}=require('./commercial-access');
const {enabled:vaultEnabled,store:storeRuntimeKey,registerRoutes:registerRuntimeRoutes}=
  require('./runtime-key-vault');
const app=express();
const PORT=Number(process.env.PORT)||10000;
const LEVELS=new Set(['Minify','Light','Medium','Strong','Maximum']);
const TARGETS=new Map([['Lua','Lua51'],['Lua51','Lua51'],['LuaJIT','LuaJIT'],['LuaU','LuaU']]);
const LIMIT_BYTES=128*1024;
const BANNER = `--[[
    ██████╗ ██╗      █████╗  ██████╗██╗  ██╗███╗   ███╗ █████╗ ███╗   ███╗███████╗██████╗     ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗ 
    ██╔══██╗██║     ██╔══██╗██╔════╝██║ ██╔╝████╗ ████║██╔══██╗████╗ ████║██╔════╝██╔══██╗    ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
    ██████╔╝██║     ███████║██║     █████╔╝ ██╔████╔██║███████║██╔████╔██║█████╗  ██████╔╝    ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
    ██╔══██╗██║     ██╔══██║██║     ██╔═██╗ ██║╚██╔╝██║██╔══██║██║╚██╔╝██║██╔══╝  ██╔══██╗    ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
    ██████╔╝███████╗██║  ██║╚██████╗██║  ██╗██║ ╚═╝ ██║██║  ██║██║ ╚═╝ ██║███████╗██║  ██║    ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
    ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝    ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ 
                                              ═══ OBFUSCATED & SECURED BY BLACKMAMER STUDIO ═══
                                             🔗 https://blackmamerstudioobfuscated.netlify.app/
                                                      🛡️ "Code Strong, Stay Protected"
--]]

`;
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({limit:'2mb'}));
registerRoutes(app);
registerRuntimeRoutes(app);

app.get('/',(_req,res)=>res.json({
 service:'blackmamer-obfuscator',status:'ok',engine:'BLACKMAMER Native V4',
 version:'4.2.0',vm:'BLACKMAMER nested VM',preset:'NativeV4',
 runtimeVaultAvailable:vaultEnabled,
 levels:[...LEVELS],targets:[...TARGETS.keys()],nativeSealerAvailable:nativeAvailable()
}));
app.get('/api/health',(_req,res)=>res.json({
 status:'ready',node:true,engine:'BLACKMAMER Native V4',vm4Available:true,
 vm3Available:false,prometheusInstalled:false,defaultTarget:'LuaU',
 targetSupport:['LuaU','Lua51','LuaJIT'],levels:[...LEVELS],
 nativeSealerAvailable:nativeAvailable(),runtimeVaultAvailable:vaultEnabled,
 message:'Independent V4-only compiler; Lua 5.1 uses portable string/bit adapters'
}));
app.post('/api/obfuscate',licenseGate,async(req,res)=>{
 const body=req.body||{};
 const source=body.script;
 const preset=body.preset||'NativeV4';
 const oneClick=body.oneClick===true;
 const runtimeMode=body.runtimeMode||'standalone';
 const remoteRequested=runtimeMode==='server-vault';
 const level=oneClick?'Maximum':(body.protectionLevel||body.presetLevel||'Strong');
 const requestedTarget=body.target||'LuaU';
 const target=TARGETS.get(requestedTarget);
 if(typeof source!=='string'||!source.trim())
   return res.status(400).json({error:'Field script harus berupa string yang tidak kosong.'});
 if(Buffer.byteLength(source,'utf8')>LIMIT_BYTES)
   return res.status(413).json({error:'Native V4 maksimal 128 KB per script.'});
 if(preset!=='NativeV4'||(body.vmMode&&body.vmMode!=='native-v4'))
   return res.status(400).json({error:'BLACKMAMER hanya menyediakan preset NativeV4.',code:'V4_ONLY'});
 if(!['standalone','server-vault'].includes(runtimeMode))
   return res.status(400).json({error:'Unknown runtime mode.',code:'INVALID_RUNTIME_MODE'});
 if(remoteRequested){
   if(!oneClick||target!=='LuaU')
     return res.status(400).json({error:'Server vault requires Native V4 one-click Luau.',code:'SERVER_ONLY'});
   if(!vaultEnabled||!req.bmsLicense)
     return res.status(503).json({error:'Key vault requires persistent PostgreSQL, enforced license and master secret.',code:'VAULT_NOT_CONFIGURED'});
 }
 if(!target)return res.status(400).json({
   error:'Target harus Lua, Lua51, LuaJIT, atau LuaU.',code:'INVALID_TARGET'});
 if(!LEVELS.has(level))return res.status(400).json({
   error:'Protection level harus Minify, Light, Medium, Strong, atau Maximum.',code:'INVALID_LEVEL'});
 if(body.blackmamerVM===false)return res.status(400).json({
   error:'NativeV4 memerlukan blackmamerVM enabled.'});
 const artifactId=remoteRequested?crypto.randomUUID():null;
 const publicOrigin=(process.env.BLACKMAMER_RUNTIME_PUBLIC_ORIGIN||
   'https://blackmamer-obfuscate.onrender.com').replace(/\/$/,'');
 if(remoteRequested&&!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(publicOrigin))
   return res.status(503).json({error:'Invalid runtime vault public origin.',code:'VAULT_URL_INVALID'});
 const universeId=body.universeId===undefined||body.universeId===null||body.universeId===''
   ? null:Number(body.universeId);
 if(remoteRequested&&universeId!==null&&
     (!Number.isSafeInteger(universeId)||universeId<1))
   return res.status(400).json({error:'Universe ID must be a positive integer.',code:'BAD_UNIVERSE'});
 try{
   const result=compile(source,{
     hardened:true,
     target,
     protectionLevel:level,
     antiTamper:oneClick||body.antiTamper!==false,
     antiDebug:oneClick||(body.antiDebug!==false&&!['Minify','Light'].includes(level)),
     nestedVM:oneClick?true:body.nestedVM,
     vmArchitecture:oneClick?'seven-independent':body.vmArchitecture,
     superInstructions:oneClick?true:body.superInstructions,
     autoFunctionEncryption:remoteRequested?'external-full':
       (oneClick?'standalone':(body.autoFunctionEncryption||'off')),
     functionKeys:oneClick?undefined:body.functionKeys,
     remoteRuntime:remoteRequested?{artifactId,apiBaseUrl:publicOrigin}:undefined
   });
   if(remoteRequested){
     // Persist before returning output: never hand out a script whose key was
     // not committed. The secret must never appear in the response or logs.
     try{
       const keys=Object.fromEntries(result.generatedKeys.map(k=>[k.id,k.key]));
       if(Object.keys(keys).length!==1||!keys.BMAUTO_V4)
         throw new Error('Expected one encrypted entry key');
       await storeRuntimeKey({
         artifactId,licenseId:req.bmsLicense.id,keys,universeId
       });
     }catch(error){
       console.error('[BLACKMAMER VAULT STORE]',error.message);
       return res.status(503).json({error:'Could not persist remote key.',code:'VAULT_STORE_FAILED'});
     }
   }
   res.set('Cache-Control','no-store');
   res.json({
     obfuscated:BANNER+result.code,engine:result.engine,target,
     externalKeys:remoteRequested?[]:result.generatedKeys,
     protectedFunctionIds:result.protectedFunctions,
     runtimeKeyVault:remoteRequested?{
       enabled:true,artifactId,serverOnly:true,
       secretName:'BLACKMAMER_LICENSE',requiresRobloxSecretSetup:true
     }:{enabled:false},
     protection:{antiTamper:result.antiTamper,antiDebug:result.antiDebug},
     blackmamerVM:{
       enabled:true,applied:true,mode:'native-v4',hardened:true,
       oneClick,runtimeMode:remoteRequested?'server-vault':'standalone',
       profileLabel:oneClick?'BLACKMAMER V4 Unified Protection':'Custom API',
       protectionLevel:result.protectionLevel,
       target:result.target,
       astDeadBranches:result.injectedAstBranches,
       astFlattenedGroups:result.astFlattenedGroups,
       astStringEncryption:result.astStringEncryption,
       astEncryptedStrings:result.astEncryptedStrings,
       astEncryptedBytes:result.astEncryptedBytes,
       virtualizedLexicalBindings:result.virtualizedLexicalBindings,
       randomizedRegisterAllocation:result.randomizedRegisterAllocation,
       cfgFlattenedBlocks:result.cfgFlattenedBlocks,
       cfgBridgeJumps:result.cfgBridgeJumps,
       stringEncryption:result.stringEncryption,
       nestedVM:result.nestedVM,outerVmInstructions:result.outerVmInstructions,
       vmArchitecture:result.vmArchitecture,vmInterpreterCount:result.vmInterpreterCount,
       vmVariants:result.vmVariants,vmSelectedPerPrototype:result.vmSelectedPerPrototype,
       nativeSealer:result.nativeSealer,
       runtimeBootstrap:result.runtimeBootstrap,opaquePredicates:result.opaquePredicates,
       periodicRuntimeGuard:result.periodicRuntimeGuard,
       autoFunctionEncryption:result.autoFunctionEncryption,
       autoEncryptedFunctions:result.autoEncryptedFunctions,
       externallyKeyedFunctions:result.externallyKeyedFunctions,
       protectedFunctions:result.protectedFunctions.length,
       virtualizedFunctions:result.virtualizedFunctions,
       vmInstructions:result.vmInstructions,
       bytecodeLayout:result.bytecodeLayout,bytecodeWidths:result.bytecodeWidths,
       soaPrototypes:result.soaPrototypes,
       opcodePaletteSize:result.opcodePaletteSize,
       perFunctionOpcodePalette:result.perFunctionOpcodePalette,
       perInstructionOperandRotation:result.perInstructionOperandRotation,
       dispatchStructure:result.dispatchStructure,
       dispatcherVariants:result.dispatcherVariants,
       scrubbedRuntimeErrors:result.scrubbedRuntimeErrors,
       fusedInstructions:result.fusedInstructions,
       superInstructionKinds:result.superInstructionKinds,
       fallback:false
     }
   });
 }catch(error){
   const syntax=error.code==='V3_UNSUPPORTED_SYNTAX';
   const offset=Number.isInteger(error.offset)?error.offset:null;
   let position=null;
   if(offset!==null&&offset>=0&&offset<=source.length){
     const before=source.slice(0,offset);
     const line=before.split('\n').length;
     position={line,column:offset-before.lastIndexOf('\n'),offset};
   }
   if(!syntax)console.error('[BLACKMAMER V4]',error.message);
   return res.status(syntax?422:500).json({
     error:syntax?'Native V4: '+String(error.message).slice(0,280):
       'Native V4 gagal memproses script.',
     code:syntax?'V4_UNSUPPORTED_SYNTAX':'V4_COMPILE_ERROR',
     position,detail:syntax?String(error.message).slice(0,400):undefined
   });
 }
});
app.use((error,_req,res,_next)=>{
 if(error.type==='entity.too.large')return res.status(413).json({error:'Request terlalu besar.'});
 console.error('[BLACKMAMER API]',error.message);
 return res.status(error.status===400?400:500).json({error:'Request gagal diproses.'});
});
app.listen(PORT,()=>console.log('BLACKMAMER Native V4 (Luau/Lua51/LuaJIT) port '+PORT));
