'use strict';

// BLACKMAMER VM V1 - custom Lua/Luau string-literal VM.
// Not a full Luau virtualizer; Prometheus remains the main engine.
const crypto = require('node:crypto');
const random = n => crypto.randomInt(n);

function longEnd(src, pos) {
  const m = /^\[(=*)\[/.exec(src.slice(pos, pos + 100));
  if (!m) return null;
  const close = ']' + m[1] + ']';
  const i = src.indexOf(close, pos + m[0].length);
  return i < 0 ? src.length : i + close.length;
}

function quoteEnd(src, start) {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '\\') i += 2;
    else if (src[i] === quote) return i + 1;
    else if (src[i] === '\r' || src[i] === '\n') return null;
    else i++;
  }
  return null;
}

function decode(literal) {
  const s = literal.slice(1, -1);
  const bytes = [];
  const escapes = { a: 7, b: 8, f: 12, n: 10, r: 13,
    t: 9, v: 11, '\\': 92, '"': 34, "'": 39 };
  for (let i = 0; i < s.length;) {
    if (s[i] !== '\\') {
      const cp = s.codePointAt(i);
      bytes.push(...Buffer.from(String.fromCodePoint(cp), 'utf8'));
      i += cp > 0xffff ? 2 : 1;
      continue;
    }
    i++;
    if (i >= s.length) return null;
    const ch = s[i++];
    if (Object.hasOwn(escapes, ch)) {
      bytes.push(escapes[ch]);
    } else if (/[0-9]/.test(ch)) {
      let num = ch;
      while (num.length < 3 && i < s.length && /[0-9]/.test(s[i])) num += s[i++];
      const n = Number(num);
      if (n > 255) return null;
      bytes.push(n);
    } else if (ch === 'x' && /^[0-9a-fA-F]{2}/.test(s.slice(i))) {
      bytes.push(parseInt(s.slice(i, i + 2), 16));
      i += 2;
    } else if (ch === 'z') {
      while (i < s.length && /\s/.test(s[i])) i++;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && s[i] === '\n') i++;
      bytes.push(10);
    } else if (ch === 'u' && s[i] === '{') {
      const m = /^\{([0-9a-fA-F]+)\}/.exec(s.slice(i));
      if (!m) return null;
      const cp = parseInt(m[1], 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      bytes.push(...Buffer.from(String.fromCodePoint(cp), 'utf8'));
      i += m[0].length;
    } else {
      // Unknown escapes remain unchanged.
      return null;
    }
  }
  return Buffer.from(bytes);
}

function looksTyped(src, offset) {
  const lineStart = src.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = src.indexOf('\n', offset);
  const before = src.slice(lineStart, offset);
  const whole = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd);
  if (/^\s*(?:export\s+)?type\b/.test(before)) return true;
  if (/::\s*$/.test(before) || /:\s*$/.test(before)) return true;
  if (/\b(?:export\s+)?type\s+[A-Za-z_]/.test(whole)) return true;
  return false;
}

function makeRuntime(name, programs, op) {
  const serialized = programs.map(p =>
    '{' + p.map(ins => '{' + ins.join(',') + '}').join(',') + '}'
  ).join(',\n');
  return [
    'local ' + name + '=(function()',
    ' local data={' + serialized + '}',
    ' local cache={}',
    ' return function(id)',
    '  if cache[id]~=nil then return cache[id] end',
    '  local program=data[id]',
    '  if not program then error("Invalid VM slot") end',
    '  local pc,value,out=1,0,{}',
    '  while true do',
    '   local a=program[pc]',
    '   if not a then error("Invalid VM bytecode") end',
    '   local opcode=a[1]',
    '   if opcode==' + op.LOAD + ' then value=a[2]',
    '   elseif opcode==' + op.ADD + ' then value=(value+a[2])%256',
    '   elseif opcode==' + op.EMIT + ' then out[#out+1]=string.char(value)',
    '   elseif opcode==' + op.JUMP + ' then pc=pc+a[2]',
    '   elseif opcode==' + op.STOP + ' then break',
    '   else error("Invalid VM instruction") end',
    '   pc=pc+1',
    '  end',
    '  local s=table.concat(out)',
    '  cache[id]=s',
    '  return s',
    ' end',
    'end)();',
    ''
  ].join('\n');
}

function transform(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('Expected Lua source string');
  const maxLiteralBytes = options.maxLiteralBytes ?? 256;
  const maxTotalBytes = options.maxTotalBytes ?? 4096;
  const unique = new Set();
  while (unique.size < 5) unique.add(10 + random(240));
  const [LOAD, ADD, EMIT, JUMP, STOP] = unique;
  const op = { LOAD, ADD, EMIT, JUMP, STOP };
  const name = '__BM_' + crypto.randomBytes(8).toString('hex');
  const programs = [];
  const chunks = [];
  let total = 0;

  for (let i = 0; i < source.length;) {
    if (source.startsWith('--', i)) {
      const end = longEnd(source, i + 2);
      const nl = source.indexOf('\n', i);
      const stop = end === null ? (nl < 0 ? source.length : nl) : end;
      chunks.push(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (source[i] === '[') {
      const end = longEnd(source, i);
      if (end !== null) {
        chunks.push(source.slice(i, end));
        i = end;
        continue;
      }
    }
    if (source.charCodeAt(i) === 96) {
      // Preserve interpolated Luau strings verbatim.
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') j += 2;
        else if (source.charCodeAt(j) === 96) { j++; break; }
        else j++;
      }
      chunks.push(source.slice(i, j));
      i = j;
      continue;
    }
    if (source[i] === "'" || source[i] === '"') {
      const end = quoteEnd(source, i);
      if (end === null) {
        chunks.push(source[i++]);
        continue;
      }
      const original = source.slice(i, end);
      const bytes = decode(original);
      if (bytes && bytes.length > 0 && bytes.length <= maxLiteralBytes &&
          total + bytes.length <= maxTotalBytes && !looksTyped(source, i)) {
        const program = [];
        for (const byte of bytes) {
          const key = random(256);
          program.push([LOAD, (byte + key) % 256]);
          program.push([ADD, (256 - key) % 256]);
          program.push([EMIT]);
          if (random(9) === 0) {
            program.push([JUMP, 1], [LOAD, random(256)]);
          }
        }
        program.push([STOP]);
        programs.push(program);
        chunks.push('(' + name + '(' + programs.length + '))');
        total += bytes.length;
      } else {
        chunks.push(original);
      }
      i = end;
      continue;
    }
    chunks.push(source[i++]);
  }

  if (programs.length === 0) return { code: source, literals: 0, protectedBytes: 0 };
  const transformed = chunks.join('');
  let headerEnd = transformed.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (transformed.startsWith('--!', headerEnd)) {
    const nl = transformed.indexOf('\n', headerEnd);
    headerEnd = nl < 0 ? transformed.length : nl + 1;
  }
  return {
    code: transformed.slice(0, headerEnd) +
      makeRuntime(name, programs, op) + transformed.slice(headerEnd),
    literals: programs.length,
    protectedBytes: total
  };
}

module.exports = { transform, decode };
