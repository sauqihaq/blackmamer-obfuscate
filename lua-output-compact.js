'use strict';

// Compact LuaU into a single line without rewriting quoted contents or
// generating invalid lexemes. This is deliberately lexical rather than an
// obfuscation-security mechanism.
function compactLuau(source) {
  if (typeof source !== 'string') throw new TypeError('Expected Luau source string');
  const out=[];
  let at=0, pending=false, last='';
  const word=c=>/[A-Za-z0-9_]/.test(c||'');
  const needsSpace=(left,right)=>{
    if(!left||!right)return false;
    if(word(left)&&word(right))return true;
    if((/[0-9]/.test(left)&&right==='.') ||
       (left==='.'&&/[0-9]/.test(right)))return true;
    // Avoid merging separated punctuation into a comment/operator or
    // a long-bracket delimiter. Keep these rare spaces on purpose.
    return new Set(['--','..','//','==','~=','<=','>=','::',
      '+=','-=','*=','/=','%=','^=','->','[[',']]']).has(left+right);
  };
  const emit=value=>{
    if(!value)return;
    if(pending&&needsSpace(last,value[0]))out.push(' ');
    out.push(value);
    last=value[value.length-1];
    pending=false;
  };
  while(at<source.length){
    const c=source[at],next=source[at+1];
    if(/\s/.test(c)){at++;pending=true;continue;}
    if(c==='-'&&next==='-'){
      const start=at+2;
      const long=/^\[(=*)\[/.exec(source.slice(start));
      if(long){
        const close=']'+long[1]+']';
        const end=source.indexOf(close,start+long[0].length);
        if(end<0)throw new SyntaxError('Unterminated Luau block comment');
        at=end+close.length;
      }else{
        const end=source.indexOf('\n',start);
        at=end<0?source.length:end;
      }
      pending=true;
      continue;
    }
    if(c==='"'||c==="'"){
      const start=at,quote=c;at++;
      let closed=false;
      while(at<source.length){
        if(source[at]==='\\'){at+=2;continue;}
        if(source[at++]===quote){closed=true;break;}
      }
      if(!closed)throw new SyntaxError('Unterminated Luau quoted string');
      emit(source.slice(start,at));
      continue;
    }
    if(c==='['){
      const long=/^\[(=*)\[/.exec(source.slice(at));
      if(long){
        const close=']'+long[1]+']';
        const end=source.indexOf(close,at+long[0].length);
        if(end<0)throw new SyntaxError('Unterminated Luau long string');
        emit(source.slice(at,end+close.length));
        at=end+close.length;
        continue;
      }
    }
    emit(c);at++;
  }
  return out.join('');
}
module.exports={compactLuau};
