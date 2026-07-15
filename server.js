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

// ─── CORE OBFUSCATOR ─── WEAREDEVS STYLE ──────────────────────────────────

function obfuscate(src) {
  // 1. Bersihkan script (hapus komentar)
  let code = src
    .replace(/--\[\[[\s\S]*?--\]\]/g, "")
    .replace(/--[^\n]*/g, "")
    .trim();

  // 2. Ekstrak semua string literal ke dalam tabel
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
    
    // Encode string ke ASCII escape (seperti WeAreDevs)
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

  // 3. Ekstrak semua number literals
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

  // 4. Rename semua variable (local + parameters)
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

  // Temukan semua local variables
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

  // Function parameters
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

  // 6. Control Flow Flattening (VERSION 3 - AMAN)
  code = flattenControlFlowSafe(code);

  // 7. Wrap dengan loader ala WeAreDevs
  return wrapWeAreDevs(code, stringTable);
}

// ─── GENERATE VARIABLE NAME ──────────────────────────────────────────────
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

// ─── CONTROL FLOW FLATTENING (VERSION 3 - AMAN UNTUK IF/ELSE) ──────────
function flattenControlFlowSafe(code) {
  // Pisahkan baris
  let lines = code.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  
  if (lines.length === 0) return code;
  
  let result = [];
  let state = 0;
  let indent = 0;
  let skipNext = false;
  
  // Build state machine
  result.push(`local _M=0`);
  result.push(`while _M<${lines.length + 1} do`);
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const nextState = (i + 1) % lines.length;
    
    // Skip baris yang sudah diproses
    if (skipNext) {
      skipNext = false;
      continue;
    }
    
    // Deteksi if/elseif/else/end
    if (/^if\s+/.test(line)) {
      // Extract kondisi
      const condition = line.replace(/^if\s+/, '').replace(/\s+then\s*$/, '');
      
      // Cari pasangan end
      let depth = 1;
      let endIndex = i + 1;
      let elseIndex = -1;
      let hasElse = false;
      let elseIfBlocks = [];
      
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/^if\s+/.test(l)) depth++;
        else if (/^end\s*$/.test(l)) {
          depth--;
          if (depth === 0) {
            endIndex = j;
            break;
          }
        } else if (/^else\s*$/.test(l) && depth === 1) {
          hasElse = true;
          elseIndex = j;
          break;
        } else if (/^elseif\s+/.test(l) && depth === 1) {
          hasElse = true;
          elseIndex = j;
          elseIfBlocks.push(j);
          break;
        }
      }
      
      // Simpan state saat ini
      const startState = state;
      const trueState = state + 1;
      const falseState = hasElse ? state + 2 : endIndex + 1;
      
      // Generate if state
      result.push(`  if _M==${state} then`);
      result.push(`    if ${condition} then`);
      result.push(`      _M=${trueState}`);
      result.push(`    else`);
      result.push(`      _M=${falseState}`);
      result.push(`    end`);
      state++;
      
      // Proses blok IF (true)
      const blockStart = i + 1;
      const blockEnd = hasElse ? elseIndex : endIndex;
      
      for (let j = blockStart; j < blockEnd; j++) {
        const blockLine = lines[j];
        if (!/^else|^elseif|^end/.test(blockLine)) {
          result.push(`  if _M==${state} then`);
          result.push(`    ${blockLine}`);
          result.push(`    _M=${state + 1}`);
          state++;
        }
      }
      
      // Arahkan ke akhir blok
      result.push(`  if _M==${state} then`);
      result.push(`    _M=${endIndex + 1}`);
      state++;
      
      // Skip ke end
      i = endIndex;
      continue;
    }
    
    // Handle else
    if (/^else\s*$/.test(line)) {
      // Cari end
      let depth = 1;
      let endIndex = i + 1;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/^if\s+/.test(l)) depth++;
        else if (/^end\s*$/.test(l)) {
          depth--;
          if (depth === 0) {
            endIndex = j;
            break;
          }
        }
      }
      
      // Proses blok ELSE
      result.push(`  if _M==${state} then`);
      state++;
      for (let j = i + 1; j < endIndex; j++) {
        const blockLine = lines[j];
        if (!/^else|^elseif|^end/.test(blockLine)) {
          result.push(`  if _M==${state} then`);
          result.push(`    ${blockLine}`);
          result.push(`    _M=${state + 1}`);
          state++;
        }
      }
      result.push(`  if _M==${state} then`);
      result.push(`    _M=${endIndex + 1}`);
      state++;
      
      i = endIndex;
      continue;
    }
    
    // Handle end - skip
    if (/^end\s*$/.test(line)) {
      continue;
    }
    
    // Handle normal lines
    if (line.length > 0) {
      result.push(`  if _M==${state} then`);
      
      // Deteksi pattern khusus
      if (/^return\s+/.test(line)) {
        result.push(`    ${line}`);
        // Return tidak perlu state transition
      } else {
        result.push(`    ${line}`);
        result.push(`    _M=${state + 1}`);
        state++;
      }
    }
  }
  
  // Final state - exit
  result.push(`  if _M==${state} then`);
  result.push(`    break`);
  result.push(`  end`);
  result.push(`end`);
  
  return result.join("\n");
}

// ─── WEAREDEVS STYLE WRAPPER ─────────────────────────────────────────────
function wrapWeAreDevs(code, strings) {
  // Build string table
  const stringTable = strings.length > 0 ? strings.join(",") : '""';
  
  // Random angka untuk table.unpack index
  const unpackIndex = Math.floor(Math.random() * 1000) + 100;
  
  const header = `--[[ v1.0.0 https://blackmamerstudio.netlify.app ]]`;
  
  // String decoding function (seperti WeAreDevs)
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
