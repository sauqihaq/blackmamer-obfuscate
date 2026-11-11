'use strict';
// BLACKMAMER VM V3 - independent, opt-in Lua/Luau subset compiler.
// No Prometheus/Vmify step in this engine. Unsupported syntax fails closed.
const crypto = require('node:crypto');
const {compactLuau} = require('./lua-output-compact');
const {sealBatch} = require('./native-sealer');
const {requireKey,requireId,encryptBytes,runtimeLines:protectedRuntimeLines} = require('./protected-functions');
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

// Independently implemented AST decoys and bytecode CFG flattening.
// No Prometheus source code is used: both transforms operate on BLACKMAMER's
// own parser AST and IR and are verified by runtime differential tests.
const V4_PROFILES=Object.freeze({
  Minify:{deadChance:0,astFlatten:0,flatten:false,nested:false,fusion:false},
  Light:{deadChance:0.06,astFlatten:0,flatten:false,nested:false,fusion:true},
  Medium:{deadChance:0.13,astFlatten:0.14,flatten:true,nested:true,fusion:true},
  Strong:{deadChance:0.23,astFlatten:0.34,flatten:true,nested:true,fusion:true},
  Maximum:{deadChance:0.36,astFlatten:0.75,flatten:true,nested:true,fusion:true}
});

function flattenSimpleAstSequences(root,chance){
  if(chance<=0)return 0;
  let groups=0;
  const visit=obj=>{
    if(!obj||typeof obj!=='object')return;
    if(Array.isArray(obj)){obj.forEach(visit);return;}
    for(const [key,value] of Object.entries(obj)){
      if((key==='body'||key==='otherwise') && Array.isArray(value))
        visitBlock(value);
      else visit(value);
    }
  };
  const eligible=node=>node&&(node.t==='assign'||node.t==='callstmt');
  const visitBlock=block=>{
    for(const n of block)visit(n);
    const output=[];
    for(let i=0;i<block.length;){
      let end=i;
      while(end<block.length&&eligible(block[end])&&end<i+4)end++;
      const length=end-i;
      if(length<2||rand(1000)>=Math.floor(chance*1000)){
        output.push(block[i++]);continue;
      }
      const chunk=block.slice(i,end);
      const state='__bm_cf_'+crypto.randomBytes(6).toString('hex');
      const testValue=k=>({t:'binary',op:'==',left:{t:'var',name:state},
        right:{t:'num',value:k}});
      const branches=chunk.map((stmt,j)=>({
        condition:testValue(j+1),
        body:[stmt,{t:'assign',target:{t:'var',name:state},
          value:{t:'num',value:j+2}}]
      }));
      output.push({t:'do',body:[
        {t:'local',name:state,value:{t:'num',value:1}},
        {t:'while',condition:{t:'binary',op:'<=',
          left:{t:'var',name:state},right:{t:'num',value:chunk.length}},
          body:[{t:'if',branches,otherwise:[]}]}
      ]});
      groups++;i=end;
    }
    block.splice(0,block.length,...output);
  };
  visitBlock(root);
  return groups;
}


// Compile-time lexical binding virtualization. This is an independent,
// scope-aware AST transform; globals and public field/method names are left
// untouched because changing them would alter Roblox API calls. Renaming is
// applied to parameters, captured upvalues and shadowed locals together.
function virtualizeLexicalBindings(ast){
  let renamed=0;
  const newScope=parent=>({parent,names:new Map()});
  const resolve=(scope,name)=>{
    for(let s=scope;s;s=s.parent)if(s.names.has(name))return s.names.get(name);
    return name;
  };
  const declare=(scope,name)=>{
    const alias='_'+crypto.randomBytes(11).toString('hex');
    scope.names.set(name,alias);
    renamed++;
    return alias;
  };
  const visitExpr=(node,scope)=>{
    if(!node||typeof node!=='object')return;
    if(node.t==='var'){node.name=resolve(scope,node.name);return;}
    if(node.t==='fun'){
      const inner=newScope(scope);
      node.params=node.params.map(name=>declare(inner,name));
      visitStatements(node.body,inner);return;
    }
    if(node.t==='table'){for(const f of node.fields){visitExpr(f.key,scope);visitExpr(f.value,scope);}return;}
    if(node.t==='index'){visitExpr(node.obj,scope);visitExpr(node.key,scope);return;}
    if(node.t==='method'){visitExpr(node.obj,scope);for(const a of node.args)visitExpr(a,scope);return;}
    if(node.t==='call'){visitExpr(node.fn,scope);for(const a of node.args)visitExpr(a,scope);return;}
    if(node.t==='unary'){visitExpr(node.x,scope);return;}
    if(node.t==='binary'){visitExpr(node.left,scope);visitExpr(node.right,scope);return;}
    if(node.t==='ifexpr'){
      for(const b of node.branches){visitExpr(b.condition,scope);visitExpr(b.value,scope);}
      visitExpr(node.otherwise,scope);
    }
  };
  const visitStatements=(body,scope)=>{
    for(const node of body){
      switch(node.t){
        case 'local':
          visitExpr(node.value,scope);
          node.name=declare(scope,node.name);
          break;
        case 'localmulti':
          node.values.forEach(v=>visitExpr(v,scope));
          node.names=node.names.map(name=>declare(scope,name));
          break;
        case 'localfun':
          node.name=declare(scope,node.name);
          visitExpr(node.fun,scope);
          break;
        case 'assign':case 'compound':
          visitExpr(node.target,scope);visitExpr(node.value,scope);break;
        case 'callstmt':
          visitExpr(node.value,scope);break;
        case 'return':
          node.values.forEach(v=>visitExpr(v,scope));break;
        case 'do':
          visitStatements(node.body,newScope(scope));break;
        case 'if':
          for(const b of node.branches){
            visitExpr(b.condition,scope);
            visitStatements(b.body,newScope(scope));
          }
          visitStatements(node.otherwise,newScope(scope));break;
        case 'while':
          visitExpr(node.condition,scope);
          visitStatements(node.body,newScope(scope));break;
        case 'repeat':{
          const child=newScope(scope);
          visitStatements(node.body,child);
          visitExpr(node.condition,child);
          break;
        }
        case 'fornum':{
          visitExpr(node.start,scope);visitExpr(node.limit,scope);visitExpr(node.step,scope);
          const child=newScope(scope);node.name=declare(child,node.name);
          visitStatements(node.body,child);break;
        }
        case 'forin':{
          node.iterators.forEach(v=>visitExpr(v,scope));
          const child=newScope(scope);
          node.names=node.names.map(name=>declare(child,name));
          visitStatements(node.body,child);break;
        }
        case 'break':case 'continue':break;
        default:throw new Error('Lexical virtualization encountered unsupported AST '+node.t);
      }
    }
  };
  visitStatements(ast,newScope(null));
  return renamed;
}

function addDeadAstBranches(root,chance){
  if(chance<=0)return 0;
  let injected=0;
  const seen=new WeakSet();
  const visit=obj=>{
    if(!obj || typeof obj!=='object' || seen.has(obj))return;
    seen.add(obj);
    if(Array.isArray(obj)){obj.forEach(visit);return;}
    for(const [name,value] of Object.entries(obj)){
      if((name==='body'||name==='otherwise')&&Array.isArray(value)){
        visitBlock(value);
      }else visit(value);
    }
  };
  const visitBlock=block=>{
    for(const node of block)visit(node);
    const next=[];
    for(const node of block){
      next.push(node);
      if(rand(1000)>=Math.floor(chance*1000))continue;
      const variable='__bmd_'+crypto.randomBytes(6).toString('hex');
      const guard='__bmg_'+crypto.randomBytes(6).toString('hex');
      const n=7+rand(4000);
      // n*(n+1) is even for every integer n. Computing this guard from
      // a scoped runtime local prevents the trivial 'if false' pattern,
      // while remaining side-effect-free and portable across Lua runtimes.
      const ref=()=>({t:'var',name:guard});
      const guardExpr={t:'binary',op:'==',
        left:{t:'binary',op:'%',
          left:{t:'binary',op:'*',
            left:ref(),
            right:{t:'binary',op:'+',left:ref(),right:{t:'num',value:1}}
          },right:{t:'num',value:2}
        },right:{t:'num',value:1}};
      next.push({t:'do',body:[
        {t:'local',name:guard,value:{t:'num',value:n}},
        {t:'if',branches:[{
          condition:guardExpr,
          body:[{t:'local',name:variable,value:{t:'num',value:rand(1000000)+1}}]
        }],otherwise:[]}
      ]});
      injected++;
    }
    block.splice(0,block.length,...next);
  };
  visitBlock(root);
  return injected;
}
function flattenCfgInstructions(rows,codes){
  if(rows.length<3)return {rows,blocks:0,bridges:0};
  const starts=new Set([1]);
  const len=rows.length;
  for(let i=1;i<=len;i++){
    const op=rows[i-1][0];
    if(op===codes.JUMP || op===codes.JF || op===codes.JT){
      const target=rows[i-1][op===codes.JUMP?1:2];
      if(Number.isInteger(target)&&target>=1&&target<=len)starts.add(target);
    }
    if([codes.JUMP,codes.JF,codes.JT,codes.RET,codes.RETM,codes.RETVOID].includes(op) && i<len)
      starts.add(i+1);
  }
  const begin=[...starts].sort((a,b)=>a-b);
  if(begin.length<2)return {rows,blocks:1,bridges:0};
  const blocks=begin.map((start,index)=>{
    const end=(begin[index+1]||len+1)-1;
    const op=rows[end-1][0];
    const terminal=[codes.JUMP,codes.RET,codes.RETM,codes.RETVOID].includes(op);
    return {start,end,bridge:!terminal && end<len};
  });
  const order=[blocks[0],...blocks.slice(1)];
  for(let i=order.length-1;i>1;i--){const j=1+rand(i);[order[i],order[j]]=[order[j],order[i]];}
  const pcMap=new Map();
  let cursor=1;
  for(const block of order){
    for(let old=block.start;old<=block.end;old++)pcMap.set(old,cursor++);
    if(block.bridge)cursor++;
  }
  const result=[];
  let bridges=0;
  for(const block of order){
    for(let old=block.start;old<=block.end;old++){
      const row=rows[old-1].slice();
      if(row[0]===codes.JUMP){
        row[1]=pcMap.get(row[1]);
      }else if(row[0]===codes.JF || row[0]===codes.JT){
        row[2]=pcMap.get(row[2]);
      }
      if([codes.JUMP,codes.JF,codes.JT].includes(row[0]) &&
        (!Number.isInteger(row[row[0]===codes.JUMP?1:2])))
        throw new Error('CFG flattening encountered invalid branch target');
      result.push(row);
    }
    if(block.bridge){
      const next=pcMap.get(block.end+1);
      if(!next)throw new Error('CFG flattening missing fallthrough');
      result.push([codes.JUMP,next,0,0]);
      bridges++;
    }
  }
  return {rows:result,blocks:blocks.length,bridges};
}

const OPS=['K','GET','DECL','SET','TABLE','INDEX','PUT','CALL','CLOSURE','RET','RETVOID','RETM','MOV','JUMP','JF','JT','ENTER','EXIT','ADD','SUB','MUL','DIV','MOD','POW','CAT','LT','LE','GT','GE','EQ','NE','NEG','NOT','LEN','FORCONT','NONZERO','GETK','KGET','KK','KDECL','CALLM','MVGET','MVPACK','ITERNEXT','IDIV'];
function compile(source, options={}) {
  if(typeof source!=='string') throw new TypeError('Expected Luau source string');
  if(Buffer.byteLength(source)>128*1024) throw new SyntaxErrorV3('V3 source limit: 128 KB');
  const target=options.target||'LuaU';
  const lua51=target==='Lua51'||target==='LuaJIT';
  if(!['LuaU','Lua51','LuaJIT'].includes(target))
    throw new SyntaxErrorV3('Unsupported VM target '+target);
  const profileName=options.hardened ? (options.protectionLevel||'Strong') : 'Strong'; // preserve archived V3 compiler fusion
  const profile=V4_PROFILES[profileName];
  if(!profile)throw new SyntaxErrorV3('V4 protectionLevel must be Minify, Light, Medium, Strong, or Maximum');
  if(lua51){
    const unsupported=new Set(['+=','-=','*=','/=','//=','%=','^=','..=','//','continue','::','->']);
    for(const t of lex(source))if(unsupported.has(t.value))
      throw new SyntaxErrorV3('Lua 5.1/LuaJIT target cannot compile Luau-only syntax: '+t.value);
  }
  const parsed=new Parser(source).parse();
  const astFlattenedGroups=options.hardened?flattenSimpleAstSequences(parsed,profile.astFlatten):0;
  const injectedAstBranches=options.hardened?addDeadAstBranches(parsed,profile.deadChance):0;
  const virtualizedLexicalBindings=options.hardened
    ? virtualizeLexicalBindings(parsed) : 0;
  // V4 defaults to a second independent register-bytecode interpreter.
  // The outer micro-VM decodes every inner VM instruction before dispatch.
  // V3 keeps its original single-VM execution path.
  const nestedVM=options.hardened===true && options.nestedVM!==false && profile.nested;
  // Opt-in encryption. "external" preserves entry for legacy compatibility.
  // "external-full" encrypts the entry too and requires a trusted key
  // provider BEFORE execution (Roblox ServerScriptService or host global).
  // Standalone can encrypt the entry as the decryption key ships with output.
  const autoMode=options.autoFunctionEncryption===undefined?'off':options.autoFunctionEncryption;
  if(!['off','external','external-full','standalone'].includes(autoMode))
    throw new SyntaxErrorV3('autoFunctionEncryption must be off, external, external-full, or standalone');
  if(autoMode!=='off'&&!options.hardened)
    throw new SyntaxErrorV3('Auto Function Encryption requires NativeV4');
  const autoId='BMAUTO_V4';
  const used=new Set(), codes={};
  for(const op of OPS){let id;do{id=rand(220)+17;}while(used.has(id));used.add(id);codes[op]=id;}
  const consts=[], constKeys=new Map(), funcs=[], argSets=[];
  const protectedKeys=new Map(), generatedKeys=[];
  const optionsKeys=options.functionKeys===undefined?{}:options.functionKeys;
  if(!optionsKeys || typeof optionsKeys!=='object' || Array.isArray(optionsKeys))
    throw new SyntaxErrorV3('functionKeys must be an object mapping protected ids to hex keys');
  const keyFor=id=>{
    requireId(id);
    if(!protectedKeys.has(id)){
      if(protectedKeys.size>=32) throw new SyntaxErrorV3('Maximum 32 protected function ids per compilation');
      let hex;
      if(Object.prototype.hasOwnProperty.call(optionsKeys,id)){
        requireKey(optionsKeys[id]);hex=optionsKeys[id].toLowerCase();
      } else {
        hex=crypto.randomBytes(32).toString('hex');
        // A standalone key is bundled (split into two shares) in Luau.
        // Never report it as a secret external key.
        if(!(id===autoId&&autoMode==='standalone'))generatedKeys.push({id,key:hex});
      }
      protectedKeys.set(id,hex);
    }
    return protectedKeys.get(id);
  };
  const key=(value)=>{
    const type=value===null?'nil':typeof value;
    const label=type+':'+String(value);
    if(constKeys.has(label))return constKeys.get(label);
    const idx=consts.length+1;
    constKeys.set(label,idx);consts.push(value);return idx;
  };
  const builders=[];
  const makeBuilder=(ast,params,protectedId=null)=>{
    const id=funcs.length+1;const builder={id,ins:[],regs:0,depth:0,loops:[]};
    funcs.push(null);builders.push(builder);
    // V4 uses an independent random virtual register allocation in each
    // function. Dataflow remains correct because all IR consumers use the
    // returned physical ID rather than assuming sequential register numbers.
    const registerPool=options.hardened?
      Array.from({length:2048},(_,i)=>i+1):null;
    if(registerPool)for(let i=registerPool.length-1;i>0;i--){
      const j=rand(i+1);[registerPool[i],registerPool[j]]=[registerPool[j],registerPool[i]];
    }
    const reg=()=>{
      if(++builder.regs>2048)throw new SyntaxErrorV3('V3 register limit exceeded');
      return registerPool?registerPool[builder.regs-1]:builder.regs;
    };
    const emit=(op,a=0,b=0,c=0)=>{builder.ins.push([codes[op],a,b,c]);return builder.ins.length;};
    const scope=(body)=>{emit('ENTER');builder.depth++;statements(body);builder.depth--;emit('EXIT');};
    const expr=(n,multiple=false)=>{
      if(['nil','bool','str','num'].includes(n.t)){const dst=reg();emit('K',dst,key(n.t==='nil'?null:n.value));return dst;}
      if(n.t==='var'){const dst=reg();emit('GET',dst,key(n.name));return dst;}
      if(n.t==='index'){const obj=expr(n.obj),k=expr(n.key),dst=reg();emit('INDEX',dst,obj,k);return dst;}
      if(n.t==='table'){const dst=reg();emit('TABLE',dst);for(const f of n.fields){const a=expr(f.key),b=expr(f.value);emit('PUT',dst,a,b);}return dst;}
      if(n.t==='fun'){const fnid=makeBuilder(n.body,n.params,protectedId),dst=reg();emit('CLOSURE',dst,fnid);return dst;}
      if(n.t==='call' && n.fn.t==='var' && n.fn.name==='BM_ENCFUNC'){
        if(!options.hardened)throw new SyntaxErrorV3('BM_ENCFUNC requires NativeV4');
        if(n.args.length!==2 || n.args[0].t!=='str' || n.args[1].t!=='fun')
          throw new SyntaxErrorV3('BM_ENCFUNC expects ("id", function(...) ... end)');
        const id=n.args[0].value;
        if(id===autoId)throw new SyntaxErrorV3('BM_ENCFUNC id BMAUTO_V4 is reserved');
        // One-script mode absorbs manual markers into the common standalone
        // key, avoiding surprise external modules even for older sources.
        const effectiveId=autoMode==='standalone'?autoId:id;
        try{keyFor(effectiveId)}catch(error){throw new SyntaxErrorV3(error.message)}
        const fun=n.args[1];const fnid=makeBuilder(fun.body,fun.params,effectiveId);
        const dst=reg();emit('CLOSURE',dst,fnid);return dst;
      }
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
    funcs[id-1]={p:params.map(key),ins:builder.ins,protectedId};
    return id;
  };
  const initialEntry=makeBuilder(parsed,[]);
  let autoFunctionCount=0;
  if(autoMode!=='off'){
    for(let i=0;i<funcs.length;i++){
      const fn=funcs[i];
      if(fn.protectedId)continue; // explicit BM_ENCFUNC always retains its own external key
      if(autoMode==='external'&&i+1===initialEntry)continue;
      fn.protectedId=autoId;
      autoFunctionCount++;
    }
    if(autoFunctionCount>0)keyFor(autoId);
  }
  // Compile-time superinstruction pass: coalesce adjacent, independent loads
  // or a constant initialization + local declaration. JUMP/JF/JT destination
  // indices are relocated after the rewrite. Never fuse across a branch target.
  //
  // This changes the compiled instruction language, not just its display.
  // It makes naive one-to-one opcode lifting less universal, but it is still
  // invertible with runtime instrumentation; no client-side VM is a secret.
  const fusionCounts={GETK:0,KGET:0,KK:0,KDECL:0};
  if(options.superInstructions!==false && profile.fusion){
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
  let flattenedBlocks=0,flattenedBridges=0;
  if(options.hardened && profile.flatten){
    for(const fn of funcs){
      const flattened=flattenCfgInstructions(fn.ins,codes);
      fn.ins=flattened.rows;
      flattenedBlocks+=flattened.blocks;
      flattenedBridges+=flattened.bridges;
    }
  }


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
  // V4's opcode interpretation varies per prototype, not just per build.
  // The palette is part of each sealed function's binary header. A generic
  // decoder needs each prototype's palette rather than one global ID map.
  const opcodeIndex=new Map(OPS.map((name,index)=>[codes[name],index]));
  const packed=funcs.map(f=>{
    const opSeed=rand(255)+1;
    let palette=null;
    if(options.hardened){
      const pool=Array.from({length:256},(_,i)=>i);
      for(let i=pool.length-1;i>0;i--){
        const j=rand(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];
      }
      palette=pool.slice(0,OPS.length);
    }
    const ins=f.ins.map((row,idx)=>row.map((n,j)=>{
      const pc=idx+1;
      const opcodeMask=options.hardened
        ? (opSeed+pc*41+(pc*pc%251)*17)%256
        : (opSeed+pc*41)%256;
      const instructionTweak=options.hardened
        ? (opSeed*97+(pc*(pc%131))*31)%modulus : 0;
      const value=options.hardened&&j===0?palette[opcodeIndex.get(n)]:n;
      const masked=j===0 ? (value ^ opcodeMask) : value;
      return (masked+salt+instructionTweak+5*(j+1)+modulus)%modulus;
    }));
    return {p:f.p,ins,opSeed,palette,protectedId:f.protectedId};
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
  const rawFunctions=packed.map(f=>{
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
    if(options.hardened)raw.push(...f.palette);
    for(const v of f.p)pack32(v,raw);
    for(let index=0;index<f.ins.length;index++){
      const row=f.ins[index],pc=index+1;
      // Every inner instruction rotates the physical order of its four
      // operands, not only the function's fixed permutation.
      const rotation=options.hardened?
        (f.opSeed+pc*7+(pc*pc%13))%4:0;
      for(let position=0;position<4;position++){
        const logical=slots[(position-rotation+4)%4];
        if(width===3)pack24(row[logical],raw);
        else pack32(row[logical],raw);
      }
    }
    const seed=rand(60000)+1000;
    if(f.protectedId){
      const result=encryptBytes(raw,keyFor(f.protectedId),f.protectedId);
      return [seed,result.bytes,width,{id:f.protectedId,nonce:result.nonce,tag:result.tag}];
    }
    return [seed,raw,width,null];
  });
  const rawConstants=consts.map(value=>{
    const typ=value===null?5:typeof value==='string'?1:typeof value==='number'?2:value===true?3:4;
    const raw=(typ===1||typ===2)?[...Buffer.from(String(value),'utf8')]:[];
    const seed=rand(60000)+1000;
    return [typ,seed,raw];
  });

  // Outer decoder micro-VM: its own instruction set, random opcodes, registers,
  // program counter and genuine runtime control-flow branching. This is not
  // merely another encoding pass: every inner instruction is processed by a
  // separately interpreted microprogram.
  //
  // Two equivalent operand-unmasking paths are selected using the current
  // inner PC and per-prototype opSeed. This is a runtime-dependent branch,
  // NOT a secret key or an unbreakable opaque predicate.
  const outerOpNames=['PREP','FETCH','BRANCH','MASK','MASK_ALT','XOR','JUMP','SIGN','HALT','NOOP'];
  const outerOpIds={};
  let outerProgram=null,outerSeed=0,outerBranchMul=0,outerBranchBias=0;
  if(nestedVM){
    const seen=new Set();
    for(const name of outerOpNames){
      let id;do{id=27+rand(200)}while(seen.has(id));
      seen.add(id);outerOpIds[name]=id;
    }
    outerSeed=rand(60000)+1000;
    outerBranchMul=7+2*rand(9); // odd: both runtime paths are reachable across PCs
    outerBranchBias=1+rand(49);
    const rows=[
      ['PREP',0],['FETCH',0],['BRANCH',0],
      ['MASK',0],['XOR',0],['JUMP',0]
    ];
    // Randomized unreachable padding complicates positional matching.
    // Control flow never executes these rows.
    for(let n=rand(4);n>0;n--)rows.push(['NOOP',0]);
    const alternativePC=rows.length+1;
    rows.push(['MASK_ALT',0],['XOR',0]);
    const signedPC=rows.length+1;
    rows.push(['SIGN',0],['HALT',0]);
    rows[2][1]=alternativePC;
    rows[5][1]=signedPC;
    const payload=[rows.length];
    rows.forEach(([name,arg],i)=>{
      const pos=i+1;
      payload.push(outerOpIds[name]^((outerSeed+pos*53)%256));
      payload.push(arg^((outerSeed*3+pos*17)%256));
    });
    outerProgram=[outerSeed,payload,rows.length];
  }
  // C++17 sealer handles complete batches when available. A byte-for-byte
  // equivalent JS fallback keeps local development and old deployments working.
  const sealedBatch=sealBatch([
    ...rawFunctions.map(([seed,raw])=>[seed,raw]),
    ...rawConstants.map(([,seed,raw])=>[seed,raw]),
    ...(nestedVM?[[outerProgram[0],outerProgram[1]]]:[])
  ],sbox,seal);
  const sealedFunctions=rawFunctions.map(([seed,,width,meta],i)=>
    [seed,sealedBatch.sealed[i],width,meta]);
  const sealedConstants=rawConstants.map(([typ,seed],i)=>
    [typ,seed,sealedBatch.sealed[rawFunctions.length+i]]);
  const sealedOuter=nestedVM
    ? [outerProgram[0],sealedBatch.sealed[rawFunctions.length+rawConstants.length]]
    : null;
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
  const sealedFunctionRefs=sealedFunctions.map(([seed,bytes,,meta],i)=>
    [seed^seedMask(1,i+1),segment(bytes),meta]);
  const sealedConstantRefs=sealedConstants.map(([typ,seed,bytes],i)=>
    [typ,seed^seedMask(2,i+1),segment(bytes)]);
  const outerRefs=nestedVM
    ? [sealedOuter[0]^seedMask(3,1),segment(sealedOuter[1])]
    : null;
  const inverseParts=segment(maskedInverse);
  const segmentOrder=Array.from({length:fragments.length},(_,i)=>i);
  for(let i=segmentOrder.length-1;i>0;i--){
    const j=rand(i+1);[segmentOrder[i],segmentOrder[j]]=[segmentOrder[j],segmentOrder[i]];
  }
  const positions=new Map(segmentOrder.map((old,i)=>[old,i+1]));
  const refs=parts=>'{'+parts.map(id=>positions.get(id)).join(',')+'}';
  const luaFragments='{'+segmentOrder.map(id=>JSON.stringify(fragments[id])).join(',')+'}';
  const luaFunctions='{'+sealedFunctionRefs.map(([seed,parts,meta])=>
    '{'+seed+','+refs(parts)+(meta?','+JSON.stringify(meta.id)+','+
      JSON.stringify(meta.nonce)+','+JSON.stringify(meta.tag):'')+'}').join(',')+'}';
  const luaConstants='{'+sealedConstantRefs.map(([typ,seed,parts])=>'{'+typ+','+seed+','+refs(parts)+'}').join(',')+'}';
  const luaOuter=nestedVM?'{'+outerRefs[0]+','+refs(outerRefs[1])+'}':null;
  const luaInverse=refs(inverseParts);
  const randomName=()=>('_'+Array.from({length:7},()=>String.fromCharCode(97+rand(26))).join(''));
  const blobName=randomName(),alphabetName=randomName(),mapName=randomName(),unpackName=randomName();
  const inverseName=randomName(),inverseRefsName=randomName();
  // Bootstrap material is derived from the *actual sealed payload* at
  // runtime. It is portable and tamper-coupled, not secret key material.
  let bootstrap=0;
  const mixBoot=(len,seed,kind)=>{
    bootstrap=(bootstrap+len*131+(seed%65521)*17+kind*7)%16777216;
  };
  for(let i=0;i<sealedFunctions.length;i++)
    mixBoot(sealedFunctions[i][1].length,sealedFunctionRefs[i][0],3);
  for(let i=0;i<sealedConstants.length;i++)
    mixBoot(sealedConstants[i][2].length,sealedConstantRefs[i][1],sealedConstantRefs[i][0]);
  mixBoot(maskedInverse.length,0,11);
  if(nestedVM)mixBoot(sealedOuter[1].length,outerRefs[0],13);
  // The runtime bootstrap protects portable masking against simple literal
  // search. Since all material ships to the client it remains reconstructible.
  const sboxMaskScrambled=sboxMask^(salt%256)^(options.hardened?(bootstrap%256):0);
  const luaArgs=JSON.stringify(argSets).replace(/\[/g,'{').replace(/\]/g,'}');
  const embeddedAutoKey=autoMode==='standalone'&&autoFunctionCount>0
    ? protectedKeys.get(autoId):null;
  // Reconstructible standalone material: three permuted additive shares
  // tied to the sealed-function bootstrap, instead of a single A XOR B
  // literal. This adds variation to static key extractors, not secrecy.
  let standaloneKeyLine=[];
  if(embeddedAutoKey){
    const keyData=Buffer.from(embeddedAutoKey,'hex');
    const left=crypto.randomBytes(32),right=crypto.randomBytes(32);
    const mixed=Buffer.alloc(32),stride=1+2*rand(16),offset=rand(32);
    for(let i=0;i<32;i++){
      const p=(i*stride+offset)%32;
      mixed[p]=(keyData[i]+(left[p]^right[p])+(((i+1)*17+bootstrap)%256))%256;
    }
    standaloneKeyLine=[
      '  local function _unfold()',
      '    local _s={'+[left,right,mixed].map(b=>JSON.stringify(b.toString('hex'))).join(',')+'}',
      '    local function _oct(t,p) local q=(p-1)*2+1',
      '      return tonumber(string.sub(_s[t],q,q+1),16)end',
      '    local _out={};for i=1,32 do',
      '      local p=((i-1)*'+stride+'+'+offset+')%32+1',
      '      local x=_oct(1,p);local y=_oct(2,p);local z=_oct(3,p)',
      '      _out[i]=string.format("%02x",(z-bxor(x,y)-((i*17+BOOT)%256))%256)',
      '    end;return nativeConcat(_out)',
      '  end',
      '  local _BK=_unfold()'
    ];
  }
  // If antiTamper remains enabled, all encrypted function ciphertext and
  // metadata are still included in the V4 integrity digest.
  // V4 varies the integrity polynomial by build rather than publishing a
  // universal digest recipe. This is tamper evidence, NOT a MAC or a secret.
  const hashSeed=options.hardened?rand(1000000000):17;
  const hashMul=options.hardened?257+rand(500):131;
  const hashAdd=options.hardened?1+rand(8191):1;
  let digest=hashSeed;
  const mix=(n)=>{digest=(digest*hashMul+n+hashAdd)%hashMod;};
  for(const [seed,bytes] of sealedFunctionRefs.map(([seed],i)=>[seed,sealedFunctions[i][1]])){
    mix(seed);mix(bytes.length);bytes.forEach(mix);
  }
  for(const [typ,seed,bytes] of sealedConstantRefs.map(([typ,seed],i)=>[typ,seed,sealedConstants[i][2]])){
    mix(typ);mix(seed);mix(bytes.length);bytes.forEach(mix);
  }
  mix(maskedInverse.length);maskedInverse.forEach(mix);
  const mixString=str=>{const raw=Buffer.from(str,'utf8');mix(raw.length);raw.forEach(mix);};
  for(const [, ,meta] of sealedFunctionRefs)if(meta){
    mixString(meta.id);mixString(meta.nonce);mixString(meta.tag);
  }
  mix(salt);mix(sboxMask);
  for(const args of argSets){mix(args.length);args.forEach(mix);}
  if(nestedVM){
    mix(outerRefs[0]);mix(sealedOuter[1].length);
    sealedOuter[1].forEach(mix);
  }
  const saltShare=rand(1<<30), checkShare=rand(1<<30);
  const runtimeSaltCheck=options.hardened
    ? [
      '  local BOOT=0',
      '  local function mixBoot(n,k,t) BOOT=(BOOT+n*131+(k%65521)*17+t*7)%16777216 end',
      '  for _,f in ipairs(E)do mixBoot(#f[2],f[1],3)end',
      '  for _,v in ipairs(Q)do mixBoot(#v[3],v[2],v[1])end',
      '  mixBoot(#'+inverseName+',0,11)',
      ...(nestedVM?['  mixBoot(#H[2],H[1],13)']:[]),
      '  local SALT=bit32.bxor('+saltShare+','+(salt^saltShare^bootstrap)+',BOOT)',
      '  local CHECK=bit32.bxor('+checkShare+','+(digest^checkShare^bootstrap)+',BOOT)'
    ]
    : ['  local SALT='+salt+'; local CHECK='+digest];
  const runtimeTweak=options.hardened
    ? '((spec[3]*97+(pc*(pc%131))*31)%modulus)' : '0';
  const runtimeOpcodeMask=options.hardened
    ? '((spec[3]+pc*41+(pc*pc%251)*17)%256)'
    : '((spec[3]+pc*41)%256)';

  // Per-build opaque polynomial guard: true for all integer PCs, but is
  // evaluated from runtime state and interleaved into the second VM.
  const predFactor=31+2*rand(85),predBias=rand(65521);
  const outerRuntime=nestedVM?[
    '  -- Outer VM has a separate sealed instruction stream and interpreter.',
    '  local outerSeed=bxor(H[1],(SALT+(3+3)*7919+1543)%65536)',
    '  local outerData=unseal(H[2],outerSeed)',
    '  local outerCount=outerData[1]',
    '  if not outerCount or outerCount<9 or outerCount>32 or #outerData~=1+2*outerCount then',
    '    nativeError("BLACKMAMER V4 invalid outer bytecode") end',
    '  local outerProgram={}',
    '  for i=1,outerCount do',
    '    local at=2+(i-1)*2',
    '    outerProgram[i]={bxor(outerData[at],(outerSeed+i*53)%256),',
    '      bxor(outerData[at+1],(outerSeed*3+i*17)%256)}',
    '  end',
    '  outerData=nil;H=nil',
    '  local function outerVM(spec,pc,at,field)',
    '    local regs={};local ip=1;local steps=0',
    '    local challenge=(pc*'+predFactor+'+spec[3]*37+at+'+predBias+')%65536',
    '    if ((challenge*challenge+challenge)%2)~=0 then',
    '      nativeError("BLACKMAMER V4 control-flow guard failed")end',
    '    while true do',
    '      steps=steps+1;if steps>32 then nativeError("BLACKMAMER V4 outer VM step overflow")end',
    '      local instruction=outerProgram[ip]',
    '      if not instruction then nativeError("BLACKMAMER V4 outer VM bad PC")end',
    '      local opcode=instruction[1];local arg=instruction[2];local nextip=ip+1',
    '      if opcode=='+outerOpIds.PREP+' then',
    '        regs[5]=(spec[3]*97+(pc*(pc%131))*31)%modulus',
    '      elseif opcode=='+outerOpIds.FETCH+' then',
    '        for slot=1,4 do regs[slot]=field(at,slot)end',
    '      elseif opcode=='+outerOpIds.BRANCH+' then',
    '        if ((pc*'+outerBranchMul+'+spec[3]+'+outerBranchBias+')%2)==0 then nextip=arg end',
    '      elseif opcode=='+outerOpIds.MASK+' then',
    '        for slot=1,4 do',
    '          regs[slot]=(regs[slot]-SALT-regs[5]-5*slot)%modulus end',
    '      elseif opcode=='+outerOpIds.MASK_ALT+' then',
    '        for slot=4,1,-1 do',
    '          regs[slot]=((regs[slot]-regs[5]-5*slot)-SALT+modulus)%modulus end',
    '      elseif opcode=='+outerOpIds.XOR+' then',
    '        regs[1]=bxor(regs[1],(spec[3]+pc*41+(pc*pc%251)*17)%256)',
    '      elseif opcode=='+outerOpIds.JUMP+' then nextip=arg',
    '      elseif opcode=='+outerOpIds.SIGN+' then',
    '        for slot=2,4 do if regs[slot]>modulus/2 then',
    '          regs[slot]=regs[slot]-modulus end end',
    '      elseif opcode=='+outerOpIds.NOOP+' then',
    '        -- decoy padding',
    '      elseif opcode=='+outerOpIds.HALT+' then',
    '        return regs[1],regs[2],regs[3],regs[4]',
    '      else nativeError("BLACKMAMER V4 invalid outer opcode") end',
    '      ip=nextip',
    '    end',
    '  end'
  ]:[];

  const lua51BitOps=lua51?[
    '  -- Standard Lua 5.1 has no bit32. Portable integer-bit fallback.',
    '  local function bmBitPair(a,b,kind)',
    '    a=a%4294967296;b=b%4294967296',
    '    local result=0;local bitvalue=1',
    '    for i=1,32 do',
    '      local x=a%2;local y=b%2',
    '      local take=(kind==1 and x~=y) or (kind==2 and x==1 and y==1) or',
    '        (kind==3 and (x==1 or y==1))',
    '      if take then result=result+bitvalue end',
    '      a=math.floor(a/2);b=math.floor(b/2);bitvalue=bitvalue*2',
    '    end',
    '    return result',
    '  end',
    '  local bit32={}',
    '  bit32.bxor=function(a,b,...)',
    '    local v=bmBitPair(a,b,1)',
    '    for i=1,select("#",...)do v=bmBitPair(v,select(i,...),1)end',
    '    return v',
    '  end',
    '  bit32.band=function(a,b,...)',
    '    local v=bmBitPair(a,b,2)',
    '    for i=1,select("#",...)do v=bmBitPair(v,select(i,...),2)end',
    '    return v',
    '  end',
    '  bit32.bor=function(a,b,...)',
    '    local v=bmBitPair(a,b,3)',
    '    for i=1,select("#",...)do v=bmBitPair(v,select(i,...),3)end',
    '    return v',
    '  end',
    '  bit32.bnot=function(a)return 4294967295-a%4294967296 end',
    '  bit32.rshift=function(a,n)return math.floor((a%4294967296)/2^n)end',
    '  bit32.rrotate=function(a,n)',
    '    n=n%32;a=a%4294967296',
    '    if n==0 then return a end',
    '    return (math.floor(a/2^n)+(a%2^n)*2^(32-n))%4294967296',
    '  end'
  ]:[];
  const lua51Buffers=lua51?[
    '  local bufFrom=function(bytes)return bytes end',
    '  local bufRead=function(bytes,index)return nativeByte(bytes,index+1)end',
    '  local bufRead32=function(bytes,index)',
    '    local a,b,c,d=nativeByte(bytes,index+1,index+4)',
    '    if not d then nativeError("BLACKMAMER V4 invalid Lua51 bytecode")end',
    '    return a+b*256+c*65536+d*16777216',
    '  end'
  ]:[
    '  local bufFrom=buffer and buffer.fromstring',
    '  local bufRead=buffer and buffer.readu8',
    '  local bufRead32=buffer and buffer.readu32',
    '  if nativeType(bufFrom)~="function" or nativeType(bufRead)~="function" or nativeType(bufRead32)~="function" then',
    '    nativeError("BLACKMAMER V4 requires Roblox Luau buffer API") end'
  ];
  const lines=[
    options.hardened?'-- BLACKMAMER VM V4.0':'-- BLACKMAMER VM V3.4',
    'return (function(...)',
    '  local '+blobName+'='+luaFragments,
    '  local '+alphabetName+'='+JSON.stringify(alphabet),
    '  local E=' + luaFunctions,
    '  local Q=' + luaConstants,
    ...(nestedVM?['  local H='+luaOuter]:[]),
    '  local A=' + luaArgs,
    '  local '+inverseRefsName+'='+luaInverse,
    '  local modulus=' + modulus + '; local hmod=' + hashMod + '; local hseed=' + hashSeed + '; local hmul=' + hashMul + '; local hadd=' + hashAdd,
    '  local nativeByte=string.byte; local nativeChar=string.char; local nativeConcat=table.concat',
    ...lua51BitOps,
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
    ...(nestedVM?['  H[2]='+unpackName+'(H[2])']:[]),
    '  local '+inverseName+'='+unpackName+'('+inverseRefsName+')',
    ...runtimeSaltCheck,
    ...standaloneKeyLine,
    '  local SBOX_MASK=bit32.bxor(SALT%256,'+sboxMaskScrambled+(options.hardened?',BOOT%256':'')+')',
    '  '+blobName+'=nil;'+alphabetName+'=nil;'+mapName+'=nil;'+inverseRefsName+'=nil',
    '  local function verify()',
    '    local h=hseed;local function mix(v)h=(h*hmul+v+hadd)%hmod end',
    '    for _,f in ipairs(E)do mix(f[1]);mix(#f[2]);for j=1,#f[2]do mix(nativeByte(f[2],j))end end',
    '    for _,v in ipairs(Q)do mix(v[1]);mix(v[2]);mix(#v[3]);for j=1,#v[3]do mix(nativeByte(v[3],j))end end',
    '    mix(#'+inverseName+');for j=1,#'+inverseName+' do mix(nativeByte('+inverseName+',j)) end',
    ...(protectedKeys.size?[
      '    for _,f in ipairs(E)do if f[3]then for k=3,5 do local v=f[k]',
      '      mix(#v);for j=1,#v do mix(nativeByte(v,j))end end end end'
    ]:[]),
    '    mix(SALT);mix(SBOX_MASK)',
    '    for _,ar in ipairs(A)do mix(#ar);for _,v in ipairs(ar)do mix(v)end end',
    ...(nestedVM?['    mix(H[1]);mix(#H[2]);for j=1,#H[2]do mix(nativeByte(H[2],j))end']:[]),
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
    ...(options.hardened&&options.antiDebug!==false?[
      '  -- Runtime sanity checks are best-effort; no claim of universal debugger detection.',
      '  local function runtimeGuard()',
      '    if nativeByte~=string.byte or nativeChar~=string.char or',
      '      nativeConcat~=table.concat or nativeType~=type or bxor~=bit32.bxor then',
      '      nativeError("BLACKMAMER V4 runtime API modified")end',
      '    if nativeByte("AB",2)~=66 or nativeChar(66,77)~="BM" or',
      '      bxor(0x5a,0xa5)~=255 then nativeError("BLACKMAMER V4 API self-test failed")end',
      '    local info=dbg and dbg.info',
      '    if nativeType(info)=="function" then',
      '      local function probe(n)return n*3+7 end',
      '      local ok,func=nativePcall(info,probe,"f")',
      '      if not ok or func~=probe or probe(9)~=34 then',
      '        nativeError("BLACKMAMER V4 debug.info function metadata invalid")end',
      '      local okA,arity,variadic=nativePcall(info,probe,"a")',
      '      if not okA or arity~=1 or variadic~=false then',
      '        nativeError("BLACKMAMER V4 debug.info signature modified")end',
      '    end',
      '  end',
      '  runtimeGuard()'
    ]:[]),
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
    ...(protectedKeys.size?protectedRuntimeLines():[]),
    ...outerRuntime,
    '  local P={}',
    ...lua51Buffers,

    '  local function prototype(fid)',
    '    local cached=P[fid];if cached then return cached end',
    '    local bundle=E[fid];if not bundle then nativeError("BLACKMAMER V3 invalid function")end',
    '    local realSeed=bxor(bundle[1],(SALT+(1+3)*7919+fid*1543)%65536)',
    '    local raw=unseal(bundle[2],realSeed);local chars={}',
    ...(protectedKeys.size?[
      '    if bundle[3]then',
      '      local keyHex',
      ...(embeddedAutoKey?[
        '      if bundle[3]=="'+autoId+'" then keyHex=_BK else'
      ]:[]),
      '      local provider=globals.BLACKMAMER_KEY_PROVIDER',
      ...((autoMode==='external'||autoMode==='external-full')&&autoFunctionCount>0?[
        '      if bundle[3]=="'+autoId+'" and nativeType(provider)~="function" then',
        '        local ok,loaded=nativePcall(function()',
        '          local service=game:GetService("ServerScriptService")',
        '          local module=service:FindFirstChild("BlackmamerKeyProvider")',
        '          if not module then return nil end',
        '          return require(module)',
        '        end)',
        '        if ok and nativeType(loaded)=="function" then provider=loaded end',
        '      end'
      ]:[]),
      '      if nativeType(provider)~="function" then nativeError("BLACKMAMER external key provider missing")end',
      '      keyHex=provider(bundle[3])',
      ...(embeddedAutoKey?['      end']:[]),
      '      for j,b in ipairs(raw)do chars[j]=nativeChar(b)end',
      '      local plain=efDecrypt(nativeConcat(chars),keyHex,bundle[3],bundle[4],bundle[5])',
      '      raw={};chars={};for j=1,#plain do raw[j]=nativeByte(plain,j)end',
      '    end'
    ]:[]),
    '    for j,b in ipairs(raw)do chars[j]=nativeChar(b)end',
    '    local packed=bufFrom(nativeConcat(chars))',
    '    local pn=bufRead(packed,0)+256*bufRead(packed,1)',
    '    local count=bufRead(packed,2)+256*bufRead(packed,3)',
    '    local opSeed=bufRead(packed,4);local width=bufRead(packed,5);local off='+(options.hardened?10+OPS.length:10),
    '    if width~=3 and width~=4 then nativeError("BLACKMAMER V3 invalid instruction width") end',
    '    local offsets={}',
    '    for j=1,4 do offsets[j]=bufRead(packed,5+j) end',
    ...(options.hardened?[
      '    local palette={};local paletteSeen={}',
      '    for j=1,'+OPS.length+' do',
      '      local value=bufRead(packed,9+j)',
      '      if paletteSeen[value]then nativeError("BLACKMAMER V4 duplicate opcode palette")end',
      '      paletteSeen[value]=true;palette[j]=value',
      '    end'
    ]:[]),
    '    local seen={};for j=1,4 do',
    '      if offsets[j]>3 or seen[offsets[j]] then nativeError("BLACKMAMER V3 invalid operand map") end',
    '      seen[offsets[j]]=true',
    '    end',
    '    local params={}',
    '    for j=1,pn do params[j]=bufRead32(packed,off);off=off+4 end',
    '    -- Each prototype independently chooses compact/wide and operand order.',
    '    local spec={params,packed,opSeed,off,count,width,offsets'+(options.hardened?',palette':'')+'}',
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
    '      local p=at+'+(options.hardened?
      '((offsets[logical]+(spec[3]+pc*7+(pc*pc%13))%4)%4)*width':
      'offsets[logical]*width'),
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
    ...(options.hardened&&options.antiDebug!==false?
      ['      if ticks%251==0 then runtimeGuard()end']:[]),
    '      if pc<1 or pc>length then nativeError("BLACKMAMER V3 bad PC") end',
    '      local at=off+(pc-1)*4*width',
    ...(nestedVM?[
      '      local op,a,b,c=outerVM(spec,pc,at,field)'
    ]:[
      '      local tweak='+runtimeTweak,
      '      local op=bxor((field(at,1)-SALT-tweak-5)%modulus,'+runtimeOpcodeMask+')',
      '      local a=((field(at,2)-SALT-tweak-10)%modulus);if a>modulus/2 then a=a-modulus end',
      '      local b=((field(at,3)-SALT-tweak-15)%modulus);if b>modulus/2 then b=b-modulus end',
      '      local c=((field(at,4)-SALT-tweak-20)%modulus);if c>modulus/2 then c=c-modulus end'
    ]),
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
  if(options.hardened){
    // Numeric opcode constants are absent from the V4 dispatcher. Instead
    // each handler compares against the executing function's sealed palette.
    // The branch order is still independently randomized on every build.
    for(let i=0;i<handlers.length;i++)
      dispatch.push(...emitHandler(handlers[i],
        (i===0?'if':'elseif')+' op==O.'+opcodeName(handlers[i])+' then',
        '      '));
    dispatch.push('      end');
    dispatchStructure='per-function-palette';
  }else if(useTree){
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
  const expanded=lines.join('\n').replace(/\bO\.([A-Z]+)\b/g,(_,name)=>{
    if(!Object.hasOwn(codes,name)) throw new Error('Unknown VM opcode '+name);
    return options.hardened?'spec[8]['+(OPS.indexOf(name)+1)+']':String(codes[name]);
  });
  // Deliberately publish the runtime as a dense single-line Luau chunk.
  // Retain a compact block-comment identifier so newline comments never
  // accidentally consume live code after minification.
  const code='--[[BLACKMAMER VM '+(options.hardened?'V4.0':'V3.4')+']]'+compactLuau(expanded);
  return {code,engine:options.hardened?'BLACKMAMER V4 Native VM':'BLACKMAMER V3 Native VM',
    hardened:options.hardened===true,nativeSealer:sealedBatch.nativeUsed,
    target,protectionLevel:profileName,injectedAstBranches,astFlattenedGroups,
    virtualizedLexicalBindings,
    randomizedRegisterAllocation:options.hardened===true,
    cfgFlattenedBlocks:flattenedBlocks,cfgBridgeJumps:flattenedBridges,
    stringEncryption:true,
    nestedVM,outerVmInstructions:nestedVM?outerProgram[2]:0,
    runtimeBootstrap:options.hardened===true,
    opaquePredicates:nestedVM,
    periodicRuntimeGuard:options.hardened===true&&options.antiDebug!==false,
    protectedFunctions:[...protectedKeys.keys()],generatedKeys,
    autoFunctionEncryption:autoMode,
    autoEncryptedFunctions:autoFunctionCount,
    externallyKeyedFunctions:funcs.filter(f=>f.protectedId&&
      !(autoMode==='standalone'&&f.protectedId===autoId)).length,
    virtualizedFunctions:funcs.length,
    bytecodeLayout:'per-prototype-shuffled-12-or-16',
    bytecodeWidths:{compact:sealedFunctions.filter(f=>f[2]===3).length,
      wide:sealedFunctions.filter(f=>f[2]===4).length},
    dispatchStructure,
    perFunctionOpcodePalette:options.hardened===true,
    perInstructionOperandRotation:options.hardened===true,
    opcodePaletteSize:options.hardened?OPS.length:0,
    ...(options.auditPalettes===true?{
      // Test-only structural fingerprints; never written into the Lua chunk.
      opcodePaletteFingerprints:packed.map(f=>f.palette?
        crypto.createHash('sha256').update(Buffer.from(f.palette)).digest('hex'):null)
    }:{}),
    fusedInstructions:fusionTotal,superInstructionKinds:fusionCounts,
    vmInstructions:funcs.reduce((n,f)=>n+f.ins.length,0),
    antiTamper: options.antiTamper!==false, antiDebug: options.antiDebug!==false};
}
module.exports={compile,lex,Parser,SyntaxErrorV3};
