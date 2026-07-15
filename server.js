const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "BlackMamer Lua Obfuscator API" });
});

app.post("/obfuscate", (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "No code provided." });
  }
  if (code.length > 500000) {
    return res.status(400).json({ error: "Code too large (max ~500KB)." });
  }

  try {
    const result = obfuscate(code);
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: "Obfuscation failed: " + e.message });
  }
});

// ─── CORE OBFUSCATOR ─── WEAREDEVS CLONE ──────────────────────────────────

function obfuscate(src) {
  // 1. Bersihkan script
  let code = src
    .replace(/--\[\[[\s\S]*?--\]\]/g, "")
    .replace(/--[^\n]*/g, "")
    .trim();

  // 2. Ekstrak semua string literal
  const stringTable = [];
  const stringMap = {};
  let stringIndex = 0;

  code = code.replace(/(["'])((?:[^\1\\]|\\[\s\S])*?)\1/g, (match, q, content) => {
    let raw;
    try {
      raw = content
        .replace(/\\n/g, "\n").replace(/\\t/g, "\t")
        .replace(/\\r/g, "\r").replace(/\\\\/g, "\\")
        .replace(/\\"/g, '"').replace(/\\'/g, "'");
    } catch { return match; }
    
    if (raw.length === 0 || raw.length > 500) return match;
    
    const encoded = raw.split('').map(c => {
      const code = c.charCodeAt(0);
      return `\\${String(code).padStart(3, '0')}`;
    }).join('');
    
    stringTable.push(`"${encoded}"`);
    const key = `__STR_${stringIndex}__`;
    stringMap[key] = stringIndex;
    stringIndex++;
    return key;
  });

  // 3. Ekstrak semua number
  const numberMap = {};
  let numberIndex = 0;

  code = code.replace(/\b(\d+)\b/g, (match, num) => {
    const n = parseInt(num);
    if (isNaN(n) || n < 0 || n > 99999) return match;
    const key = `__NUM_${numberIndex}__`;
    numberMap[key] = n;
    numberIndex++;
    return key;
  });

  // 4. Rename variables
  const varMap = {};
  let varIndex = 0;
  const reserved = new Set([
    "and","break","do","else","elseif","end","false","for","function","goto",
    "if","in","local","nil","not","or","repeat","return","then","true","until","while",
    "game","workspace","script","Players","ReplicatedStorage","ServerStorage",
    "RunService","DataStoreService","HttpService","TweenService","CollectionService",
    "Instance","Vector3","CFrame","Color3","UDim","UDim2","Enum","ColorSequence",
    "NumberSequence","TweenInfo","task","wait","tick","time","pairs","ipairs",
    "next","select","unpack","rawget","rawset","rawequal","rawlen",
    "setmetatable","getmetatable","pcall","xpcall","error","assert",
    "type","tostring","tonumber","print","warn","require","load","loadstring"
  ]);

  const localRegex = /\blocal\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)/g;
  let m;
  while ((m = localRegex.exec(code)) !== null) {
    const names = m[1].split(",").map(s => s.trim());
    for (const name of names) {
      if (!reserved.has(name) && !varMap[name]) {
        varMap[name] = generateVarName(varIndex);
        varIndex++;
      }
    }
  }

  const funcRegex = /function\s*(?:[a-zA-Z_.:\[\]"']*)\s*\(([^)]*)\)/g;
  while ((m = funcRegex.exec(code)) !== null) {
    const params = m[1].split(",").map(s => s.trim()).filter(Boolean);
    for (const p of params) {
      const clean = p.replace(/^\.\.\./, "").trim();
      if (clean && !reserved.has(clean) && !varMap[clean]) {
        varMap[clean] = generateVarName(varIndex);
        varIndex++;
      }
    }
  }

  // 5. Replace semua placeholder
  for (const [key, idx] of Object.entries(stringMap)) {
    code = code.replace(new RegExp(key, "g"), `x[${idx + 1}]`);
  }
  
  for (const [key, val] of Object.entries(numberMap)) {
    code = code.replace(new RegExp(key, "g"), `(${val})`);
  }
  
  for (const [orig, obf] of Object.entries(varMap)) {
    code = code.replace(new RegExp(`\\b${orig}\\b`, "g"), obf);
  }

  // 6. Control Flow Flattening (VERSION 4 - AMAN)
  code = flattenControlFlowSafe(code);

  // 7. Wrap dengan loader ala WeAreDevs
  return wrapWeAreDevs(code, stringTable);
}

function generateVarName(idx) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let name = "";
  let i = idx;
  do {
    name = chars[i % chars.length] + name;
    i = Math.floor(i / chars.length);
  } while (i > 0);
  return name;
}

// ─── CONTROL FLOW FLATTENING VERSION 4 ──────────────────────────────────
function flattenControlFlowSafe(code) {
  // Parse kode menjadi baris-baris
  const lines = code.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  
  if (lines.length === 0) return code;
  
  // Bangun struktur blok
  const blocks = buildBlocks(lines);
  
  // Generate state machine
  let result = [];
  let state = 0;
  
  result.push(`local _M=0`);
  result.push(`while _M<${countStates(blocks) + 1} do`);
  
  const generated = generateStates(blocks, state);
  result.push(generated.code);
  
  // Final state - exit
  result.push(`  if _M==${generated.state} then`);
  result.push(`    break`);
  result.push(`  end`);
  result.push(`end`);
  
  return result.join("\n");
}

function buildBlocks(lines) {
  const blocks = [];
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    
    if (/^if\s+/.test(line)) {
      // Cari pasangan end
      const block = { type: 'if', condition: line.replace(/^if\s+/, '').replace(/\s+then\s*$/, ''), children: [] };
      let depth = 1;
      let j = i + 1;
      
      while (j < lines.length) {
        const l = lines[j];
        if (/^if\s+/.test(l)) depth++;
        else if (/^end\s*$/.test(l)) {
          depth--;
          if (depth === 0) {
            // Proses children
            const childLines = lines.slice(i + 1, j);
            block.children = buildBlocks(childLines);
            blocks.push(block);
            i = j + 1;
            break;
          }
        } else if (/^else\s*$/.test(l) && depth === 1) {
          // Else block
          block.elseBlock = { type: 'else', children: [] };
          const elseLines = [];
          let elseDepth = 1;
          let k = j + 1;
          while (k < lines.length) {
            const el = lines[k];
            if (/^if\s+/.test(el)) elseDepth++;
            else if (/^end\s*$/.test(el)) {
              elseDepth--;
              if (elseDepth === 0) {
                block.elseBlock.children = buildBlocks(lines.slice(j + 1, k));
                i = k + 1;
                break;
              }
            }
            k++;
          }
          blocks.push(block);
          break;
        } else if (/^elseif\s+/.test(l) && depth === 1) {
          // Elseif block - treat as else with condition
          block.elseBlock = { 
            type: 'elseif', 
            condition: l.replace(/^elseif\s+/, '').replace(/\s+then\s*$/, ''),
            children: []
          };
          // Cari end untuk elseif
          let elseifDepth = 1;
          let k = j + 1;
          while (k < lines.length) {
            const el = lines[k];
            if (/^if\s+/.test(el)) elseifDepth++;
            else if (/^end\s*$/.test(el)) {
              elseifDepth--;
              if (elseifDepth === 0) {
                block.elseBlock.children = buildBlocks(lines.slice(j + 1, k));
                i = k + 1;
                break;
              }
            } else if (/^else\s*$/.test(el) && elseifDepth === 1) {
              block.elseBlock.children = buildBlocks(lines.slice(j + 1, k));
              // Lanjutkan ke else
              const remaining = lines.slice(k);
              const elseBlock = buildBlocks(remaining);
              if (elseBlock.length > 0) {
                // Gabungkan
                block.elseBlock = { 
                  type: 'ifelse', 
                  condition: block.elseBlock.condition,
                  children: block.elseBlock.children,
                  elseBlock: elseBlock[0].elseBlock || null
                };
              }
              i = k;
              break;
            }
            k++;
          }
          blocks.push(block);
          break;
        }
        j++;
      }
    } else if (/^else\s*$/.test(line)) {
      // Else block - skip, sudah ditangani di atas
      i++;
      continue;
    } else if (/^end\s*$/.test(line)) {
      i++;
      continue;
    } else {
      // Statement biasa
      blocks.push({ type: 'statement', value: line });
      i++;
    }
  }
  
  return blocks;
}

function countStates(blocks) {
  let count = 0;
  for (const block of blocks) {
    if (block.type === 'if' || block.type === 'ifelse') {
      count += 1; // state untuk if
      count += countStates(block.children);
      if (block.elseBlock) {
        count += countStates(block.elseBlock.children || []);
      }
    } else if (block.type === 'statement') {
      count += 1;
    }
  }
  return count;
}

function generateStates(blocks, startState) {
  let state = startState;
  let code = [];
  
  for (const block of blocks) {
    if (block.type === 'statement') {
      code.push(`  if _M==${state} then`);
      code.push(`    ${block.value}`);
      code.push(`    _M=${state + 1}`);
      state++;
    } else if (block.type === 'if') {
      const trueState = state + 1;
      const falseState = state + 2 + countStates(block.children);
      
      code.push(`  if _M==${state} then`);
      code.push(`    if ${block.condition} then`);
      code.push(`      _M=${trueState}`);
      code.push(`    else`);
      code.push(`      _M=${falseState}`);
      code.push(`    end`);
      state++;
      
      // True branch
      const trueResult = generateStates(block.children, state);
      code.push(trueResult.code);
      state = trueResult.state;
      
      // Jump ke akhir if
      const endState = state + 1 + (block.elseBlock ? countStates(block.elseBlock.children || []) : 0);
      code.push(`  if _M==${state} then`);
      code.push(`    _M=${endState}`);
      state++;
      
      // False branch (else)
      if (block.elseBlock) {
        const elseResult = generateStates(block.elseBlock.children || [], state);
        code.push(elseResult.code);
        state = elseResult.state;
        code.push(`  if _M==${state} then`);
        code.push(`    _M=${endState}`);
        state++;
      }
      
      state = endState;
    }
  }
  
  return { code: code.join("\n"), state: state };
}

// ─── WEAREDEVS STYLE WRAPPER ─────────────────────────────────────────────
function wrapWeAreDevs(code, strings) {
  const stringTable = strings.length > 0 ? strings.join(",") : '""';
  const unpackIndex = Math.floor(Math.random() * 1000) + 100;
  
  const header = `--[[ v1.0.0 https://blackmamerstudio.netlify.app ]]`;
  
  const decoder = `
local function E(E)return x[E-(${strings.length + 1})]end
do local E=string.sub local M=table.insert local V=string.len local L=table.concat local R=type local J=x local x=math.floor local l=string.char
local I={}
for x=1,#J do local h=J[x]if R(h)=="string"then
local R=V(h)local Q={}local v=1 local A=0 local m=0
while v<=R do local r=E(h,v,v)local V=I[r]if V then A=A+V*(32)^(3-m)m=m+1
if m==4 then m=0 local r=x(A/256)local E=x((A%256)/16)local V=A%16
M(Q,l(r,E,V))A=0 end elseif r=="="then M(Q,l(x(A/256)))if v>=R or E(h,v+1,v+1)~="="then M(Q,l(x((A%256)/16)))end break end v=v+1 end J[x]=L(Q)end end end`;

  const loader = `return(function(...)local x={${stringTable}};
for E,M in ipairs({{-1,0},{0,1}})do
while M[-1]<M[0]do x[M[0]],x[M[1]],M[0],M[1]=x[M[1]],x[M[0]],M[0]+1,M[1]-1 end end
${decoder}
return(function($,_,__,___,____,_____,______,_______) 
${code}
end)(getfenv and getfenv()or _ENV,unpack or table[${unpackIndex}],newproxy,setmetatable,getmetatable,select,{...})end)(...)`;

  return header + loader;
}

// ─── START SERVER ──────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`✅ BlackMamer Obfuscator API running on port ${PORT}`));
