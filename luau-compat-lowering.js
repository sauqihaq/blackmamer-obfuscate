'use strict';
// Lower Luau-only statements/expressions into portable Lua 5.1 syntax before
// the pinned Prometheus full 11-step pipeline. Source *execution* still uses
// Luau inside Roblox: only syntax is adapted for Prometheus's Lua51 parser.
//
// This deliberately handles structural syntax using BLACKMAMER's own Parser,
// not regex replacement (which would corrupt comments and quoted strings).
const {Parser}=require('./blackmamer-vm3');

function containsLuauExtension(ast){
  const visit=node=>{
    if(!node||typeof node!=='object')return false;
    if(Array.isArray(node))return node.some(visit);
    if(node.t==='compound'||node.t==='continue'||node.t==='ifexpr')
      return true;
    if(node.t==='forin'&&node.iterators.length===1&&
       !['call','method'].includes(node.iterators[0]?.t))return true;
    return Object.keys(node).some(key=>key!=='nativeSource'&&visit(node[key]));
  };
  return visit(ast);
}
function lowerLuau(source,target='LuaU'){
  if(target!=='LuaU')return {source,applied:false,features:[]};
  const parsed=new Parser(source).parse();
  if(!containsLuauExtension(parsed))
    return {source,applied:false,features:[]};
  let serial=0;const features=new Set();
  // Identifiers can never collide with client source declared locals.
  // Our parser has all of the source's identifier tokens.
  const used=new Set(new Parser(source).tokens.filter(t=>t.type==='id').map(t=>t.value));
  const fresh=()=>{let id;do{id='__bm_luau_'+(++serial).toString(36);}while(used.has(id));used.add(id);return id;};
  const exprs=a=>(a||[]).map(expr).join(',');
  function expr(node){
    if(!node||node.t==='nil')return 'nil';
    switch(node.t){
      case 'num': return String(node.value);
      case 'str': return JSON.stringify(node.value);
      case 'bool': return node.value?'true':'false';
      case 'var': return node.name;
      case 'vararg': return '...';
      case 'index': return '('+expr(node.obj)+')['+expr(node.key)+']';
      case 'call': return '('+expr(node.fn)+')('+exprs(node.args)+')';
      case 'method': return '('+expr(node.obj)+'):'+node.name+'('+exprs(node.args)+')';
      case 'table': return '{'+node.fields.map(f=>
        f.implicit?expr(f.value):'['+expr(f.key)+']='+expr(f.value)).join(',')+'}';
      case 'unary': return '('+(node.op==='not'?'not ':node.op)+expr(node.x)+')';
      case 'binary': return '('+expr(node.left)+' '+node.op+' '+expr(node.right)+')';
      case 'fun': return 'function('+node.params.join(',')+') '+body(node.body,null)+' end';
      case 'ifexpr':{
        features.add('conditional-expression');
        const branches=node.branches.map((b,i)=>
          (i===0?'if ':'elseif ')+expr(b.condition)+' then return '+expr(b.value)).join(' ');
        return '(function() '+branches+' else return '+expr(node.otherwise)+' end end)()';
      }
      default: throw Error('Unsupported Luau AST expression in syntax lowering: '+node.t);
    }
  }
  function loop(head,statements){
    // Each original loop body executes in a synthetic one-pass repeat.
    // A Luau continue maps to a break of that repeat; an original break
    // sets a dedicated flag, then breaks the *outer* loop after the repeat.
    const stop=fresh();
    return head+' local '+stop+'=false; repeat '+
      body(statements,{stop})+' until true; if '+stop+' then break end end';
  }
  function body(nodes,loopContext){
    return (nodes||[]).map(node=>statement(node,loopContext)).join(';');
  }
  function statement(n,loopContext){
    switch(n.t){
      case 'local': return 'local '+n.name+'='+expr(n.value);
      case 'localmulti': return 'local '+n.names.join(',')+
        (n.values.length?'='+exprs(n.values):'');
      case 'localfun': return 'local function '+n.name+
        '('+n.fun.params.join(',')+') '+body(n.fun.body,null)+' end';
      case 'assign': return expr(n.target)+'='+expr(n.value);
      case 'assignmulti': return n.targets.map(expr).join(',')+'='+exprs(n.values);
      case 'compound':{
        features.add('compound-assignment');
        const op=n.op.slice(0,-1),rhs=expr(n.value);
        if(n.target.t==='var')
          return n.target.name+'='+n.target.name+op+'('+rhs+')';
        const obj=fresh(),key=fresh(),dst=fresh();
        // LuaU's compound index assignment evaluates index and object once.
        // Also evaluate the original value before writing the result.
        return 'do local '+obj+'='+expr(n.target.obj)+
          ';local '+key+'='+expr(n.target.key)+
          ';local '+dst+'='+obj+'['+key+']'+op+'('+rhs+')'+
          ';'+obj+'['+key+']='+dst+' end';
      }
      case 'callstmt': return expr(n.value);
      case 'if': return n.branches.map((br,i)=>
        (i===0?'if ':'elseif ')+expr(br.condition)+' then '+body(br.body,loopContext))
        .join(' ')+(n.otherwise.length?' else '+body(n.otherwise,loopContext):'')+' end';
      case 'fornum':return loop('for '+n.name+'='+expr(n.start)+','+
        expr(n.limit)+','+expr(n.step)+' do',n.body);
      case 'forin':{
        const iter=n.iterators;
        const direct=iter.length===1&&!['call','method'].includes(iter[0].t);
        if(direct)features.add('generalized-iteration');
        const values=direct?'pairs('+expr(iter[0])+')':exprs(iter);
        return loop('for '+n.names.join(',')+' in '+values+' do',n.body);
      }
      case 'while':return loop('while '+expr(n.condition)+' do',n.body);
      case 'repeat':{
        // A continue inside repeat must still evaluate the condition on the
        // same iteration; the inner one-pass repeat provides that behavior.
        const flag=fresh();
        return 'repeat local '+flag+'=false;repeat '+body(n.body,{stop:flag})+
          ' until true;if '+flag+' then break end until '+expr(n.condition);
      }
      case 'do':return 'do '+body(n.body,loopContext)+' end';
      case 'break':
        return loopContext?loopContext.stop+'=true;break':'break';
      case 'continue':
        if(!loopContext)throw Error('continue outside loop in Luau lowering');
        features.add('continue');
        return 'break';
      case 'return':return 'return'+(n.values.length?' '+exprs(n.values):'');
      default:throw Error('Unsupported Luau AST statement in syntax lowering: '+n.t);
    }
  }
  return {source:body(parsed,null),applied:true,features:[...features]};
}
module.exports={lowerLuau,containsLuauExtension};
