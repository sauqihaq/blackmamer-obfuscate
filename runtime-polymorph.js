'use strict';
// Syntax-aware runtime polymorphism. This stage only rewrites compiler-owned
// local identifiers and inserts whitespace BETWEEN Lua lexical tokens. It
// never edits literals, comments, operators, public globals, or field names.
// Name randomization and messy formatting are NOT cryptographic secrecy.
const crypto=require('node:crypto');
const RUNTIME_LOCALS=new Set([
  'E','Q','H','A','P','NIL','SALT','BOOT','CHECK','SBOX_MASK','K',
  'nativeByte','nativeChar','nativeConcat','nativeUnpack','nativeBitXor',
  'nativePack','nativeType','nativePcall','nativeError','bxor',
  'dbg','globals','modulus','hmod','hseed','hmul','hadd',
  'unseal','verify','runtimeGuard','parseStage','programCache',
  'exec','get','set','nonil','constantCache','constantNil',
  'bmBitPair','bufFrom','bufLen','bufRead','bufRead32',
  '_BK','_s','_out','_oct','_unfold','_vaultProvider','_vaultCachedKey',
  // VM registers, per-prototype execution state and dispatcher identifiers.
  'R','pc','op','spec','env','nextpc','fid','passed','captured','frame',
  'outerVM','execVM1','execVM2','execVM3','execVM4',
  'execVM5','execVM6','execVM7'
]);
const rand=n=>crypto.randomInt(n);
const identifier=/[A-Za-z0-9_]/;
const isHead=c=>/[A-Za-z_]/.test(c||'');
const isTail=c=>identifier.test(c||'');
function polymorphRuntime(source,opts={}){
  if(typeof source!=='string')throw new TypeError('Expected compact Lua runtime');
  const rename=opts.rename!==false,chaos=opts.chaos!==false;
  const aliases=new Map(),used=new Set();
  // Generated aliases are collision-resistant and never collide with existing
  // original identifier tokens because of the fixed-length random prefix.
  const aliasFor=name=>{
    if(!aliases.has(name)){
      // Mix compact alphabetic names with longer hex names. Every alias
      // is checked against the complete original VM text to avoid collisions
      // with preexisting locals, globals and method names.
      const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let id;
      do{
        if(rand(100)<70){
          const size=3+rand(3);
          id=Array.from({length:size},()=>alphabet[rand(alphabet.length)]).join('');
        }else id='_b'+crypto.randomBytes(9).toString('hex');
      }while(used.has(id)||source.includes(id));
      used.add(id);aliases.set(name,id);
    }
    return aliases.get(name);
  };
  let i=0,lastToken='',renamed=0,lineBreaks=0;
  const out=[];
  const n=source.length;
  function maybeGap(){
    if(!chaos||!lastToken)return;
    const p=rand(100);
    // Luau forbids an ambiguous newline before a call's '(' argument list.
    // Only emit line breaks after explicit statement separators. Whitespace
    // elsewhere is limited to spaces, which do not alter the token stream.
    if(lastToken===';'&&p<55){out.push('\n'+' '.repeat(rand(5)));lineBreaks++;}
    else if(p<12)out.push(' '.repeat(1+rand(3)));
  }
  while(i<n){
    const ch=source[i],next=source[i+1];
    if(/\s/.test(ch)){
      const start=i;do{i++;}while(i<n&&/\s/.test(source[i]));
      out.push(source.slice(start,i));continue;
    }
    if(ch==='-'&&next==='-'){
      const start=i;i+=2;
      const long=/^\[(=*)\[/.exec(source.slice(i,i+24));
      if(long){
        const close=']'+long[1]+']',end=source.indexOf(close,i+long[0].length);
        if(end<0)throw new SyntaxError('Unclosed Lua block comment');
        i=end+close.length;
      }else{
        while(i<n&&source[i]!=='\n')i++;
      }
      out.push(source.slice(start,i));continue;
    }
    if(ch==='"'||ch==="'"){
      maybeGap();const start=i,quote=ch;i++;
      while(i<n){
        if(source[i]==='\\'){i+=2;continue;}
        if(source[i++]===quote)break;
      }
      if(source[i-1]!==quote)throw new SyntaxError('Unclosed Lua string');
      out.push(source.slice(start,i));lastToken='string';continue;
    }
    if(ch==='['){
      const long=/^\[(=*)\[/.exec(source.slice(i,i+24));
      if(long){
        maybeGap();const close=']'+long[1]+']';
        const end=source.indexOf(close,i+long[0].length);
        if(end<0)throw new SyntaxError('Unclosed Lua long string');
        out.push(source.slice(i,end+close.length));i=end+close.length;
        lastToken='string';continue;
      }
    }
    if(isHead(ch)){
      const start=i++;while(i<n&&isTail(source[i]))i++;
      const word=source.slice(start,i);
      maybeGap();
      if(rename&&RUNTIME_LOCALS.has(word)&&lastToken!=='.'&&lastToken!==':'){
        out.push(aliasFor(word));renamed++;
      }else out.push(word);
      lastToken=word;continue;
    }
    // Numbers are emitted as one lexical unit. Do not split exponentials,
    // decimals, or hexadecimal constants with artificial whitespace.
    if(/[0-9]/.test(ch)||(ch==='.'&&/[0-9]/.test(next||''))){
      const start=i;
      const m=/^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?)/.exec(source.slice(i));
      if(m){maybeGap();i+=m[0].length;out.push(m[0]);lastToken='number';continue;}
      i=start;
    }
    maybeGap();
    const op=['...','..=','//=','..','==','~=','<=','>=','+=','-=','*=','/=','%=','^=','//','::','->']
      .find(x=>source.startsWith(x,i));
    const token=op||ch;out.push(token);i+=token.length;lastToken=token;
  }
  return {code:out.join(''),aliasCount:aliases.size,renamedTokens:renamed,lineBreaks};
}
module.exports={polymorphRuntime};
