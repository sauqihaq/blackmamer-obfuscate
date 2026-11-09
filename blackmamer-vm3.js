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
    const symbol = ['...','..=','//=','..','==','~=','<=','>=','+=','-=','*=','/=','%=','^=','//','::','->'].find(s=>source.startsWith(s,pos));
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
    const reserved=new Set(['and','break','do','else','elseif','end','false','for','function','if','in','local','nil','not','or','repeat','return','then','true','until','while','continue']);
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
      const names=[this.name()];
      while(this.take(','))names.push(this.name());
      if(this.peek()===':')throw new SyntaxErrorV3('Typed local declarations are not yet supported');
      const values=this.take('=')?this.exprlist():[];
      if(names.length===1&&values.length<=1)
        return {t:'local',name:names[0],value:values[0]||{t:'nil'}};
      return {t:'localmulti',names,values};
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
      const first=this.name();
      if(this.take('=')){
        const start=this.expr();this.must(',');const limit=this.expr();
        const step=this.take(',')?this.expr():{t:'num',value:1};this.must('do');
        const body=this.block(new Set(['end']));this.must('end');
        return {t:'fornum',name:first,start,limit,step,body};
      }
      const names=[first];
      while(this.take(','))names.push(this.name());
      this.must('in');
      const iterators=this.exprlist();
      this.must('do');
      const body=this.block(new Set(['end']));this.must('end');
      return {t:'forin',names,iterators,body};
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
      if (new Set(['end','elseif','else','until',';','<eof>']).has(this.peek())) return {t:'return',values:[]};
      return {t:'return',values:this.exprlist()};
    }
    if (this.take('break')) return {t:'break'};
    if (this.take('continue')) return {t:'continue'};
    // "type" and "export" are contextual Luau keywords. Permit builtin
    // type(value) in expressions, but reject typed declarations at the
    // declaration keyword's location rather than a later identifier.
    if((this.peek()==='type' && this.tokens[this.i+1]?.type==='id') ||
       (this.peek()==='export' && this.tokens[this.i+1]?.value==='type')){
      throw new SyntaxErrorV3('Unsupported Luau type declaration at '+this.tok().at);
    }
    const lhs=this.expr(10);
    const assignOps=new Set(['+=','-=','*=','/=','//=','%=','^=','..=']);
    if(assignOps.has(this.peek())){
      if(!['var','index'].includes(lhs.t))
        throw new SyntaxErrorV3('Compound assignment target must be name or index');
      const op=this.tok().value;this.i++;
      return {t:'compound',target:lhs,op,value:this.expr()};
    }
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
      const precedence={or:1,and:2,'<':3,'>':3,'<=':3,'>=':3,'==':3,'~=':3,'..':4,'+':5,'-':5,'*':6,'/':6,'//':6,'%':6,'^':8};
      const p=precedence[op];
      if(p===undefined || p<min) break;
      this.i++;
      node={t:'binary',op,left:node,right:this.expr(p+(['^','..'].includes(op)?0:1))};
    }
    return node;
  }
  exprlist(){
    const values=[this.expr()];
    while(this.take(','))values.push(this.expr());
    return values;
  }
  args(){
    this.must('(');const args=[];
    if(!this.take(')')){do{args.push(this.expr());}while(this.take(','));this.must(')');}
    return args;
  }
  parse(){
    try{const body=this.block(new Set());this.must('<eof>');return body;}
    catch(error){
      if(error.code==='V3_UNSUPPORTED_SYNTAX'&&!Number.isInteger(error.offset))
        error.offset=this.tok().at;
      throw error;
    }
  }
}
const OPS=['K','GET','DECL','SET','TABLE','INDEX','PUT','CALL','CLOSURE','RET','RETVOID','RETM','MOV','JUMP','JF','JT','ENTER','EXIT','ADD','SUB','MUL','DIV','MOD','POW','CAT','LT','LE','GT','GE','EQ','NE','NEG','NOT','LEN','FORCONT','NONZERO','GETK','KGET','KK','KDECL','CALLM','MVGET','MVPACK','ITERNEXT','IDIV'];
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
    const expr=(n,multiple=false)=>{
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
        const idx=argSets.push(regs);const dst=reg();
        emit(multiple?'CALLM':'CALL',dst,fn,idx);return dst;
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
        const map={'+':'ADD','-':'SUB','*':'MUL','/':'DIV','//':'IDIV','%':'MOD','^':'POW','..':'CAT','<':'LT','<=':'LE','>':'GT','>=':'GE','==':'EQ','~=':'NE'};
        emit(map[n.op],dst,a,b);return dst;
      }
      throw new SyntaxErrorV3('Unknown AST expression '+n.t);
    };
    const write=(target,value)=>{
      const valueReg=expr(value);
      if(target.t==='var')emit('SET',key(target.name),valueReg);
      else{const objectReg=expr(target.obj),indexReg=expr(target.key);emit('PUT',objectReg,indexReg,valueReg);}
    };
    const compound=(n)=>{
      const map={'+=':'ADD','-=':'SUB','*=':'MUL','/=':'DIV',
        '//=':'IDIV','%=':'MOD','^=':'POW','..=':'CAT'};
      const op=map[n.op];
      if(!op)throw new SyntaxErrorV3('Unsupported compound operator '+n.op);
      let obj,idx,left;
      if(n.target.t==='var'){
        left=reg();emit('GET',left,key(n.target.name));
      } else {
        obj=expr(n.target.obj);idx=expr(n.target.key);
        left=reg();emit('INDEX',left,obj,idx);
      }
      const right=expr(n.value),dst=reg();
      emit(op,dst,left,right);
      if(n.target.t==='var')emit('SET',key(n.target.name),dst);
      else emit('PUT',obj,idx,dst);
    };
    const statements=(body)=>{
      for(const n of body){
        switch(n.t){
          case 'local':{const r=expr(n.value);emit('DECL',key(n.name),r);break;}
          case 'localmulti':{
            // Evaluate every RHS before declaring any local. In Lua/Luau only
            // the final call may expand into extra return values.
            const values=n.values;
            const rhs=values.map((v,i)=>expr(v,i===values.length-1&&
              (v.t==='call'||v.t==='method')));
            const last=values.length-1;
            for(let j=0;j<n.names.length;j++){
              let value;
              if(j<last)value=rhs[j];
              else if(last>=0){
                const tail=values[last];
                if(tail.t==='call'||tail.t==='method'){
                  value=reg();emit('MVGET',value,rhs[last],j-last+1);
                }else if(j===last)value=rhs[last];
              }
              if(!value){value=reg();emit('K',value,key(null));}
              emit('DECL',key(n.names[j]),value);
            }
            break;
          }
          case 'localfun':{
            const nil=expr({t:'nil'});emit('DECL',key(n.name),nil);
            const r=expr(n.fun);emit('SET',key(n.name),r);break;
          }
          case 'assign':write(n.target,n.value);break;
          case 'compound':compound(n);break;
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
          case 'forin':{
            if(!n.iterators.length)throw new SyntaxErrorV3('Missing generic for iterator');
            let iterReg,stateReg,controlReg;
            if(n.iterators.length===1 && ['call','method'].includes(n.iterators[0].t)){
              const values=expr(n.iterators[0],true);
              iterReg=reg();stateReg=reg();controlReg=reg();
              emit('MVGET',iterReg,values,1);
              emit('MVGET',stateReg,values,2);
              emit('MVGET',controlReg,values,3);
            }else if(n.iterators.length<=3){
              const registers=n.iterators.map(v=>expr(v));
              iterReg=registers[0];
              stateReg=registers[1]||reg();
              controlReg=registers[2]||reg();
              if(registers.length<2)emit('K',stateReg,key(null));
              if(registers.length<3)emit('K',controlReg,key(null));
            }else{
              throw new SyntaxErrorV3('Generic for supports up to three iterator expressions');
            }
            const condition=reg();
            const itemRegs=n.names.map(()=>reg());
            const iteratorArgs=argSets.push([iterReg,stateReg,controlReg,condition,...itemRegs]);
            const start=builder.ins.length+1;
            emit('ITERNEXT',iteratorArgs);
            const exit=emit('JF',condition,0);
            const loop={breaks:[],continues:[],depth:builder.depth};builder.loops.push(loop);
            emit('ENTER');builder.depth++;
            for(let j=0;j<n.names.length;j++)emit('DECL',key(n.names[j]),itemRegs[j]);
            statements(n.body);
            builder.depth--;emit('EXIT');
            const continuePc=builder.ins.length+1;
            for(const j of loop.continues)builder.ins[j-1][1]=continuePc;
            emit('JUMP',start);
            const end=builder.ins.length+1;
            builder.ins[exit-1][2]=end;
            for(const j of loop.breaks)builder.ins[j-1][1]=end;
            builder.loops.pop();break;
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
            const loop={breaks:[],continues:[],depth:builder.depth};builder.loops.push(loop);
            emit('ENTER');builder.depth++;
            const current=expr({t:'var',name:hidden});emit('DECL',key(n.name),current);
            statements(n.body);
            builder.depth--;emit('EXIT');
            const continuePc=builder.ins.length+1;
            for(const j of loop.continues)builder.ins[j-1][1]=continuePc;
            const next=reg();emit('ADD',next,curr,stepR);emit('SET',key(hidden),next);
            emit('JUMP',start);
            const end=builder.ins.length+1;
            builder.ins[exit-1][2]=end;
            for(const j of loop.breaks)builder.ins[j-1][1]=end;
            builder.loops.pop();builder.depth--;emit('EXIT');break;
          }
          case 'repeat':{
            const start=builder.ins.length+1;
            const loop={breaks:[],continues:[],repeat:true,depth:builder.depth};builder.loops.push(loop);
            emit('ENTER');builder.depth++;
            statements(n.body);
            const continuePc=builder.ins.length+1;
            for(const j of loop.continues)builder.ins[j-1][1]=continuePc;
            const test=expr(n.condition);
            builder.depth--;emit('EXIT');emit('JF',test,start);
            const end=builder.ins.length+1;
            for(const j of loop.breaks)builder.ins[j-1][1]=end;
            builder.loops.pop();break;
          }
          case 'while':{
            const start=builder.ins.length+1;
            const r=expr(n.condition),exit=emit('JF',r,0);
            const loop={breaks:[],continues:[],depth:builder.depth};builder.loops.push(loop);
            scope(n.body);
            for(const j of loop.continues)builder.ins[j-1][1]=start;
            emit('JUMP',start);
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
          case 'continue':{
            const loop=builder.loops[builder.loops.length-1];
            if(!loop)throw new SyntaxErrorV3('continue outside a loop');
            const retain=loop.repeat ? loop.depth+1 : loop.depth;
            for(let i=builder.depth;i>retain;i--)emit('EXIT');
            loop.continues.push(emit('JUMP',0));break;
          }
          case 'return':{
            const values=n.values;
            if(values.length===0){emit('RETVOID');break;}
            const tail=values[values.length-1];
            const expand=['call','method'].includes(tail.t);
            if(values.length===1&&!expand){
              emit('RET',expr(tail));break;
            }
            // Only the final function call is expanded, like native Luau.
            // Any earlier calls are evaluated for exactly their first result.
            const registers=values.map((value,i)=>expr(value,expand&&i===values.length-1));
            emit('RETM',argSets.push(registers),expand?1:0);
            break;
          }
          default:throw new SyntaxErrorV3('Unsupported statement type '+n.t);
        }
        if(builder.ins.length>12000)throw new SyntaxErrorV3('V3 instruction limit exceeded');
      }
    };
    statements(ast);emit('RETVOID');
    funcs[id-1]={p:params.map(key),ins:builder.ins};
    return id;
  };
  const initialEntry=makeBuilder(parsed,[]);
  // Compile-time superinstruction pass: coalesce adjacent, independent loads
  // or a constant initialization + local declaration. JUMP/JF/JT destination
  // indices are relocated after the rewrite. Never fuse across a branch target.
  //
  // This changes the compiled instruction language, not just its display.
  // It makes naive one-to-one opcode lifting less universal, but it is still
  // invertible with runtime instrumentation; no client-side VM is a secret.
  const fusionCounts={GETK:0,KGET:0,KK:0,KDECL:0};
  if(options.superInstructions!==false){
    for(const fn of funcs){
      const before=fn.ins;
      const targets=new Set();
      for(const row of before){
        if(row[0]===codes.JUMP)targets.add(row[1]);
        else if(row[0]===codes.JF||row[0]===codes.JT)targets.add(row[2]);
      }
      const relocated=Array(before.length+2).fill(0),output=[];
      let pos=1;
      while(pos<=before.length){
        const one=before[pos-1],two=before[pos];
        const canMerge=two&&!targets.has(pos+1)&&rand(100)<82;
        let kind=null;
        if(canMerge){
          if(one[0]===codes.GET&&two[0]===codes.K&&one[1]!==two[1])kind='GETK';
          else if(one[0]===codes.K&&two[0]===codes.GET&&one[1]!==two[1])kind='KGET';
          else if(one[0]===codes.K&&two[0]===codes.K&&one[1]!==two[1])kind='KK';
          else if(one[0]===codes.K&&two[0]===codes.DECL&&one[1]===two[2])kind='KDECL';
        }
        relocated[pos]=output.length+1;
        if(kind){
          relocated[pos+1]=output.length+1;
          let row;
          if(kind==='KDECL')row=[codes.KDECL,one[1],one[2],two[1]];
          else row=[codes[kind],one[2],two[2],argSets.push([one[1],two[1]])];
          output.push(row);fusionCounts[kind]++;pos+=2;
        } else{
          output.push(one.slice());pos++;
        }
      }
      relocated[before.length+1]=output.length+1;
      for(const row of output){
        if(row[0]===codes.JUMP){
          if(!relocated[row[1]])throw new Error('Invalid fused jump target');
          row[1]=relocated[row[1]];
        } else if(row[0]===codes.JF||row[0]===codes.JT){
          if(!relocated[row[2]])throw new Error('Invalid fused conditional target');
          row[2]=relocated[row[2]];
        }
      }
      fn.ins=output;
    }
  }
  const fusionTotal=Object.values(fusionCounts).reduce((a,b)=>a+b,0);


  // A function index must not disclose the root prototype or lexical order.
  // Shuffle the prototype registry each build and fix all CLOSURE operands
  // before packing and masking the bytecode. This is structural polymorphism.
  const order=Array.from({length:funcs.length},(_,i)=>i+1);
  for(let i=order.length-1;i>0;i--){
    const j=rand(i+1);[order[i],order[j]]=[order[j],order[i]];
  }
  const reloc=new Map(order.map((oldIndex,newIndex)=>[oldIndex,newIndex+1]));
  const oldFunctions=funcs.slice();
  for(let i=0;i<funcs.length;i++)funcs[i]=oldFunctions[order[i]-1];
  for(const fn of funcs)for(const row of fn.ins){
    if(row[0]===codes.CLOSURE)row[2]=reloc.get(row[2]);
  }
  const entry=reloc.get(initialEntry);
  // Each function becomes a compact, per-build sealed binary bytecode blob.
  // It raises the cost of casual inspection, NOT the cryptographic secrecy of
  // client-side code: the decoder and its seeds must travel with the output.
  const salt=crypto.randomInt(2000,100000);
  const modulus=10000019, hashMod=1000000007;
  // Build-scoped opcode ids are further masked per function and instruction PC.
  // A static row no longer carries an opcode that can be mapped with one
  // global subtraction. This is polymorphism, not secret encryption.
  const packed=funcs.map(f=>{
    const opSeed=rand(255)+1;
    const ins=f.ins.map((row,idx)=>row.map((n,j)=>{
      const masked=j===0 ? (n ^ ((opSeed+(idx+1)*41)%256)) : n;
      return (masked+salt+5*(j+1)+modulus)%modulus;
    }));
    return {p:f.p,ins,opSeed};
  });
  // Independent S-Box per build; a full inverse table travels with standalone
  // output, so this adds static-analysis work, not secret key confidentiality.
  const sbox=Array.from({length:256},(_,i)=>i);
  for(let i=255;i>0;i--){
    const j=rand(i+1);[sbox[i],sbox[j]]=[sbox[j],sbox[i]];
  }
  const inverse=Array(256);
  for(let i=0;i<256;i++)inverse[sbox[i]]=i;
  const sboxMask=rand(256);
  const maskedInverse=inverse.map((value,index)=>
    value^((sboxMask+index*17)%256));
  const seedMask=(kind,index)=>
    ((salt+(kind+3)*7919+index*1543)%65536);
  function seal(bytes,seed) {
    let state=seed,prev=0;
    return bytes.map((plain,i)=>{
      const j=i+1;
      state=(state*73+41+(j%251))%65521;
      const mask=(state%256) ^ ((state>>>8)%256);
      const encoded=(sbox[plain] ^ mask ^ prev)&255;
      prev=encoded;
      return encoded;
    });
  }
  function pack32(int,bytes) {
    if(!Number.isSafeInteger(int)||int<0||int>0xffffffff)throw new SyntaxErrorV3('Bytecode integer out of range');
    bytes.push(int&255,(int>>>8)&255,(int>>>16)&255,(int>>>24)&255);
  }
  function pack16(int,bytes) {
    if(!Number.isSafeInteger(int)||int<0||int>0xffff)throw new SyntaxErrorV3('Too many registers or instructions');
    bytes.push(int&255,(int>>>8)&255);
  }
  function pack24(int,bytes) {
    if(!Number.isSafeInteger(int)||int<0||int>0xffffff)
      throw new SyntaxErrorV3('Compact operand value out of range');
    bytes.push(int&255,(int>>>8)&255,(int>>>16)&255);
  }
  const sealedFunctions=packed.map(f=>{
    const raw=[];
    const width=options.bytecodeWidth==='compact'?3:
      options.bytecodeWidth==='wide'?4:(rand(2)===0?3:4);
    const slots=[0,1,2,3];
    for(let i=slots.length-1;i>0;i--){
      const j=rand(i+1);[slots[i],slots[j]]=[slots[j],slots[i]];
    }
    const offsets=slots.map((_,logical)=>slots.indexOf(logical));
    pack16(f.p.length,raw);
    pack16(f.ins.length,raw);
    raw.push(f.opSeed,width,...offsets);
    for(const v of f.p)pack32(v,raw);
    for(const row of f.ins){
      for(const slot of slots){
        if(width===3)pack24(row[slot],raw);
        else pack32(row[slot],raw);
      }
    }
    const seed=rand(60000)+1000;
    return [seed,seal(raw,seed),width];
  });
  const sealedConstants=consts.map(value=>{
    const typ=value===null?5:typeof value==='string'?1:typeof value==='number'?2:value===true?3:4;
    const raw=(typ===1||typ===2)?[...Buffer.from(String(value),'utf8')]:[];
    const seed=rand(60000)+1000;
    return [typ,seed,seal(raw,seed)];
  });
  // NativeV3 payload layout v2: a per-build shuffled 64-symbol alphabet,
  // sealed binary -> radix-64 strings, then small interleaved and reordered
  // segments. The VM data is never written as obvious \ddd Lua escapes.
  // This adds static analysis friction; the client-side decoder is reversible.
  const symbolSet=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'];
  for(let i=symbolSet.length-1;i>0;i--){
    const j=rand(i+1);[symbolSet[i],symbolSet[j]]=[symbolSet[j],symbolSet[i]];
  }
  const alphabet=symbolSet.join('');
  const asRadix64=bytes=>{
    let out='';
    for(let i=0;i<bytes.length;i+=3){
      const a=bytes[i],b=bytes[i+1]||0,c=bytes[i+2]||0;
      const v=a*65536+b*256+c;
      out+=alphabet[Math.floor(v/262144)];
      out+=alphabet[Math.floor(v/4096)%64];
      if(i+1<bytes.length)out+=alphabet[Math.floor(v/64)%64];
      if(i+2<bytes.length)out+=alphabet[v%64];
    }
    return out;
  };
  const fragments=[];
  const segment=bytes=>{
    const encoded=asRadix64(bytes),parts=[];
    for(let at=0;at<encoded.length;){
      const len=Math.min(encoded.length-at,37+rand(61));
      parts.push(fragments.length);
      fragments.push(encoded.slice(at,at+len));
      at+=len;
    }
    return parts;
  };
  const sealedFunctionRefs=sealedFunctions.map(([seed,bytes],i)=>
    [seed^seedMask(1,i+1),segment(bytes)]);
  const sealedConstantRefs=sealedConstants.map(([typ,seed,bytes],i)=>
    [typ,seed^seedMask(2,i+1),segment(bytes)]);
  const inverseParts=segment(maskedInverse);
  const segmentOrder=Array.from({length:fragments.length},(_,i)=>i);
  for(let i=segmentOrder.length-1;i>0;i--){
    const j=rand(i+1);[segmentOrder[i],segmentOrder[j]]=[segmentOrder[j],segmentOrder[i]];
  }
  const positions=new Map(segmentOrder.map((old,i)=>[old,i+1]));
  const refs=parts=>'{'+parts.map(id=>positions.get(id)).join(',')+'}';
  const luaFragments='{'+segmentOrder.map(id=>JSON.stringify(fragments[id])).join(',')+'}';
  const luaFunctions='{'+sealedFunctionRefs.map(([seed,parts])=>'{'+seed+','+refs(parts)+'}').join(',')+'}';
  const luaConstants='{'+sealedConstantRefs.map(([typ,seed,parts])=>'{'+typ+','+seed+','+refs(parts)+'}').join(',')+'}';
  const luaInverse=refs(inverseParts);
  const randomName=()=>('_'+Array.from({length:7},()=>String.fromCharCode(97+rand(26))).join(''));
  const blobName=randomName(),alphabetName=randomName(),mapName=randomName(),unpackName=randomName();
  const inverseName=randomName(),inverseRefsName=randomName();
  const sboxMaskScrambled=sboxMask^(salt%256);
  const luaArgs=JSON.stringify(argSets).replace(/\[/g,'{').replace(/\]/g,'}');
  let digest=17;
  const mix=(n)=>{digest=(digest*131+n+1)%hashMod;};
  for(const [seed,bytes] of sealedFunctionRefs.map(([seed],i)=>[seed,sealedFunctions[i][1]])){
    mix(seed);mix(bytes.length);bytes.forEach(mix);
  }
  for(const [typ,seed,bytes] of sealedConstantRefs.map(([typ,seed],i)=>[typ,seed,sealedConstants[i][2]])){
    mix(typ);mix(seed);mix(bytes.length);bytes.forEach(mix);
  }
  mix(maskedInverse.length);maskedInverse.forEach(mix);
  mix(salt);mix(sboxMask);
  for(const args of argSets){mix(args.length);args.forEach(mix);}
  const lines=[
    '-- BLACKMAMER VM V3.4',
    'return (function(...)',
    '  local '+blobName+'='+luaFragments,
    '  local '+alphabetName+'='+JSON.stringify(alphabet),
    '  local E=' + luaFunctions,
    '  local Q=' + luaConstants,
    '  local A=' + luaArgs,
    '  local '+inverseRefsName+'='+luaInverse,
    '  local SALT=' + salt + '; local CHECK=' + digest,
    '  local SBOX_MASK=bit32.bxor(SALT%256,'+sboxMaskScrambled+')',
    '  local modulus=' + modulus + '; local hmod=' + hashMod,
    '  local nativeByte=string.byte; local nativeChar=string.char; local nativeConcat=table.concat',
    '  local nativeUnpack=table.unpack or unpack; local bxor=bit32 and bit32.bxor',
    '  local nativePack=table.pack or function(...)return {n=select("#",...),...}end',
    '  local nativeType=type; local nativePcall=pcall; local nativeError=error',
    '  local dbg=debug; local globals=(getfenv and getfenv()) or _ENV or _G',
    '  if nativeType(bxor)~="function" then nativeError("BLACKMAMER V3 requires Luau bit32") end',
    '  local '+mapName+'={}',
    '  for i=1,#'+alphabetName+' do '+mapName+'[nativeByte('+alphabetName+',i)]=i-1 end',
    '  local function '+unpackName+'(ids)',
    '    local parts={};for i,id in ipairs(ids)do parts[i]='+blobName+'[id] end',
    '    local data=nativeConcat(parts);local result={};local at=1;local n=#data',
    '    while at<=n do',
    '      local c1='+mapName+'[nativeByte(data,at)]',
    '      local c2='+mapName+'[nativeByte(data,at+1)]',
    '      if c1==nil or c2==nil then nativeError("BLACKMAMER V3 malformed block") end',
    '      local v=c1*262144+c2*4096',
    '      local has3=(at+2<=n)',
    '      if has3 then local c3='+mapName+'[nativeByte(data,at+2)]',
    '        if c3==nil then nativeError("BLACKMAMER V3 invalid encoded block") end',
    '        v=v+c3*64 end',
    '      local has4=(at+3<=n)',
    '      if has4 then local c4='+mapName+'[nativeByte(data,at+3)]',
    '        if c4==nil then nativeError("BLACKMAMER V3 invalid encoded block") end',
    '        v=v+c4 end',
    '      result[#result+1]=nativeChar(math.floor(v/65536)%256)',
    '      if has3 then result[#result+1]=nativeChar(math.floor(v/256)%256) end',
    '      if has4 then result[#result+1]=nativeChar(v%256) end',
    '      at=at+4',
    '    end',
    '    return nativeConcat(result)',
    '  end',
    '  for _,b in ipairs(E)do b[2]='+unpackName+'(b[2])end',
    '  for _,b in ipairs(Q)do b[3]='+unpackName+'(b[3])end',
    '  local '+inverseName+'='+unpackName+'('+inverseRefsName+')',
    '  '+blobName+'=nil;'+alphabetName+'=nil;'+mapName+'=nil;'+inverseRefsName+'=nil',
    '  local function verify()',
    '    local h=17;local function mix(v)h=(h*131+v+1)%hmod end',
    '    for _,f in ipairs(E)do mix(f[1]);mix(#f[2]);for j=1,#f[2]do mix(nativeByte(f[2],j))end end',
    '    for _,v in ipairs(Q)do mix(v[1]);mix(v[2]);mix(#v[3]);for j=1,#v[3]do mix(nativeByte(v[3],j))end end',
    '    mix(#'+inverseName+');for j=1,#'+inverseName+' do mix(nativeByte('+inverseName+',j)) end',
    '    mix(SALT);mix(SBOX_MASK)',
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
    '      local substituted=bxor(cipher,mask,prev)',
    '      out[j]=bxor(nativeByte('+inverseName+',substituted+1),(SBOX_MASK+substituted*17)%256)',
    '      prev=cipher',
    '    end',
    '    return out',
    '  end',
    '  local P={}',
    '  local bufFrom=buffer and buffer.fromstring',
    '  local bufRead=buffer and buffer.readu8',
    '  local bufRead32=buffer and buffer.readu32',
    '  if nativeType(bufFrom)~="function" or nativeType(bufRead)~="function" or nativeType(bufRead32)~="function" then',
    '    nativeError("BLACKMAMER V3.3 requires Roblox Luau buffer API") end',

    '  local function prototype(fid)',
    '    local cached=P[fid];if cached then return cached end',
    '    local bundle=E[fid];if not bundle then nativeError("BLACKMAMER V3 invalid function")end',
    '    local realSeed=bxor(bundle[1],(SALT+(1+3)*7919+fid*1543)%65536)',
    '    local raw=unseal(bundle[2],realSeed);local chars={}',
    '    for j,b in ipairs(raw)do chars[j]=nativeChar(b)end',
    '    local packed=bufFrom(nativeConcat(chars))',
    '    local pn=bufRead(packed,0)+256*bufRead(packed,1)',
    '    local count=bufRead(packed,2)+256*bufRead(packed,3)',
    '    local opSeed=bufRead(packed,4);local width=bufRead(packed,5);local off=10',
    '    if width~=3 and width~=4 then nativeError("BLACKMAMER V3 invalid instruction width") end',
    '    local offsets={}',
    '    for j=1,4 do offsets[j]=bufRead(packed,5+j) end',
    '    local seen={};for j=1,4 do',
    '      if offsets[j]>3 or seen[offsets[j]] then nativeError("BLACKMAMER V3 invalid operand map") end',
    '      seen[offsets[j]]=true',
    '    end',
    '    local params={}',
    '    for j=1,pn do params[j]=bufRead32(packed,off);off=off+4 end',
    '    -- Each prototype independently chooses compact/wide and operand order.',
    '    local spec={params,packed,opSeed,off,count,width,offsets}',
    '    P[fid]=spec;return spec',
    '  end',
    '  -- A constant stays sealed until the executing function first references it.',
    '  -- This reduces startup plaintext, but does not hide decode keys from a client.',
    '  local constantCache={};local constantNil={}',
    '  local function K(index)',
    '    local cached=constantCache[index]',
    '    if cached~=nil then',
    '      if cached==constantNil then return nil end',
    '      return cached',
    '    end',
    '    local entry=Q[index]',
    '    if not entry then nativeError("BLACKMAMER V3 invalid constant") end',
    '    local typ=entry[1];local value',
    '    if typ==5 then value=nil elseif typ==3 then value=true elseif typ==4 then value=false',
    '    else local seed=bxor(entry[2],(SALT+(2+3)*7919+index*1543)%65536)',
    '      local bytes=unseal(entry[3],seed);local output={}',
    '      for j,b in ipairs(bytes) do output[j]=nativeChar(b) end',
    '      local str=nativeConcat(output);value=(typ==2) and tonumber(str) or str end',
    '    constantCache[index]=value==nil and constantNil or value',
    '    return value',
    '  end',
    '  local NIL={};local function nonil(v)if v==NIL then return nil else return v end end',
    '  local exec',
    '  exec=function(fid,passed,captured)',
    '    local spec=prototype(fid)',
    '    local env={vars={},parent=captured}',
    '    for j,k in ipairs(spec[1])do local v=passed[j];env.vars[K(k)]=v==nil and NIL or v end',
    '    local R={};local pc=1;local ticks=0;local stream=spec[2];local off=spec[4];local length=spec[5]',
    '    local width=spec[6];local offsets=spec[7]',
    '    local function field(at,logical)',
    '      local p=at+offsets[logical]*width',
    '      if width==4 then return bufRead32(stream,p) end',
    '      return bufRead(stream,p)+bufRead(stream,p+1)*256+bufRead(stream,p+2)*65536',
    '    end',
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
    '      if pc<1 or pc>length then nativeError("BLACKMAMER V3 bad PC") end',
    '      local at=off+(pc-1)*4*width',
    '      local op=bxor((field(at,1)-SALT-5)%modulus,(spec[3]+pc*41)%256)',
    '      local a=((field(at,2)-SALT-10)%modulus);if a>modulus/2 then a=a-modulus end',
    '      local b=((field(at,3)-SALT-15)%modulus);if b>modulus/2 then b=b-modulus end',
    '      local c=((field(at,4)-SALT-20)%modulus);if c>modulus/2 then c=c-modulus end',
    '      local nextpc=pc+1',
    '      if op==O.K then R[a]=K(b)',
    '      elseif op==O.GET then R[a]=get(K(b))',
    '      elseif op==O.GETK then local pair=A[c];R[pair[1]]=get(K(a));R[pair[2]]=K(b)',
    '      elseif op==O.KGET then local pair=A[c];R[pair[1]]=K(a);R[pair[2]]=get(K(b))',
    '      elseif op==O.KK then local pair=A[c];R[pair[1]]=K(a);R[pair[2]]=K(b)',
    '      elseif op==O.KDECL then local value=K(b);R[a]=value;env.vars[K(c)]=value==nil and NIL or value',
    '      elseif op==O.DECL then local v=R[b];env.vars[K(a)]=v==nil and NIL or v',
    '      elseif op==O.SET then set(K(a),R[b])',
    '      elseif op==O.TABLE then R[a]={}',
    '      elseif op==O.INDEX then R[a]=R[b][R[c]]',
    '      elseif op==O.PUT then R[a][R[b]]=R[c]',
    '      elseif op==O.MOV then R[a]=R[b]',
    '      elseif op==O.CALL then local args=A[c] or {};local vals={};for j,v in ipairs(args)do vals[j]=R[v]end',
    '        R[a]=R[b](nativeUnpack(vals,1,#args))',
    '      elseif op==O.CALLM then local args=A[c] or {};local vals={};for j,v in ipairs(args)do vals[j]=R[v]end',
    '        R[a]=nativePack(R[b](nativeUnpack(vals,1,#args)))',
    '      elseif op==O.MVGET then R[a]=R[b][c]',
    '      elseif op==O.MVPACK then local list=A[b] or {};local vals={};for j,v in ipairs(list)do vals[j]=R[v]end',
    '        R[a]=vals',
    '      elseif op==O.ITERNEXT then local list=A[a]',
    '        local iterator=R[list[1]]',
    '        if nativeType(iterator)=="table" then',
    '          local mt=getmetatable(iterator)',
    '          if nativeType(mt)=="table" and nativeType(mt.__iter)=="function" then',
    '            local f,s,ctrl=mt.__iter(iterator)',
    '            R[list[1]]=f;R[list[2]]=s;R[list[3]]=ctrl',
    '          else',
    '            R[list[1]]=next;R[list[2]]=iterator;R[list[3]]=nil',
    '          end',
    '        end',
    '        local args=nativePack(R[list[1]](R[list[2]],R[list[3]]))',
    '        local control=args[1];R[list[3]]=control;R[list[4]]=control~=nil',
    '        for j=5,#list do R[list[j]]=args[j-4] end',
    '      elseif op==O.CLOSURE then local capture=env;R[a]=function(...)return exec(b,{...},capture)end',
    '      elseif op==O.RET then return a==0 and nil or R[a]',
    '      elseif op==O.RETVOID then return',
    '      elseif op==O.RETM then local regs=A[a];local vals={};local count=0',
    '        for j=1,#regs do',
    '          if j==#regs and b==1 then',
    '            local tail=R[regs[j]];local n=tail.n',
    '            for k=1,n do count=count+1;vals[count]=tail[k] end',
    '          else count=count+1;vals[count]=R[regs[j]] end',
    '        end',
    '        return nativeUnpack(vals,1,count)',
    '      elseif op==O.JUMP then nextpc=a',
    '      elseif op==O.JF then if not R[a] then nextpc=b end',
    '      elseif op==O.JT then if R[a] then nextpc=b end',
    '      elseif op==O.ENTER then env={vars={},parent=env}',
    '      elseif op==O.EXIT then env=env.parent',
    '      elseif op==O.ADD then R[a]=R[b]+R[c]',
    '      elseif op==O.SUB then R[a]=R[b]-R[c]',
    '      elseif op==O.MUL then R[a]=R[b]*R[c]',
    '      elseif op==O.DIV then R[a]=R[b]/R[c]',
    '      elseif op==O.IDIV then R[a]=math.floor(R[b]/R[c])',
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
  // Per-build polymorphic dispatcher: two distinct control-flow topologies.
  // Each handler is still a real VM instruction, but there is one shared
  // invalid-opcode guard rather than a repeated else/error at every leaf.
  // The guard is essential: a corrupt/unknown opcode must never fall through.
  const gcd=(a,b)=>{while(b){[a,b]=[b,a%b];}return a;};
  const opcodeName=part=>{
    const match=/^\s*(?:if|elseif) op==O\.([A-Z]+) then/.exec(part[0]);
    if(!match)throw new Error('Unrecognized dispatcher handler');
    return match[1];
  };
  const guardedName='_d'+crypto.randomBytes(5).toString('hex');
  const emitHandler=(part,head,indent)=>{
    // Preserve an instruction's inline body, e.g. "then R[a]=K(b)".
    const tail=/\bthen(.*)$/.exec(part[0]);
    if(!tail)throw new Error('Malformed opcode handler body');
    return [indent+head+' '+guardedName+'=true;'+tail[1],...part.slice(1)];
  };
  const useTree=options.dispatchMode==='tree'||
    (options.dispatchMode!=='shard'&&rand(2)===0);
  const dispatch=['      local '+guardedName+'=false'];
  let dispatchStructure;
  if(useTree){
    // A sorted decision tree has a different structure from modulo shards;
    // nodes change when per-build opcode IDs are permuted.
    const sorted=[...handlers].sort((x,y)=>
      codes[opcodeName(x)]-codes[opcodeName(y)]);
    const tree=(items,depth)=>{
      if(items.length===0)return [];
      const pad=' '.repeat(depth);
      const mid=Math.floor(items.length/2);
      const pivot=items[mid],tag='O.'+opcodeName(pivot);
      if(items.length===1){
        return [...emitHandler(pivot,'if op=='+tag+' then',pad),
          pad+'end'];
      }
      const out=[pad+'if op<'+tag+' then'];
      out.push(...tree(items.slice(0,mid),depth+2));
      out.push(pad+'elseif op>'+tag+' then');
      out.push(...tree(items.slice(mid+1),depth+2));
      out.push(...emitHandler(pivot,'else',pad));
      out.push(pad+'end');
      return out;
    };
    dispatch.push(...tree(sorted,6));
    dispatchStructure='tree';
  }else{
    // Choose only multipliers coprime to bucket count; all shards populated.
    const values=handlers.map(part=>codes[opcodeName(part)]);
    const counts=[5,6,7];
    for(let i=counts.length-1;i>0;i--){
      const j=rand(i+1);[counts[i],counts[j]]=[counts[j],counts[i]];
    }
    const choices=[...new Set([...counts,4,3])].filter(n=>
      new Set(values.map(op=>op%n)).size===n);
    if(!choices.length)throw new Error('Unable to partition VM opcode handlers');
    const shardCount=choices[0];
    const multipliers=Array.from({length:180},(_,i)=>i+17)
      .filter(value=>gcd(value,shardCount)===1);
    const mul=multipliers[rand(multipliers.length)],bias=rand(2000)+1;
    const buckets=Array.from({length:shardCount},()=>[]);
    for(const part of handlers){
      const bucket=(codes[opcodeName(part)]*mul+bias)%shardCount;
      buckets[bucket].push(part);
    }
    if(buckets.some(x=>x.length===0))
      throw new Error('Empty dispatcher bucket');
    for(let bucket=0;bucket<shardCount;bucket++){
      const parts=buckets[bucket],keyword=bucket===0?'if':'elseif';
      dispatch.push('      '+keyword+
        ' ((op*'+mul+'+'+bias+')%'+shardCount+')=='+bucket+' then');
      for(let i=0;i<parts.length;i++){
        dispatch.push(...emitHandler(parts[i],
          (i===0?'if':'elseif')+' op==O.'+opcodeName(parts[i])+' then',
          '        '));
      }
      dispatch.push('        end');
    }
    dispatch.push('      end');
    dispatchStructure='shard';
  }
  dispatch.push('      if not '+guardedName+
    ' then nativeError("BLACKMAMER V3 invalid opcode") end');
  lines.splice(dispatchStart,dispatchEnd-dispatchStart+1,...dispatch);
  const code=lines.join('\n').replace(/\bO\.([A-Z]+)\b/g,(_,name)=>{
    if(!Object.hasOwn(codes,name)) throw new Error('Unknown VM opcode '+name);
    return String(codes[name]);
  });
  return {code,engine:'BLACKMAMER V3 Native VM',virtualizedFunctions:funcs.length,
    bytecodeLayout:'per-prototype-shuffled-12-or-16',
    bytecodeWidths:{compact:sealedFunctions.filter(f=>f[2]===3).length,
      wide:sealedFunctions.filter(f=>f[2]===4).length},
    dispatchStructure,
    fusedInstructions:fusionTotal,superInstructionKinds:fusionCounts,
    vmInstructions:funcs.reduce((n,f)=>n+f.ins.length,0),
    antiTamper: options.antiTamper!==false, antiDebug: options.antiDebug!==false};
}
module.exports={compile,lex,Parser,SyntaxErrorV3};
