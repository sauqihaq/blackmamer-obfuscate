const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

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
  // 1. Bersihkan script
  let code = src
    .replace(/--\[\[[\s\S]*?--\]\]/g, "")
    .replace(/--[^\n]*/g, "")
    .trim();

  // 2. Parse dan extract semua string literal
  const strings = [];
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
    
    // Encode string ke ASCII
    const encoded = raw.split('').map(c => c.charCodeAt(0)).join(',');
    const key = `S${stringIndex}`;
    stringMap[key] = `"${encoded}"`;
    strings.push(key);
    stringIndex++;
    return `__STR_${key}__`;
  });

  // 3. Parse dan extract semua number literals
  let numberIndex = 0;
  const numberMap = {};
  
  code = code.replace(/\b(\d+)\b/g, (match, num) => {
    const n = parseInt(num);
    if (isNaN(n) || n < 0 || n > 99999) return match;
    const key = `N${numberIndex}`;
    numberMap[key] = n;
    numberIndex++;
    return `__NUM_${key}__`;
  });

  // 4. Parse variable names (local + global)
  const varMap = {};
  let varIndex = 0;
  const reserved = new Set([
    "and","break","do","else","elseif","end","false","for","function","goto",
    "if","in","local","nil","not","or","repeat","return","then","true","until","while",
    "game","workspace","script","Players","ReplicatedStorage","ServerStorage",
    "RunService","DataStoreService","HttpService","TweenService","CollectionService"
  ]);

  // Temukan semua local variables
  const localRegex = /\blocal\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)/g;
  let m;
  while ((m = localRegex.exec(code)) !== null) {
    const names = m[1].split(",").map(s => s.trim());
    for (const name of names) {
      if (!reserved.has(name) && !varMap[name]) {
        const obf = generateVarName(varIndex);
        varMap[name] = obf;
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
        const obf = generateVarName(varIndex);
        varMap[clean] = obf;
        varIndex++;
      }
    }
  }

  // 5. Replace semua string, number, variable placeholders
  for (const [key, value] of Object.entries(stringMap)) {
    code = code.replace(new RegExp(`__STR_${key}__`, "g"), `x[${strings.indexOf(key) + 1}]`);
  }
  
  for (const [key, value] of Object.entries(numberMap)) {
    code = code.replace(new RegExp(`__NUM_${key}__`, "g"), `(x[${numberIndex + parseInt(key.replace("N","")) + 1}])`);
  }
  
  for (const [orig, obf] of Object.entries(varMap)) {
    code = code.replace(new RegExp(`\\b${orig}\\b`, "g"), obf);
  }

  // 6. Build string table
  const stringTable = strings.map((key, i) => {
    const val = stringMap[key];
    return val;
  });

  // 7. Build number table
  const numberTable = Object.values(numberMap);

  // 8. Control Flow Flattening - ubah struktur kode
  code = flattenControlFlow(code);

  // 9. Wrap dengan loader ala WeAreDevs
  return wrapWeAreDevs(code, stringTable, numberTable, varMap);
}

// ─── GENERATE VARIABLE NAME ──────────────────────────────────────────────
function generateVarName(idx) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let name = "";
  let i = idx;
  do {
    name = chars[i % chars.length] + name;
    i = Math.floor(i / chars.length);
  } while (i > 0);
  return name;
}

// ─── CONTROL FLOW FLATTENING ─────────────────────────────────────────────
function flattenControlFlow(code) {
  // Sederhana: bungkus dalam loop while dengan state
  const lines = code.split("\n");
  let flattened = [];
  let state = 0;
  let states = [];
  
  // Parse basic blocks (sangat sederhana)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    states.push(line);
  }

  // Buat state machine
  flattened.push(`local _state=0`);
  flattened.push(`while _state<${states.length} do`);
  flattened.push(`  if _state==0 then`);
  
  for (let i = 0; i < states.length; i++) {
    const nextState = (i + 1) % states.length;
    flattened.push(`  elseif _state==${i} then`);
    flattened.push(`    ${states[i]}`);
    flattened.push(`    _state=${nextState}`);
  }
  
  flattened.push(`  end`);
  flattened.push(`end`);

  return flattened.join("\n");
}

// ─── WEAREDEVS STYLE WRAPPER ─────────────────────────────────────────────
function wrapWeAreDevs(code, strings, numbers, vars) {
  // Build string table (format: {"\097\098\099", ...})
  const stringTable = strings.map(s => {
    // Convert to ASCII escape
    const chars = s.split(',').map(n => parseInt(n));
    const escaped = chars.map(c => `\\${String(c).padStart(3, '0')}`).join('');
    return `"${escaped}"`;
  });

  // Build number table
  const numberTable = numbers.map(n => n.toString());

  // Build variable mapping
  const varTable = Object.entries(vars).map(([orig, obf]) => {
    return `["${orig}"]="${obf}"`;
  });

  const header = `--[[ v1.0.0 https://blackmamerstudio.netlify.app ]]`;
  
  const loader = `return(function(...)local x={${stringTable.join(",")}};
for B,O in ipairs({{-1,0},{0,1}})do
while O[-1]<O[0]do x[O[0]],x[O[1]],O[0],O[1]=x[O[1]],x[O[0]],O[0]+1,O[1]-1 end end
local function J(J)return x[J-(#x-1)]end
do local J=type local K=string.char local Q=x local P=table.insert local y=string.sub local l=math.floor local A=string.len local I=table.concat
local d={}
for x=1,#Q do local S=Q[x]if J(S)=="string"then
local J=A(S)local G={}local c=1 local Z=0 local p=0
while c<=J do local x=y(S,c,c)local Q=d[x]if Q then Z=Z+Q*(32)^(3-p)p=p+1
if p==4 then p=0 local x=l(Z/256)local J=l((Z%256)/16)local Q=Z%16
P(G,K(x,J,Q))Z=0 end elseif x=="="then P(G,K(l(Z/256)))if c>=J or y(S,c+1,c+1)~="="then P(G,K(l((Z%256)/16)))end break end c=c+1 end Q[x]=I(G)end end end
return(function($,_,__,___,____,_____,______,_______) 
${code}
end)(getfenv and getfenv()or _ENV,unpack or table[${Math.floor(Math.random()*1000)}],newproxy,setmetatable,getmetatable,select,{...})end)(...)`;

  return header + loader;
}

// ─── START SERVER ──────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`✅ BlackMamer Obfuscator API running on port ${PORT}`));
