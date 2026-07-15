const express = require("express");
const cors = require("cors");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "BlackMamer Lua Obfuscator API" });
});

app.post("/obfuscate", (req, res) => {
  const { code, preset = "Medium" } = req.body;
  
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "No code provided." });
  }
  if (code.length > 500000) {
    return res.status(400).json({ error: "Code too large (max ~500KB)." });
  }

  try {
    const result = obfuscateWithPrometheus(code, preset);
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: "Obfuscation failed: " + e.message });
  }
});

function obfuscateWithPrometheus(code, preset) {
  const tempDir = os.tmpdir();
  const inputFile = path.join(tempDir, `input_${Date.now()}.lua`);
  const outputFile = path.join(tempDir, `output_${Date.now()}.lua`);
  
  try {
    fs.writeFileSync(inputFile, code, "utf8");
    
    // Path Prometheus di Render
    const prometheusPath = "/opt/render/project/src/Prometheus/cli.lua";
    const cmd = `lua ${prometheusPath} --preset ${preset} --LuaU "${inputFile}" --out "${outputFile}"`;
    
    console.log("Running:", cmd);
    execSync(cmd, { stdio: "pipe", timeout: 60000 });
    
    const result = fs.readFileSync(outputFile, "utf8");
    return result;
    
  } catch (e) {
    console.error("Prometheus error:", e.message);
    return fallbackObfuscator(code);
  } finally {
    try { fs.unlinkSync(inputFile); } catch(e) {}
    try { fs.unlinkSync(outputFile); } catch(e) {}
  }
}

// ─── FALLBACK OBFUSCATOR ────────────────────────────────────────────────

function fallbackObfuscator(src) {
  let code = src
    .replace(/--\[\[[\s\S]*?--\]\]/g, "")
    .replace(/--[^\n]*/g, "")
    .trim();

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

  for (const [key, idx] of Object.entries(stringMap)) {
    code = code.replace(new RegExp(key, "g"), `r[${idx + 1}]`);
  }
  
  for (const [key, val] of Object.entries(numberMap)) {
    code = code.replace(new RegExp(key, "g"), `(${val})`);
  }
  
  for (const [orig, obf] of Object.entries(varMap)) {
    code = code.replace(new RegExp(`\\b${orig}\\b`, "g"), obf);
  }

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

function wrapWeAreDevsOneLine(code, strings) {
  const stringTable = strings.length > 0 ? strings.join(",") : '""';
  const unpackIndex = Math.floor(Math.random() * 1000) + 100;
  
  const oneLineCode = code.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  
  const header = `--[[ v1.0.0 https://blackmamerstudio.netlify.app ]]`;
  
  const decoder = `local function E(E)return r[E-(${strings.length + 1})]end do local E=string.sub local M=table.insert local V=string.len local L=table.concat local R=type local J=r local x=math.floor local l=string.char local I={} for x=1,#J do local h=J[x]if R(h)=="string"then local R=V(h)local Q={}local v=1 local A=0 local m=0 while v<=R do local r=E(h,v,v)local V=I[r]if V then A=A+V*(32)^(3-m)m=m+1 if m==4 then m=0 local r=x(A/256)local E=x((A%256)/16)local V=A%16 M(Q,l(r,E,V))A=0 end elseif r=="="then M(Q,l(x(A/256)))if v>=R or E(h,v+1,v+1)~="="then M(Q,l(x((A%256)/16)))end break end v=v+1 end J[x]=L(Q)end end end`;

  const loader = `return(function(...)local r={${stringTable}};for E,M in ipairs({{-1,0},{0,1}})do while M[-1]<M[0]do r[M[0]],r[M[1]],M[0],M[1]=r[M[1]],r[M[0]],M[0]+1,M[1]-1 end end ${decoder} return(function($,_,__,___,____,_____,______,_______) ${oneLineCode} end)(getfenv and getfenv()or _ENV,unpack or table[${unpackIndex}],newproxy,setmetadatagetmetatable,select,{...})end)(...)`;

  return header + loader;
}

app.listen(PORT, () => console.log(`✅ BlackMamer Obfuscator API running on port ${PORT}`));
