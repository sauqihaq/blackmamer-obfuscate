'use strict';
/**
 * BLACKMAMER STUDIO V4-only obfuscation API.
 * Independent compiler/VM: no Prometheus code, runtime, or CLI dependency.
 * Source AST -> optional AST decoys -> control-flow transformed VM IR
 * -> native C++ sealed bytecode -> Luau or portable Lua 5.1 runtime.
 */
const express=require('express');
const cors=require('cors');
const {compile,SyntaxErrorV3}=require('./blackmamer-vm3');
const {available:nativeAvailable}=require('./native-sealer');
const {registerRoutes,gate:licenseGate}=require('./commercial-access');
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

app.get('/',(_req,res)=>res.json({
 service:'blackmamer-obfuscator',status:'ok',engine:'BLACKMAMER Native V4',
 version:'4.1.0',vm:'BLACKMAMER nested VM',preset:'NativeV4',
 levels:[...LEVELS],targets:[...TARGETS.keys()],nativeSealerAvailable:nativeAvailable()
}));
app.get('/api/health',(_req,res)=>res.json({
 status:'ready',node:true,engine:'BLACKMAMER Native V4',vm4Available:true,
 vm3Available:false,prometheusInstalled:false,defaultTarget:'LuaU',
 targetSupport:['LuaU','Lua51','LuaJIT'],levels:[...LEVELS],
 nativeSealerAvailable:nativeAvailable(),
 message:'Independent V4-only compiler; Lua 5.1 uses portable string/bit adapters'
}));
app.post('/api/obfuscate',licenseGate,(req,res)=>{
 const body=req.body||{};
 const source=body.script;
 const preset=body.preset||'NativeV4';
 const level=body.protectionLevel||body.presetLevel||'Strong';
 const requestedTarget=body.target||'LuaU';
 const target=TARGETS.get(requestedTarget);
 if(typeof source!=='string'||!source.trim())
   return res.status(400).json({error:'Field script harus berupa string yang tidak kosong.'});
 if(Buffer.byteLength(source,'utf8')>LIMIT_BYTES)
   return res.status(413).json({error:'Native V4 maksimal 128 KB per script.'});
 if(preset!=='NativeV4'||(body.vmMode&&body.vmMode!=='native-v4'))
   return res.status(400).json({error:'BLACKMAMER hanya menyediakan preset NativeV4.',code:'V4_ONLY'});
 if(!target)return res.status(400).json({
   error:'Target harus Lua, Lua51, LuaJIT, atau LuaU.',code:'INVALID_TARGET'});
 if(!LEVELS.has(level))return res.status(400).json({
   error:'Protection level harus Minify, Light, Medium, Strong, atau Maximum.',code:'INVALID_LEVEL'});
 if(body.blackmamerVM===false)return res.status(400).json({
   error:'NativeV4 memerlukan blackmamerVM enabled.'});
 try{
   const result=compile(source,{
     hardened:true,
     target,
     protectionLevel:level,
     antiTamper:body.antiTamper!==false,
     antiDebug:body.antiDebug!==false&&!['Minify','Light'].includes(level),
     nestedVM:body.nestedVM,
     superInstructions:body.superInstructions,
     autoFunctionEncryption:body.autoFunctionEncryption||'off',
     functionKeys:body.functionKeys
   });
   res.json({
     obfuscated:BANNER+result.code,engine:result.engine,target,
     externalKeys:result.generatedKeys,protectedFunctionIds:result.protectedFunctions,
     protection:{antiTamper:result.antiTamper,antiDebug:result.antiDebug},
     blackmamerVM:{
       enabled:true,applied:true,mode:'native-v4',hardened:true,
       protectionLevel:result.protectionLevel,
       target:result.target,
       astDeadBranches:result.injectedAstBranches,
       astFlattenedGroups:result.astFlattenedGroups,
       cfgFlattenedBlocks:result.cfgFlattenedBlocks,
       cfgBridgeJumps:result.cfgBridgeJumps,
       stringEncryption:result.stringEncryption,
       nestedVM:result.nestedVM,outerVmInstructions:result.outerVmInstructions,
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
       opcodePaletteSize:result.opcodePaletteSize,
       perFunctionOpcodePalette:result.perFunctionOpcodePalette,
       perInstructionOperandRotation:result.perInstructionOperandRotation,
       dispatchStructure:result.dispatchStructure,
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
