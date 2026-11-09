'use strict';
// BLACKMAMER VM V3 - independent, opt-in Lua/Luau subset compiler.
// No Prometheus/Vmify step in this engine. Unsupported syntax fails closed.
const crypto = require('node:crypto');
const rand = max => crypto.randomInt(max);

class SyntaxErrorV3 extends Error {
  constructor(message) { super(message); this.name = 'V3_UNSUPPORTED_SYNTAX'; this.code = 'V3_UNSUPPORTED_SYNTAX'; }
}
function lex(source) {
  const tokens = [], n = source.length;
  let pos = 0;
  const push = (type, value, at) => tokens.push({ type, value, at });
  while (pos < n) {
    const at = pos, c = source[pos];
    if (/\s/.test(c)) { pos++; continue; }
    if (source.startsWith('--', pos)) {
      pos += 2;
      const lm = /^\[(=*)\[/.exec(source.slice(pos));
      if (lm) {
        const close = ']' + lm[1] + ']';
        const end = source.indexOf(close, pos + lm[0].length);
        if (end < 0) throw new SyntaxErrorV3('Unclosed comment at ' + at);
        pos = end + close.length;
      } else {
        while (pos < n && source[pos] !== '\n') pos++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c; pos++;
      const bytes = [];
      while (pos < n && source[pos] !== quote) {
        if (source[pos] === '\n' || source[pos] === '\r') throw new SyntaxErrorV3('Unterminated string at ' + at);
        if (source[pos] !== '\\') {
          const cp = source.codePointAt(pos);
          bytes.push(...Buffer.from(String.fromCodePoint(cp)));
          pos += cp > 65535 ? 2 : 1;
          continue;
        }
        pos++;
        if (pos >= n) throw new SyntaxErrorV3('Invalid escape at ' + at);
        const esc = source[pos++];
        const simple = { a:7,b:8,f:12,n:10,r:13,t:9,v:11,'\\':92,'"':34,"'":39 };
        if (Object.hasOwn(simple, esc)) bytes.push(simple[esc]);
        else if (/[0-9]/.test(esc)) {
          let digits = esc;
          while (digits.length < 3 && /[0-9]/.test(source[pos] || '')) digits += source[pos++];
          const value = Number(digits);
          if (value > 255) throw new SyntaxErrorV3('Escape > 255 at ' + at);
          bytes.push(value);
        } else if (esc === 'x') {
          const pair = source.slice(pos, pos+2);
          if (!/^[a-fA-F0-9]{2}$/.test(pair)) throw new SyntaxErrorV3('Invalid hex escape');
          bytes.push(parseInt(pair,16)); pos += 2;
        } else if (esc === 'z') {
          while (/\s/.test(source[pos] || '') && pos < n) pos++;
        } else if (esc === 'u' && source[pos] === '{') {
          const m = /^\{([a-fA-F0-9]+)\}/.exec(source.slice(pos));
          if (!m) throw new SyntaxErrorV3('Invalid Unicode escape');
          const cp = parseInt(m[1],16);
          if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new SyntaxErrorV3('Invalid Unicode codepoint');
          bytes.push(...Buffer.from(String.fromCodePoint(cp))); pos += m[0].length;
        } else if (esc === '\n' || esc === '\r') {
          if (esc === '\r' && source[pos] === '\n') pos++;
          bytes.push(10);
        } else throw new SyntaxErrorV3('Unsupported escape at ' + at);
      }
      if (source[pos] !== quote) throw new SyntaxErrorV3('Unterminated string at ' + at);
      pos++;
      push('str', Buffer.from(bytes).toString('utf8'), at);
      continue;
    }
    if (c === '[') {
      const m = /^\[(=*)\[/.exec(source.slice(pos));
      if (m) {
        const close = ']' + m[1] + ']';
        const end = source.indexOf(close, pos + m[0].length);
        if (end < 0) throw new SyntaxErrorV3('Unclosed long string');
        let val = source.slice(pos + m[0].length, end);
        if (val.startsWith('\r\n')) val = val.slice(2);
        else if (val.startsWith('\n')) val = val.slice(1);
        push('str', val, at); pos = end + close.length; continue;
      }
    }
    const num = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?)/.exec(source.slice(pos));
    if (num && (/\d/.test(c) || (c === '.' && /\d/.test(source[pos+1] || '')))) {
      const raw = num[0].replace(/_/g,'');
      const val = /^0[bB]/.test(raw) ? parseInt(raw.slice(2),2) : Number(raw);
      if (!Number.isFinite(val)) throw new SyntaxErrorV3('Unsupported numeric constant');
      push('num', val, at); pos += num[0].length; continue;
    }
    const word = /^[A-Za-z_][A-Za-z_0-9]*/.exec(source.slice(pos));
    if (word) { push('id', word[0], at); pos += word[0].length; continue; }
    const symbol = ['...','..','==','~=','<=','>=','+=','-=','*=','/=','//','::','->'].find(s=>source.startsWith(s,pos));
    if (symbol) { push('sym',symbol,at); pos += symbol.length; continue; }
    if ('+-*/%^#=~<>(){}[];:, .'.includes(c) && c !== ' ') {
      push('sym',c,at); pos++; continue;
    }
    throw new SyntaxErrorV3('Unsupported character ' + JSON.stringify(c) + ' at offset ' + at);
  }
  push('eof','<eof>',n);
  return tokens;
}
class Parser {
  constructor(source) { this.tokens=lex(source); this.i=0; }
  peek() { return this.tokens[this.i].value; }
  tok() { return this.tokens[this.i]; }
  take(val) { if (this.peek()===val) {this.i++;return true;} return false; }
  must(val) { if (!this.take(val)) throw new SyntaxErrorV3('Expected ' + val + ', got ' + this.peek() + ' at ' + this.tok().at); }
  name() {
    const t=this.tok();
    const reserved=new Set(['and','break','do','else','elseif','end','false','for','function','if','in','local','nil','not','or','repeat','return','then','true','until','while','continue','type','export']);
    if (t.type!=='id' || reserved.has(t.value)) throw new SyntaxErrorV3('Identifier expected at ' + t.at);
    this.i++; return t.value;
  }
  block(stop) {
    const body=[];
    while (!stop.has(this.peek()) && this.peek() !== '<eof>') {
      if (this.take(';')) continue;
      body.push(this.statement());
      this.take(';');
    }
    return body;
  }
  params() {
    this.must('('); const names=[];
    if (!this.take(')')) {
      do { names.push(this.name()); } while(this.take(','));
      this.must(')');
    }
    return names;
  }
  fun(extraSelf) {
    const params=this.params();
    if(extraSelf) params.unshift('self');
    const body=this.block(new Set(['end']));
    this.must('end');
    return {t:'fun',params,body};
  }
  statement() {
    if (this.take('local')) {
      if (this.take('function')) {
        const name=this.name(); return {t:'localfun',name,fun:this.fun(false)};
      }
      const name=this.name();
      if (this.peek()===',' || this.peek()===':') throw new SyntaxErrorV3('V3 supports one untyped local per declaration');
      return {t:'local',name,value:this.take('=')?this.expr():{t:'nil'}};
    }
    if (this.take('function')) {
      let target={t:'var',name:this.name()},self=false;
      while (this.take('.')) target={t:'index',obj:target,key:{t:'str',value:this.name()}};
      if(this.take(':')){target={t:'index',obj:target,key:{t:'str',value:this.name()}}; self=true;}
      return {t:'assign',target,value:this.fun(self)};
    }
    if (this.take('if')) {
      const branches=[];
      do { const condition=this.expr();this.must('then'); const body=this.block(new Set(['elseif','else','end'])); branches.push({condition,body}); } while(this.take('elseif'));
      const otherwise=this.take('else')?this.block(new Set(['end'])):[];
      this.must('end');
      return {t:'if',branches,otherwise};
    }
    if (this.take('for')) {
      const name=this.name();this.must('=');const start=this.expr();this.must(',');const limit=this.expr();
      const step=this.take(',')?this.expr():{t:'num',value:1};this.must('do');
      const body=this.block(new Set(['end']));this.must('end');
      return {t:'fornum',name,start,limit,step,body};
    }
    if (this.take('while')) {
      const condition=this.expr();this.must('do');
      const body=this.block(new Set(['end']));this.must('end');
      return {t:'while',condition,body};
    }
    if (this.take('repeat')) {
      const body=this.block(new Set(['until']));this.must('until');
      const condition=this.expr();return {t:'repeat',body,condition};
    }
    if (this.take('do')) {
      const body=this.block(new Set(['end']));this.must('end');
      return {t:'do',body};
    }
    if (this.take('return')) {
      if (new Set(['end','elseif','else','until',';','<eof>']).has(this.peek())) return {t:'return',value:{t:'nil'}};
      const value=this.expr();
      if(this.peek()===',') throw new SyntaxErrorV3('Multiple returns not yet supported');
      return {t:'return',value};
    }
    if (this.take('break')) return {t:'break'};
    const lhs=this.expr(10);
    if(this.take('=')) {
      if(!['var','index'].includes(lhs.t)) throw new SyntaxErrorV3('Assignment target must be name or index');
      return {t:'assign',target:lhs,value:this.expr()};
    }
    if(lhs.t==='call' || lhs.t==='method') return {t:'callstmt',value:lhs};
    throw new SyntaxErrorV3('Unsupported statement at ' + this.tok().at + ': '+this.peek());
  }
  table() {
    const fields=[];let ordinal=1;
    while(!this.take('}')) {
      let key,value;
      if(this.take('[')){key=this.expr();this.must(']');this.must('=');value=this.expr();}
      else if(this.tok().type==='id' && this.tokens[this.i+1].value==='=') {
        key={t:'str',value:this.name()};this.must('=');value=this.expr();
      } else {key={t:'num',value:ordinal++};value=this.expr();}
      fields.push({key,value});
      if(this.take(',')||this.take(';')) continue;
      this.must('}');break;
    }
    return {t:'table',fields};
  }
  expr(min=0) {
    let node;
    const t=this.tok();
    if(this.take('if')) {
      const branches=[];
      do {const condition=this.expr();this.must('then');const value=this.expr();branches.push({condition,value});}while(this.take('elseif'));
      this.must('else');node={t:'ifexpr',branches,otherwise:this.expr()};
    }
    else if(this.take('nil')) node={t:'nil'};
    else if(this.take('true')) node={t:'bool',value:true};
    else if(this.take('false')) node={t:'bool',value:false};
    else if(t.type==='num'){this.i++;node={t:'num',value:t.value};}
    else if(t.type==='str'){this.i++;node={t:'str',value:t.value};}
    else if(this.take('(')){node=this.expr();this.must(')');}
    else if(this.take('{')) node=this.table();
    else if(this.take('function')) node=this.fun(false);
    else if(['-','not','#'].includes(this.peek())){
      const op=this.tok().value;this.i++; node={t:'unary',op,x:this.expr(7)};
    }
    else if(t.type==='id'){node={t:'var',name:this.name()};}
    else throw new SyntaxErrorV3('Unsupported expression near ' + t.value + ' at '+t.at);
    for(;;){
      const op=this.peek();
      if(op==='.' && 10>=min){this.i++;node={t:'index',obj:node,key:{t:'str',value:this.name()}};continue;}
      if(op==='[' && 10>=min){this.i++;const key=this.expr();this.must(']');node={t:'index',obj:node,key};continue;}
      if(op==='(' && 10>=min){const args=this.args();node={t:'call',fn:node,args};continue;}
      if(op===':' && 10>=min){this.i++;const method=this.name();const args=this.args();node={t:'method',obj:node,name:method,args};continue;}
      const precedence={or:1,and:2,'<':3,'>':3,'<=':3,'>=':3,'==':3,'~=':3,'..':4,'+':5,'-':5,'*':6,'/':6,'%':6,'^':8};
      const p=precedence[op];
      if(p===undefined || p<min) break;
      this.i++;
      node={t:'binary',op,left:node,right:this.expr(p+(['^','..'].includes(op)?0:1))};
    }
    return node;
  }
  args(){
    this.must('(');const args=[];
    if(!this.take(')')){do{args.push(this.expr());}while(this.take(','));this.must(')');}
    return args;
  }
  parse(){const body=this.block(new Set());this.must('<eof>');return body;}
}
const OPS=['K','GET','DECL','SET','TABLE','INDEX','PUT','CALL','CLOSURE','RET','MOV','JUMP','JF','JT','ENTER','EXIT','ADD','SUB','MUL','DIV','MOD','POW','CAT','LT','LE','GT','GE','EQ','NE','NEG','NOT','LEN','FORCONT','NONZERO'];
function compile(source, options={}) {
  if(typeof source!=='string') throw new TypeError('Expected Luau source string');
  if(Buffer.byteLength(source)>128*1024) throw new SyntaxErrorV3('V3 source limit: 128 KB');
  const parsed=new Parser(source).parse();
  const used=new Set(), codes={};
  for(const op of OPS){let id;do{id=rand(220)+17;}while(used.has(id));used.add(id);codes[op]=id;}
  const consts=[], constKeys=new Map(), funcs=[], argSets=[];
  const key=(value)=>{
    const type=value===null?'nil':typeof value;
    const label=type+':'+String(value);
    if(constKeys.has(label))return constKeys.get(label);
    const idx=consts.length+1;
    constKeys.set(label,idx);consts.push(value);return idx;
  };
  const builders=[];
  const makeBuilder=(ast,params)=>{
    const id=funcs.length+1;const builder={id,ins:[],regs:0,depth:0,loops:[]};
    funcs.push(null);builders.push(builder);
    const reg=()=>{if(++builder.regs>2048)throw new SyntaxErrorV3('V3 register limit exceeded');return builder.regs;};
    const emit=(op,a=0,b=0,c=0)=>{builder.ins.push([codes[op],a,b,c]);return builder.ins.length;};
    const scope=(body)=>{emit('ENTER');builder.depth++;statements(body);builder.depth--;emit('EXIT');};
    const expr=(n)=>{
      if(['nil','bool','str','num'].includes(n.t)){const dst=reg();emit('K',dst,key(n.t==='nil'?null:n.value));return dst;}
      if(n.t==='var'){const dst=reg();emit('GET',dst,key(n.name));return dst;}
      if(n.t==='index'){const obj=expr(n.obj),k=expr(n.key),dst=reg();emit('INDEX',dst,obj,k);return dst;}
      if(n.t==='table'){const dst=reg();emit('TABLE',dst);for(const f of n.fields){const a=expr(f.key),b=expr(f.value);emit('PUT',dst,a,b);}return dst;}
      if(n.t==='fun'){const fnid=makeBuilder(n.body,n.params),dst=reg();emit('CLOSURE',dst,fnid);return dst;}
      if(n.t==='call' || n.t==='method'){
        let fn,regs=[];
        if(n.t==='method'){
          const obj=expr(n.obj),k=expr({t:'str',value:n.name});
          fn=reg();emit('INDEX',fn,obj,k);regs.push(obj);
        } else fn=expr(n.fn);
        for(const arg of n.args)regs.push(expr(arg));
        const idx=argSets.push(regs);const dst=reg();emit('CALL',dst,fn,idx);return dst;
      }
      if(n.t==='unary'){
        const from=expr(n.x),dst=reg();
        emit({'-':'NEG','not':'NOT','#':'LEN'}[n.op],dst,from);return dst;
      }
      if(n.t==='ifexpr'){
        const dst=reg(),ends=[];
        for(const branch of n.branches){
          const cond=expr(branch.condition),skip=emit('JF',cond,0);
          const value=expr(branch.value);emit('MOV',dst,value);
          ends.push(emit('JUMP',0));builder.ins[skip-1][2]=builder.ins.length+1;
        }
        const other=expr(n.otherwise);emit('MOV',dst,other);
        const end=builder.ins.length+1;
        for(const j of ends)builder.ins[j-1][1]=end;
        return dst;
      }
      if(n.t==='binary'){
        const a=expr(n.left),dst=reg();
        if(n.op==='and'||n.op==='or'){
          emit('MOV',dst,a);
          const skip=emit(n.op==='and'?'JF':'JT',a,0);
          const b=expr(n.right);emit('MOV',dst,b);
          builder.ins[skip-1][2]=builder.ins.length+1;
          return dst;
        }
        const b=expr(n.right);
        const map={'+':'ADD','-':'SUB','*':'MUL','/':'DIV','%':'MOD','^':'POW','..':'CAT','<':'LT','<=':'LE','>':'GT','>=':'GE','==':'EQ','~=':'NE'};
        emit(map[n.op],dst,a,b);return dst;
      }
      throw new SyntaxErrorV3('Unknown AST expression '+n.t);
    };
    const write=(target,value)=>{
      const valueReg=expr(value);
      if(target.t==='var')emit('SET',key(target.name),valueReg);
      else{const objectReg=expr(target.obj),indexReg=expr(target.key);emit('PUT',objectReg,indexReg,valueReg);}
    };
    const statements=(body)=>{
      for(const n of body){
        switch(n.t){
          case 'local':{const r=expr(n.value);emit('DECL',key(n.name),r);break;}
          case 'localfun':{
            const nil=expr({t:'nil'});emit('DECL',key(n.name),nil);
            const r=expr(n.fun);emit('SET',key(n.name),r);break;
          }
          case 'assign':write(n.target,n.value);break;
          case 'callstmt':expr(n.value);break;
          case 'do':scope(n.body);break;
          case 'if':{
            const endJumps=[];
            for(const part of n.branches){
              const test=expr(part.condition);
              const skip=emit('JF',test,0);scope(part.body);
              endJumps.push(emit('JUMP',0));
              builder.ins[skip-1][2]=builder.ins.length+1;
            }
            if(n.otherwise.length)scope(n.otherwise);
            const end=builder.ins.length+1;
            for(const j of endJumps)builder.ins[j-1][1]=end;
            break;
          }
          case 'fornum':{
            emit('ENTER');builder.depth++;
            const startR=expr(n.start),limitR=expr(n.limit),stepR=expr(n.step);
            emit('NONZERO',stepR);
            const hidden='__bmv3_loop_'+crypto.randomBytes(6).toString('hex');
            emit('DECL',key(hidden),startR);
            const start=builder.ins.length+1;
            const curr=expr({t:'var',name:hidden}),test=reg();
            emit('FORCONT',argSets.push([test,curr,limitR,stepR]));
            const exit=emit('JF',test,0);
            const loop={breaks:[],depth:builder.depth};builder.loops.push(loop);
            emit('ENTER');builder.depth++;
            const current=expr({t:'var',name:hidden});emit('DECL',key(n.name),current);
            statements(n.body);
            builder.depth--;emit('EXIT');
            const next=reg();emit('ADD',next,curr,stepR);emit('SET',key(hidden),next);
            emit('JUMP',start);
            const end=builder.ins.length+1;
            builder.ins[exit-1][2]=end;
            for(const j of loop.breaks)builder.ins[j-1][1]=end;
            builder.loops.pop();builder.depth--;emit('EXIT');break;
          }
          case 'repeat':{
            const start=builder.ins.length+1;
            const loop={breaks:[],depth:builder.depth};builder.loops.push(loop);
            emit('ENTER');builder.depth++;
            statements(n.body);
            const test=expr(n.condition);
            builder.depth--;emit('EXIT');emit('JF',test,start);
            const end=builder.ins.length+1;
            for(const j of loop.breaks)builder.ins[j-1][1]=end;
            builder.loops.pop();break;
          }
          case 'while':{
            const start=builder.ins.length+1;
            const r=expr(n.condition),exit=emit('JF',r,0);
            const loop={breaks:[],depth:builder.depth};builder.loops.push(loop);
            scope(n.body);emit('JUMP',start);
            const end=builder.ins.length+1;
            builder.ins[exit-1][2]=end;
            for(const j of loop.breaks)builder.ins[j-1][1]=end;
            builder.loops.pop();break;
          }
          case 'break':{
            const loop=builder.loops[builder.loops.length-1];
            if(!loop)throw new SyntaxErrorV3('break outside while');
            for(let i=builder.depth;i>loop.depth;i--)emit('EXIT');
            loop.breaks.push(emit('JUMP',0));break;
          }
          case 'return':emit('RET',expr(n.value));break;
          default:throw new SyntaxErrorV3('Unsupported statement type '+n.t);
        }
        if(builder.ins.length>12000)throw new SyntaxErrorV3('V3 instruction limit exceeded');
      }
    };
    statements(ast);emit('RET',0);
    funcs[id-1]={p:params.map(key),ins:builder.ins};
    return id;
  };
  const entry=makeBuilder(parsed,[]);
  // Each function becomes a compact, per-build sealed binary bytecode blob.
  // It raises the cost of casual inspection, NOT the cryptographic secrecy of
  // client-side code: the decoder and its seeds must travel with the output.
  const salt=crypto.randomInt(2000,100000);
  const modulus=10000019, hashMod=1000000007;
  const packed=funcs.map(f=>({p:f.p,ins:f.ins.map(ins=>ins.map((n,j)=>(n+salt+5*(j+1)+modulus)%modulus))}));
  function seal(bytes,seed) {
    let state=seed,prev=0;
    return bytes.map((plain,i)=>{
      const j=i+1;
      state=(state*73+41+(j%251))%65521;
      const mask=(state%256) ^ ((state>>>8)%256);
      const encoded=(plain ^ mask ^ prev)&255;
      prev=encoded;
      return encoded;
    });
  }
  function pack24(int,bytes) {
    if(!Number.isSafeInteger(int)||int<0||int>0xffffff)throw new SyntaxErrorV3('Bytecode integer out of range');
    bytes.push(int&255,(int>>>8)&255,(int>>>16)&255);
  }
  function pack16(int,bytes) {
    if(!Number.isSafeInteger(int)||int<0||int>0xffff)throw new SyntaxErrorV3('Too many registers or instructions');
    bytes.push(int&255,(int>>>8)&255);
  }
  const sealedFunctions=packed.map(f=>{
    const raw=[];
    pack16(f.p.length,raw);
    pack16(f.ins.length,raw);
    for(const v of f.p) pack24(v,raw);
    for(const row of f.ins) for(const v of row)pack24(v,raw);
    const seed=rand(60000)+1000;
    return [seed,seal(raw,seed)];
  });
  const sealedConstants=consts.map(value=>{
    const typ=value===null?5:typeof value==='string'?1:typeof value==='number'?2:value===true?3:4;
    const raw=(typ===1||typ===2)?[...Buffer.from(String(value),'utf8')]:[];
    const seed=rand(60000)+1000;
    return [typ,seed,seal(raw,seed)];
  });
  const luaBytes=bytes=>'"'+bytes.map(v=>'\\'+String(v).padStart(3,'0')).join('')+'"';
  const luaFunctions='{'+sealedFunctions.map(([seed,bytes])=>'{'+seed+','+luaBytes(bytes)+'}').join(',')+'}';
  const luaConstants='{'+sealedConstants.map(([typ,seed,bytes])=>'{'+typ+','+seed+','+luaBytes(bytes)+'}').join(',')+'}';
  const luaArgs=JSON.stringify(argSets).replace(/\[/g,'{').replace(/\]/g,'}');
  let digest=17;
  const mix=(n)=>{digest=(digest*131+n+1)%hashMod;};
  for(const [seed,bytes] of sealedFunctions){mix(seed);mix(bytes.length);bytes.forEach(mix);}
  for(const [typ,seed,bytes] of sealedConstants){mix(typ);mix(seed);mix(bytes.length);bytes.forEach(mix);}
  for(const args of argSets){mix(args.length);args.forEach(mix);}
  const lines=[
    '-- BLACKMAMER VM V3.1',
    'return (function(...)',
    '  local E=' + luaFunctions,
    '  local Q=' + luaConstants,
    '  local A=' + luaArgs,
    '  local SALT=' + salt + '; local CHECK=' + digest,
    '  local modulus=' + modulus + '; local hmod=' + hashMod,
    '  local nativeByte=string.byte; local nativeChar=string.char; local nativeConcat=table.concat',
    '  local nativeUnpack=table.unpack or unpack; local bxor=bit32 and bit32.bxor',
    '  local nativeType=type; local nativePcall=pcall; local nativeError=error',
    '  local dbg=debug; local globals=(getfenv and getfenv()) or _ENV or _G',
    '  if nativeType(bxor)~="function" then nativeError("BLACKMAMER V3 requires Luau bit32") end',
    '  local function verify()',
    '    local h=17;local function mix(v)h=(h*131+v+1)%hmod end',
    '    for _,f in ipairs(E)do mix(f[1]);mix(#f[2]);for j=1,#f[2]do mix(nativeByte(f[2],j))end end',
    '    for _,v in ipairs(Q)do mix(v[1]);mix(v[2]);mix(#v[3]);for j=1,#v[3]do mix(nativeByte(v[3],j))end end',
    '    for _,ar in ipairs(A)do mix(#ar);for _,v in ipairs(ar)do mix(v)end end',
    '    if '+(options.antiTamper===false?'false':'true')+' and h~=CHECK then nativeError("BLACKMAMER V3: bytecode integrity failed") end',
    '    if '+(options.antiDebug===false?'false':'true')+' then',
    '      if nativeType(nativeByte)~="function" or nativeType(nativeChar)~="function" or',
    '        nativeChar(65)~="A" or nativeByte("A")~=65 or bxor(9,3)~=10 or',
    '        nativeConcat({"B","M"})~="BM" then',
    '        nativeError("BLACKMAMER V3: runtime hooks detected") end',
    '      local info=dbg and dbg.info',
    '      if nativeType(info)=="function" then',
    '        local ok,src=nativePcall(info,1,"s")',
    '        if ok and nativeType(src)~="string" then nativeError("BLACKMAMER V3: debug metadata modified") end',
    '      end',
    '    end',
    '  end',
    '  verify()',
    '  local function unseal(blob,seed)',
    '    local state=seed;local prev=0;local out={}',
    '    for j=1,#blob do',
    '      state=(state*73+41+(j%251))%65521',
    '      local mask=bxor(state%256,math.floor(state/256)%256)',
    '      local cipher=nativeByte(blob,j)',
    '      out[j]=bxor(cipher,mask,prev);prev=cipher',
    '    end',
    '    return out',
    '  end',
    '  local P={}',
    '  for id,bundle in ipairs(E) do',
    '    local bytes=unseal(bundle[2],bundle[1]);local at=1',
    '    local function two()local n=bytes[at]+256*bytes[at+1];at=at+2;return n end',
    '    local function three()local n=bytes[at]+256*bytes[at+1]+65536*bytes[at+2];at=at+3;return n end',
    '    local pn=two();local inum=two();local params={};local instructions={}',
    '    for j=1,pn do params[j]=three() end',
    '    for j=1,inum do instructions[j]={three(),three(),three(),three()}end',
    '    P[id]={params,instructions}',
    '  end',
    '  local K={}',
    '  for k,entry in ipairs(Q) do',
    '    local typ=entry[1];local bytes=unseal(entry[3],entry[2])',
    '    if typ==5 then K[k]=nil elseif typ==3 then K[k]=true elseif typ==4 then K[k]=false',
    '    else local output={} for j,b in ipairs(bytes) do output[j]=nativeChar(b) end',
    '      local str=nativeConcat(output);K[k]=(typ==2) and tonumber(str) or str end',
    '  end',
    '  local NIL={};local function nonil(v)if v==NIL then return nil else return v end end',
    '  local exec',
    '  exec=function(fid,passed,captured)',
    '    local spec=P[fid]; if not spec then nativeError("BLACKMAMER V3 invalid function") end',
    '    local env={vars={},parent=captured}',
    '    for j,k in ipairs(spec[1])do local v=passed[j];env.vars[K[k]]=v==nil and NIL or v end',
    '    local R={};local pc=1;local ticks=0;local instructions=spec[2]',
    '    local function get(n)',
    '      local frame=env',
    '      while frame do local v=rawget(frame.vars,n);if v~=nil then return nonil(v)end;frame=frame.parent end',
    '      return globals[n]',
    '    end',
    '    local function set(n,v)',
    '      local frame=env;while frame do if rawget(frame.vars,n)~=nil then',
    '        frame.vars[n]=v==nil and NIL or v;return end;frame=frame.parent end',
    '      globals[n]=v',
    '    end',
    '    while true do',
    '      ticks=ticks+1; if ticks>1000000 then nativeError("BLACKMAMER V3 instruction limit") end',
    '      local row=instructions[pc];if not row then nativeError("BLACKMAMER V3 bad PC") end',
    '      local op=((row[1]-SALT-5)%modulus);',
    '      local a=((row[2]-SALT-10)%modulus);if a>modulus/2 then a=a-modulus end',
    '      local b=((row[3]-SALT-15)%modulus);if b>modulus/2 then b=b-modulus end',
    '      local c=((row[4]-SALT-20)%modulus);if c>modulus/2 then c=c-modulus end',
    '      local nextpc=pc+1',
    '      if op==O.K then R[a]=K[b]',
    '      elseif op==O.GET then R[a]=get(K[b])',
    '      elseif op==O.DECL then local v=R[b];env.vars[K[a]]=v==nil and NIL or v',
    '      elseif op==O.SET then set(K[a],R[b])',
    '      elseif op==O.TABLE then R[a]={}',
    '      elseif op==O.INDEX then R[a]=R[b][R[c]]',
    '      elseif op==O.PUT then R[a][R[b]]=R[c]',
    '      elseif op==O.MOV then R[a]=R[b]',
    '      elseif op==O.CALL then local args=A[c] or {};local vals={};for j,v in ipairs(args)do vals[j]=R[v]end',
    '        R[a]=R[b](nativeUnpack(vals,1,#args))',
    '      elseif op==O.CLOSURE then local capture=env;R[a]=function(...)return exec(b,{...},capture)end',
    '      elseif op==O.RET then return a==0 and nil or R[a]',
    '      elseif op==O.JUMP then nextpc=a',
    '      elseif op==O.JF then if not R[a] then nextpc=b end',
    '      elseif op==O.JT then if R[a] then nextpc=b end',
    '      elseif op==O.ENTER then env={vars={},parent=env}',
    '      elseif op==O.EXIT then env=env.parent',
    '      elseif op==O.ADD then R[a]=R[b]+R[c]',
    '      elseif op==O.SUB then R[a]=R[b]-R[c]',
    '      elseif op==O.MUL then R[a]=R[b]*R[c]',
    '      elseif op==O.DIV then R[a]=R[b]/R[c]',
    '      elseif op==O.MOD then R[a]=R[b]%R[c]',
    '      elseif op==O.POW then R[a]=R[b]^R[c]',
    '      elseif op==O.CAT then R[a]=R[b]..R[c]',
    '      elseif op==O.LT then R[a]=R[b]<R[c]',
    '      elseif op==O.LE then R[a]=R[b]<=R[c]',
    '      elseif op==O.GT then R[a]=R[b]>R[c]',
    '      elseif op==O.GE then R[a]=R[b]>=R[c]',
    '      elseif op==O.EQ then R[a]=R[b]==R[c]',
    '      elseif op==O.NE then R[a]=R[b]~=R[c]',
    '      elseif op==O.NEG then R[a]=-R[b]',
    '      elseif op==O.NOT then R[a]=not R[b]',
    '      elseif op==O.LEN then R[a]=#R[b]',
    '      elseif op==O.NONZERO then if R[a]==0 then nativeError("BLACKMAMER V3: for step is zero") end',
    '      elseif op==O.FORCONT then local list=A[a];local i=R[list[2]];local limit=R[list[3]];local step=R[list[4]]',
    '        R[list[1]]=(step>=0 and i<=limit) or (step<0 and i>=limit)',
    '      else nativeError("BLACKMAMER V3 invalid opcode") end',
    '      pc=nextpc',
    '    end',
    '  end',
    '  return exec('+entry+',{},nil)',
    'end)(...)'
  ];
  // Per-build permutation of handler layout, and bake randomized opcode values
  // directly into each branch (no cleartext O.GET / O.CALL / O.RET mapping).
  const dispatchStart=lines.findIndex(line=>/^\s*if op==O\./.test(line));
  const dispatchEnd=lines.findIndex(line=>line.includes('else nativeError("BLACKMAMER V3 invalid opcode") end'));
  if(dispatchStart<0||dispatchEnd<dispatchStart)throw new Error('VM dispatcher template missing');
  const handlers=[];
  let block=null;
  for(let i=dispatchStart;i<dispatchEnd;i++){
    const line=lines[i];
    if(/^\s*(?:if|elseif) op==O\./.test(line)){
      if(block)handlers.push(block);
      block=[line];
    } else {
      if(!block)throw new Error('Invalid handler template');
      block.push(line);
    }
  }
  if(block)handlers.push(block);
  for(let i=handlers.length-1;i>0;i--){
    const j=rand(i+1);
    [handlers[i],handlers[j]]=[handlers[j],handlers[i]];
  }
  const permuted=handlers.flatMap((part,i)=>{
    const first=part[0].replace(/^(\s*)(?:if|elseif)(?= op==O\.)/, '$1'+(i===0?'if':'elseif'));
    return [first,...part.slice(1)];
  });
  lines.splice(dispatchStart,dispatchEnd-dispatchStart,...permuted);
  const code=lines.join('\n').replace(/\bO\.([A-Z]+)\b/g,(_,name)=>{
    if(!Object.hasOwn(codes,name)) throw new Error('Unknown VM opcode '+name);
    return String(codes[name]);
  });
  return {code,engine:'BLACKMAMER V3 Native VM',virtualizedFunctions:funcs.length,
    vmInstructions:funcs.reduce((n,f)=>n+f.ins.length,0),
    antiTamper: options.antiTamper!==false, antiDebug: options.antiDebug!==false};
}
module.exports={compile,lex,Parser,SyntaxErrorV3};
