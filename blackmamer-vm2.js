'use strict';
// BLACKMAMER VM V2 experimental: real register VM for a narrow, safe subset of
// Luau single-line local initializers (pure numeric / comparison / if-expressions).
// This is NOT a whole-program VM nor a Luraph-level protection claim.
const crypto = require('node:crypto');
const rand = n => crypto.randomInt(n);
const OPERATORS = ['==', '~=', '<=', '>=', '+', '-', '*', '/', '%', '^', '<', '>'];
const BINARY = new Set(OPERATORS);
const PREC = { '==': 1, '~=': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '%': 3, '^': 5 };

function safeMask(source) {
  const mask = source.split('');
  const hide = (start, end) => { for (let i = start; i < end; i++) if (mask[i] !== '\n' && mask[i] !== '\r') mask[i] = ' '; };
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('--', i)) {
      const start = i;
      i += 2;
      const bracket = /^\[(=*)\[/.exec(source.slice(i, i + 96));
      if (bracket) {
        const close = ']' + bracket[1] + ']';
        const pos = source.indexOf(close, i + bracket[0].length);
        i = pos < 0 ? source.length : pos + close.length;
      } else {
        while (i < source.length && source[i] !== '\n') i++;
      }
      hide(start, i);
      continue;
    }
    const bracket = source[i] === '[' ? /^\[(=*)\[/.exec(source.slice(i, i + 96)) : null;
    if (bracket) {
      const start = i;
      const close = ']' + bracket[1] + ']';
      const pos = source.indexOf(close, i + bracket[0].length);
      i = pos < 0 ? source.length : pos + close.length;
      hide(start, i);
      continue;
    }
    if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const start = i, quote = source[i++];
      while (i < source.length) {
        if (source[i] === '\\') i += 2;
        else if (source[i++] === quote) break;
      }
      hide(start, Math.min(i, source.length));
      continue;
    }
    i++;
  }
  return mask.join('');
}

function tokenize(src) {
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z_0-9]*)|(==|~=|<=|>=|[()+\-*\/%^<>]))/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    pattern.lastIndex = i;
    const m = pattern.exec(src);
    if (!m) return null;
    tokens.push({ type: m[1] ? 'number' : m[2] ? 'name' : 'op', value: m[1] || m[2] || m[3] });
    i = pattern.lastIndex;
  }
  return tokens;
}

function parse(tokens) {
  if (!tokens || !tokens.length) return null;
  let at = 0;
  const peek = () => tokens[at]?.value;
  const take = v => { if (peek() !== v) throw new Error('Unexpected token'); at++; };
  function expr(min = 0) {
    let left;
    const next = tokens[at++];
    if (!next) throw new Error('Unexpected expression end');
    if (next.value === 'if') {
      const condition = expr(); take('then');
      const yes = expr(); take('else');
      const no = expr();
      left = { type: 'if', condition, yes, no };
    } else if (next.value === '-') {
      left = { type: 'neg', value: expr(4) };
    } else if (next.value === '(') {
      left = expr(); take(')');
    } else if (next.type === 'number') {
      left = { type: 'const', value: Number(next.value) };
      if (!Number.isFinite(left.value) || Math.abs(left.value) > 1e12) throw new Error('Unsafe constant');
    } else if (next.type === 'name' && !['then','else','if','and','or','not','nil','true','false'].includes(next.value)) {
      left = { type: 'var', name: next.value };
    } else {
      throw new Error('Unsupported primary token');
    }
    while (BINARY.has(peek()) && PREC[peek()] >= min) {
      const op = tokens[at++].value;
      const p = PREC[op];
      // exponentiation is right associative in Lua
      const right = expr(p + (op === '^' ? 0 : 1));
      left = { type: 'bin', op, left, right };
    }
    return left;
  }
  try {
    const ast = expr();
    return at === tokens.length ? ast : null;
  } catch { return null; }
}

function generate(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('Expected source string');
  const limit = options.maxExpressions ?? 32;
  const ops = ['CONST','ARG','NEG','MOV','IFNOT','JUMP','RETURN','ADD','SUB','MUL','DIV','MOD','POW','LT','GT','LE','GE','EQ','NE'];
  const used = new Set();
  for (const op of ops) {
    let id; do { id = rand(230) + 10; } while (used.has(id));
    used.add(id);
  }
  const codes = Object.fromEntries(ops.map((op,i) => [op,[...used][i]]));
  const programs = [];
  const name = '__BMV2_' + crypto.randomBytes(7).toString('hex');
  const mask = safeMask(source);
  const lines = source.split('\n');
  const maskedLines = mask.split('\n');
  const out = [];
  let transformed = 0;
  let totalInstructions = 0;

  function compile(ast, instructions, variables) {
    let nextReg = rand(3) + 1;
    const emit = (op, a = 0, b = 0, c = 0) => { instructions.push([codes[op],a,b,c]); return instructions.length; };
    const reg = () => nextReg++;
    function node(n) {
      if (n.type === 'const') {
        const dst = reg(), key = Number.isInteger(n.value) ? rand(3000) - 1500 : 0;
        emit('CONST', dst, n.value + key, -key);
        return dst;
      }
      if (n.type === 'var') {
        if (!variables.has(n.name)) variables.set(n.name, variables.size + 1);
        const dst = reg(); emit('ARG', dst, variables.get(n.name)); return dst;
      }
      if (n.type === 'neg') {
        const src = node(n.value), dst = reg(); emit('NEG', dst, src); return dst;
      }
      if (n.type === 'bin') {
        const left = node(n.left), right = node(n.right), dst = reg();
        const mapping = {'+':'ADD','-':'SUB','*':'MUL','/':'DIV','%':'MOD','^':'POW','<':'LT','>':'GT','<=':'LE','>=':'GE','==':'EQ','~=':'NE'};
        emit(mapping[n.op], dst, left, right);
        return dst;
      }
      if (n.type === 'if') {
        const cond = node(n.condition), dst = reg();
        const guard = emit('IFNOT', cond, 0);
        const yes = node(n.yes); emit('MOV', dst, yes);
        const skip = emit('JUMP', 0);
        instructions[guard-1][2] = instructions.length + 1;
        const no = node(n.no); emit('MOV', dst, no);
        instructions[skip-1][1] = instructions.length + 1;
        return dst;
      }
      throw new Error('Unknown VM node');
    }
    const resultReg = node(ast);
    emit('RETURN', resultReg);
    if (instructions.length > 256) throw new Error('VM instruction limit exceeded');
  }

  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    const masked = maskedLines[i] || '';
    // Conservative: only untyped single-name, single-line local initializers.
    const m = /^([ \t]*local[ \t]+[a-zA-Z_][\w]*[ \t]*=[ \t]*)(.*)$/.exec(masked);
    const following = maskedLines[i+1] || '';
    if (!m || transformed >= limit || /^\s*(?:[-+*\/%^.<>=]|and\b|or\b)/.test(following)) { out.push(original); continue; }
    const rawExpr = m[2].trim();
    if (!rawExpr) { out.push(original); continue; }
    const ast = parse(tokenize(rawExpr));
    if (!ast) { out.push(original); continue; }
    const instructions = [], variables = new Map();
    try { compile(ast, instructions, variables); }
    catch { out.push(original); continue; }
    const slot = programs.length + 1;
    programs.push(instructions);
    const suffix = original.slice(m[1].length + m[2].length);
    const args = [...variables.keys()].map(v => ', ' + v).join('');
    out.push(original.slice(0, m[1].length) + name + '(' + slot + args + ')' + suffix);
    transformed++;
    totalInstructions += instructions.length;
  }

  if (!transformed) return { code: source, virtualizedExpressions: 0, vmInstructions: 0 };
  const programSource = '{' + programs.map(p => '{' + p.map(ins => '{' + ins.join(',') + '}').join(',') + '}').join(',') + '}';
  const d = codes;
  const runtime = [
    'local ' + name + '=(function()',
    ' local programs=' + programSource,
    ' return function(slot,...)',
    '  local p=programs[slot]',
    '  local args={...}',
    '  local r={}',
    '  local pc=1',
    '  while true do',
    '   local ins=p[pc]',
    '   if not ins then error("Invalid VM program counter") end',
    '   local op=ins[1]',
    '   local a,b,c=ins[2],ins[3],ins[4]',
    '   local nextPc=pc+1',
    '   if op==' + d.CONST + ' then r[a]=b+c',
    '   elseif op==' + d.ARG + ' then r[a]=args[b]',
    '   elseif op==' + d.NEG + ' then r[a]=-r[b]',
    '   elseif op==' + d.MOV + ' then r[a]=r[b]',
    '   elseif op==' + d.IFNOT + ' then if not r[a] then nextPc=b end',
    '   elseif op==' + d.JUMP + ' then nextPc=a',
    '   elseif op==' + d.RETURN + ' then return r[a]',
    '   elseif op==' + d.ADD + ' then r[a]=r[b]+r[c]',
    '   elseif op==' + d.SUB + ' then r[a]=r[b]-r[c]',
    '   elseif op==' + d.MUL + ' then r[a]=r[b]*r[c]',
    '   elseif op==' + d.DIV + ' then r[a]=r[b]/r[c]',
    '   elseif op==' + d.MOD + ' then r[a]=r[b]%r[c]',
    '   elseif op==' + d.POW + ' then r[a]=r[b]^r[c]',
    '   elseif op==' + d.LT + ' then r[a]=r[b]<r[c]',
    '   elseif op==' + d.GT + ' then r[a]=r[b]>r[c]',
    '   elseif op==' + d.LE + ' then r[a]=r[b]<=r[c]',
    '   elseif op==' + d.GE + ' then r[a]=r[b]>=r[c]',
    '   elseif op==' + d.EQ + ' then r[a]=r[b]==r[c]',
    '   elseif op==' + d.NE + ' then r[a]=r[b]~=r[c]',
    '   else error("Invalid VM opcode") end',
    '   pc=nextPc',
    '  end',
    ' end',
    'end)()',
    ''
  ].join('\n');

  const transformedCode = out.join('\n');
  // Preserve Luau directives and the UTF-8 BOM.
  const header = /^(?:\uFEFF)?(?:(?:--![^\r\n]*\r?\n)*)/.exec(transformedCode)[0];
  return {
    code: header + runtime + transformedCode.slice(header.length),
    virtualizedExpressions: transformed,
    vmInstructions: totalInstructions
  };
}

module.exports = { generate, tokenize, parse, safeMask };
