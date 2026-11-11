'use strict';
// BLACKMAMER-owned non-VM AST transform: string literals are independently
// masked BEFORE IR/VM compilation. Unlike constant-pool sealing this pass
// rewrites source AST expressions. The runtime decoder is intentionally small;
// a determined static evaluator can still undo it, so do not claim secrecy.
const crypto=require('node:crypto');
const rand=max=>crypto.randomInt(max);
function encodeText(value,seed){
 const bytes=Buffer.from(value,'utf8');
 const out=Buffer.alloc(bytes.length);
 for(let i=0;i<bytes.length;i++)
   out[i]=(bytes[i]+seed+(i+1)*53+((i+1)*(i+1)%251))%256;
 return out.toString('hex');
}
function decodeText(hex,seed){
 const bytes=Buffer.from(hex,'hex');
 for(let i=0;i<bytes.length;i++)
   bytes[i]=(bytes[i]-seed-(i+1)*53-((i+1)*(i+1)%251)+65536)%256;
 return bytes.toString('utf8');
}
function protectAstStrings(ast,options={}){
 const ratio=options.ratio===undefined?1:options.ratio;
 const minLength=options.minLength===undefined?2:options.minLength;
 let count=0,totalBytes=0;
 const seen=new WeakSet();
 const walk=node=>{
   if(!node||typeof node!=='object'||seen.has(node))return;
   seen.add(node);
   if(Array.isArray(node)){for(const part of node)walk(part);return;}
   if(node.t==='str'&&Buffer.byteLength(node.value,'utf8')>=minLength&&rand(1000)<ratio*1000){
     const str=node.value;
     const seed=1+rand(254);
     const hex=encodeText(str,seed);
     node.t='aststring';node.hex=hex;node.seed=seed;delete node.value;
     count++;totalBytes+=Buffer.byteLength(str,'utf8');
     return;
   }
   // The compiler macro identifies protected functions through the exact
   // string ID on its first argument; do not rewrite this compile-time input.
   if(node.t==='call'&&node.fn&&node.fn.t==='var'&&node.fn.name==='BM_ENCFUNC'){
     walk(node.fn);
     for(let i=1;i<node.args.length;i++)walk(node.args[i]);
     return;
   }
   for(const value of Object.values(node))walk(value);
 };
 walk(ast);
 return {count,totalBytes};
}
module.exports={protectAstStrings,encodeText,decodeText};
