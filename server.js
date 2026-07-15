const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "5mb" }));

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

// ─── CORE OBFUSCATOR ──────────────────────────────────────────────────────

function obfuscate(src) {
  let code = src
    .replace(/--\[\[[\s\S]*?--\]\]/g, "")
    .replace(/--[^\n]*/g, "")
    .trim();

  // ─── STRING TABLE ──────────────────────────────────────────────────────
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
      return `\\${String(c.charCodeAt(0)).padStart(3, '0')}`;
    }).join('');
    
    stringTable.push(`"${encoded}"`);
    const key = `__S_${stringIndex}__`;
    stringMap[key] = stringIndex;
    stringIndex++;
    return key;
  });

  // ─── NUMBER TABLE ──────────────────────────────────────────────────────
  const numberMap = {};
  let numberIndex = 0;

  code = code.replace(/\b(\d+)\b/g, (match, num) => {
    const n = parseInt(num);
    if (isNaN(n) || n < 0 || n > 99999) return match;
    const key = `__N_${numberIndex}__`;
    numberMap[key] = n;
    numberIndex++;
    return key;
  });

  // ─── VARIABLE RENAME ──────────────────────────────────────────────────
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
        varMap[name] = generateWeAreDevsName(varIndex);
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
        varMap[clean] = generateWeAreDevsName(varIndex);
        varIndex++;
      }
    }
  }

  // ─── REPLACE ──────────────────────────────────────────────────────────
  for (const [key, idx] of Object.entries(stringMap)) {
    code = code.replace(new RegExp(key, "g"), `r[${idx + 1}]`);
  }
  
  for (const [key, val] of Object.entries(numberMap)) {
    code = code.replace(new RegExp(key, "g"), `(${val})`);
  }
  
  for (const [orig, obf] of Object.entries(varMap)) {
    code = code.replace(new RegExp(`\\b${orig}\\b`, "g"), obf);
  }

  // ─── CONTROL FLOW FLATTENING ──────────────────────────────────────────
  code = flattenControlFlow(code);

  // ─── WRAP (SEMUA DALAM SATU BARIS) ────────────────────────────────────
  return wrapWeAreDevsOneLine(code, stringTable);
}

function generateWeAreDevsName(idx) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let name = "";
  let i = idx;
  do {
    name = chars[i % chars.length] + name;
    i = Math.floor(i / chars.length);
  } while (i > 0);
  return name;
}

// ─── CONTROL FLOW FLATTENING ────────────────────────────────────────────

function flattenControlFlow(code) {
  const lines = code.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return code;
  
  let result = [];
  let state = 0;
  
  result.push(`local M=0`);
  result.push(`while M<${lines.length + 1} do`);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (/^if\s+/.test(line)) {
      const condition = line.replace(/^if\s+/, '').replace(/\s+then\s*$/, '');
      let depth = 1;
      let endIndex = i + 1;
      let elseIndex = -1;
      let hasElse = false;
      
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/^if\s+/.test(l)) depth++;
        else if (/^end\s*$/.test(l)) {
          depth--;
          if (depth === 0) { endIndex = j; break; }
        } else if ((/^else\s*$/.test(l) || /^elseif\s+/.test(l)) && depth === 1) {
          hasElse = true;
          elseIndex = j;
          break;
        }
      }
      
      const trueState = state + 1;
      const falseState = hasElse ? state + 2 : endIndex + 1;
      
      result.push(`if M==${state} then if ${condition} then M=${trueState} else M=${falseState} end`);
      state++;
      
      const blockStart = i + 1;
      const blockEnd = hasElse ? elseIndex : endIndex;
      
      for (let j = blockStart; j < blockEnd; j++) {
        const blockLine = lines[j];
        if (!/^else|^elseif|^end/.test(blockLine)) {
          result.push(`elseif M==${state} then ${blockLine} M=${state + 1}`);
          state++;
        }
      }
      
      result.push(`elseif M==${state} then M=${endIndex + 1}`);
      state++;
      i = endIndex;
      continue;
    }
    
    if (/^else\s*$/.test(line)) {
      let depth = 1;
      let endIndex = i + 1;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/^if\s+/.test(l)) depth++;
        else if (/^end\s*$/.test(l)) {
          depth--;
          if (depth === 0) { endIndex = j; break; }
        }
      }
      
      result.push(`elseif M==${state} then`);
      state++;
      for (let j = i + 1; j < endIndex; j++) {
        const blockLine = lines[j];
        if (!/^else|^elseif|^end/.test(blockLine)) {
          result.push(`elseif M==${state} then ${blockLine} M=${state + 1}`);
          state++;
        }
      }
      result.push(`elseif M==${state} then M=${endIndex + 1}`);
      state++;
      i = endIndex;
      continue;
    }
    
    if (/^end\s*$/.test(line)) {
      continue;
    }
    
    if (line.length > 0) {
      if (/^return\s+/.test(line)) {
        result.push(`elseif M==${state} then ${line}`);
      } else {
        result.push(`elseif M==${state} then ${line} M=${state + 1}`);
        state++;
      }
    }
  }
  
  result.push(`elseif M==${state} then break end`);
  result.push(`end`);
  
  // Gabungkan semua dalam satu baris
  return result.join(" ");
}

// ─── WRAPPER SATU BARIS (SEPERTI WEAREDEVS) ────────────────────────────

function wrapWeAreDevsOneLine(code, strings) {
  const stringTable = strings.length > 0 ? strings.join(",") : '""';
  
  // OFFSET ACAK
  const offset = Math.floor(Math.random() * 100000) + 900000;
  const offsetExpr = `+(${offset}-${offset - 1})`;
  
  const header = `--[[ v1.0.0 https://blackmamerstudio.netlify.app ]]`;
  
  // DECODER (SAMA PERSIS WEAREDEVS)
  const decoder = `local function E(E)return r[E${offsetExpr}]end for E,M in ipairs({{-512178+512179,782660-782189},{251061+-251060,-928189+928559};{415663+-415292,-222803+223274}})do while M[-517810+517811]<M[298629+-298627]do r[M[198780+-198779]],r[M[-622346+622348]],M[-131884+131885],M[-226190-(-226192)]=r[M[-38528-(-38530)]],r[M[806755-806754]],M[447643+-447642]+(777417+-777416),M[939661-939659]-(906318+-906317)end end do local E=string.sub local M=table.insert local V=string.len local L=table.concat local R=type local J=r local x=math.floor local l=string.char local I={} for x=1,#J do local h=J[x]if R(h)=="string"then local R=V(h)local Q={}local v=1 local A=0 local m=0 while v<=R do local r=E(h,v,v)local V=I[r]if V then A=A+V*(32)^(3-m)m=m+1 if m==4 then m=0 local r=x(A/256)local E=x((A%256)/16)local V=A%16 M(Q,l(r,E,V))A=0 end elseif r=="="then M(Q,l(x(A/256)))if v>=R or E(h,v+1,v+1)~="="then M(Q,l(x((A%256)/16)))end break end v=v+1 end J[x]=L(Q)end end end`;

  // KODE DALAM SATU BARIS
  const oneLineCode = code.replace(/\n/g, " ").replace(/\s+/g, " ").trim();

  // LOADER
  const loader = `return(function(...)local r={${stringTable}};${decoder}return(function($,_,__,___,____,_____,______,_______) ${oneLineCode} end)(getfenv and getfenv()or _ENV,unpack or table[${Math.floor(Math.random() * 1000) + 100}],newproxy,setmetadatagetmetatable,select,{...})end)(...)`;

  return header + loader;
}

app.listen(PORT, () => console.log(`✅ BlackMamer Obfuscator API running on port ${PORT}`));
