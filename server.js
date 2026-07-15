const express = require("express");
const cors = require("cors");
const luaparse = require("luaparse");  // ← Ganti ke luaparse (lebih stabil)

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

// ─── OBFUSCATOR ──────────────────────────────────────────────────────────

function obfuscate(src) {
  let ast;
  try {
    // Parse dengan luaparse
    ast = luaparse.parse(src, {
      comments: false,
      scope: true,
      locations: true
    });
  } catch (e) {
    console.log("AST Parse failed, using fallback:", e.message);
    return fallbackObfuscate(src);
  }

  // ─── STRING TABLE ──────────────────────────────────────────────────
  const stringTable = [];
  const stringMap = {};
  let stringIndex = 0;

  // Traverse AST untuk extract semua string
  traverseAST(ast, (node) => {
    if (node.type === "StringLiteral") {
      const raw = node.value;
      if (raw.length > 0 && raw.length <= 500) {
        const encoded = raw.split('').map(c => {
          return `\\${String(c.charCodeAt(0)).padStart(3, '0')}`;
        }).join('');
        stringTable.push(`"${encoded}"`);
        const key = `__S_${stringIndex}__`;
        stringMap[node.start] = { key, idx: stringIndex };
        stringIndex++;
      }
    }
  });

  // ─── VARIABLE RENAME ──────────────────────────────────────────────
  const varMap = {};
  let varIndex = 0;
  const reserved = new Set([
    "and","break","do","else","elseif","end","false","for","function","goto",
    "if","in","local","nil","not","or","repeat","return","then","true","until","while"
  ]);

  const identifiers = [];
  traverseAST(ast, (node) => {
    if (node.type === "Identifier" && !reserved.has(node.name)) {
      identifiers.push(node);
    }
    if (node.type === "LocalStatement") {
      for (const id of node.identifiers) {
        if (!reserved.has(id.name)) {
          identifiers.push(id);
        }
      }
    }
  });

  for (const id of identifiers) {
    if (!varMap[id.name]) {
      varMap[id.name] = generateRandomName(varIndex);
      varIndex++;
    }
  }

  // ─── REPLACE DI AST ──────────────────────────────────────────────
  replaceInAST(ast, stringMap, varMap);

  // ─── GENERATE CODE ──────────────────────────────────────────────
  let code = generateCode(ast);

  // ─── CONTROL FLOW FLATTENING ────────────────────────────────────
  code = flattenControlFlow(code);

  // ─── WRAP ────────────────────────────────────────────────────────
  return wrapWeAreDevs(code, stringTable);
}

// ─── HELPER FUNCTIONS ────────────────────────────────────────────────────

function traverseAST(node, callback) {
  callback(node);
  if (node && typeof node === "object") {
    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "start" || key === "end") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object") traverseAST(item, callback);
        }
      } else if (child && typeof child === "object") {
        traverseAST(child, callback);
      }
    }
  }
}

function replaceInAST(ast, stringMap, varMap) {
  traverseAST(ast, (node) => {
    if (node.type === "StringLiteral") {
      const key = stringMap[node.start];
      if (key) {
        node.type = "Identifier";
        node.name = `r[${key.idx + 1}]`;
        node.raw = node.name;
      }
    }
    if (node.type === "Identifier") {
      const newName = varMap[node.name];
      if (newName) {
        node.name = newName;
        node.raw = newName;
      }
    }
  });
}

function generateCode(ast) {
  // Reconstruct code dari AST
  let code = "";
  const body = ast.body || [];
  for (const node of body) {
    code += generateNode(node) + "\n";
  }
  return code;
}

function generateNode(node) {
  if (!node) return "";
  
  switch (node.type) {
    case "Chunk":
      return node.body.map(n => generateNode(n)).join("\n");
    case "Statement":
    case "AssignmentStatement":
      const left = node.variables.map(v => generateNode(v)).join(", ");
      const right = node.init.map(v => generateNode(v)).join(", ");
      return `${left} = ${right}`;
    case "Identifier":
      return node.name;
    case "StringLiteral":
      return `"${node.value}"`;
    case "NumericLiteral":
      return String(node.value);
    case "CallStatement":
      return generateNode(node.expression);
    case "CallExpression":
      const args = node.arguments.map(a => generateNode(a)).join(", ");
      return `${generateNode(node.base)}(${args})`;
    case "MemberExpression":
      return `${generateNode(node.base)}.${node.identifier.name}`;
    case "IndexExpression":
      return `${generateNode(node.base)}[${generateNode(node.index)}]`;
    case "TableConstructorExpression":
      const fields = node.fields.map(f => {
        if (f.type === "TableKeyString") {
          return `${f.key.name} = ${generateNode(f.value)}`;
        } else if (f.type === "TableKey") {
          return `[${generateNode(f.key)}] = ${generateNode(f.value)}`;
        } else {
          return generateNode(f.value);
        }
      }).join(", ");
      return `{ ${fields} }`;
    case "BinaryExpression":
      return `(${generateNode(node.left)} ${node.operator} ${generateNode(node.right)})`;
    case "UnaryExpression":
      return `${node.operator}${generateNode(node.argument)}`;
    case "LocalStatement":
      const ids = node.identifiers.map(i => i.name).join(", ");
      const init = node.init.map(i => generateNode(i)).join(", ");
      return init ? `local ${ids} = ${init}` : `local ${ids}`;
    case "FunctionDeclaration":
      const params = node.parameters.map(p => p.name).join(", ");
      const body2 = node.body.body.map(n => generateNode(n)).join("\n");
      return `function ${node.identifier.name}(${params}) ${body2} end`;
    case "IfStatement":
      const cond = generateNode(node.condition);
      const thenBlock = node.thenBlock.map(n => generateNode(n)).join("\n");
      let ifCode = `if ${cond} then ${thenBlock}`;
      if (node.elseBlock) {
        const elseBlock = node.elseBlock.map(n => generateNode(n)).join("\n");
        ifCode += ` else ${elseBlock}`;
      }
      if (node.elseifBlocks) {
        for (const elseif of node.elseifBlocks) {
          ifCode += ` elseif ${generateNode(elseif.condition)} then ${elseif.thenBlock.map(n => generateNode(n)).join("\n")}`;
        }
      }
      return ifCode + ` end`;
    case "WhileStatement":
      return `while ${generateNode(node.condition)} do ${node.body.map(n => generateNode(n)).join("\n")} end`;
    case "RepeatStatement":
      return `repeat ${node.body.map(n => generateNode(n)).join("\n")} until ${generateNode(node.condition)}`;
    case "ForNumericStatement":
      return `for ${node.variable.name} = ${generateNode(node.start)} ${node.step ? `, ${generateNode(node.step)}` : ""} do ${node.body.map(n => generateNode(n)).join("\n")} end`;
    case "ReturnStatement":
      return `return ${node.arguments.map(a => generateNode(a)).join(", ")}`;
    case "BreakStatement":
      return "break";
    case "NilLiteral":
      return "nil";
    case "BooleanLiteral":
      return String(node.value);
    case "TableValue":
      return generateNode(node.value);
    default:
      return "";
  }
}

function generateRandomName(idx) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let name = "";
  let i = idx;
  do {
    name = chars[i % chars.length] + name;
    i = Math.floor(i / chars.length);
  } while (i > 0);
  if (Math.random() > 0.5) name += Math.floor(Math.random() * 10);
  return name;
}

// ─── CONTROL FLOW FLATTENING ────────────────────────────────────────────

function flattenControlFlow(code) {
  const lines = code.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return code;
  
  const stateMap = {};
  const shuffled = lines.map((_, i) => i);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (const idx of shuffled) {
    stateMap[idx] = Object.keys(stateMap).length;
  }
  
  let result = [];
  const totalStates = Object.keys(stateMap).length;
  result.push(`local M=${stateMap[0] || 0}`);
  result.push(`while M<${totalStates + 1} do`);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const myState = stateMap[i] || 0;
    const nextState = stateMap[(i + 1) % lines.length] || 0;
    
    if (/^if\s+/.test(line)) {
      result.push(`  if M==${myState} then`);
      result.push(`    ${line}`);
      continue;
    }
    if (/^else\s*$/.test(line) || /^elseif\s+/.test(line)) {
      continue;
    }
    if (/^end\s*$/.test(line)) {
      continue;
    }
    
    result.push(`  if M==${myState} then`);
    if (/^return\s+/.test(line)) {
      result.push(`    ${line}`);
    } else {
      result.push(`    ${line}`);
      result.push(`    M=${nextState}`);
    }
  }
  
  result.push(`  if M==${totalStates} then break end`);
  result.push(`end`);
  
  return result.join("\n");
}

// ─── FALLBACK OBFUSCATOR ────────────────────────────────────────────────

function fallbackObfuscate(src) {
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
    const encoded = raw.split('').map(c => `\\${String(c.charCodeAt(0)).padStart(3, '0')}`).join('');
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
    "if","in","local","nil","not","or","repeat","return","then","true","until","while"
  ]);

  const localRegex = /\blocal\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)/g;
  let m;
  while ((m = localRegex.exec(code)) !== null) {
    const names = m[1].split(",").map(s => s.trim());
    for (const name of names) {
      if (!reserved.has(name) && !varMap[name]) {
        varMap[name] = generateRandomName(varIndex);
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
        varMap[clean] = generateRandomName(varIndex);
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

  code = flattenControlFlow(code);
  return wrapWeAreDevs(code, stringTable);
}

// ─── WRAPPER ─────────────────────────────────────────────────────────────

function wrapWeAreDevs(code, strings) {
  const stringTable = strings.length > 0 ? strings.join(",") : '""';
  const offset = Math.floor(Math.random() * 100000) + 900000;
  const offsetExpr = `+(${offset}-${offset - 1})`;
  const header = `--[[ v1.0.0 https://blackmamerstudio.netlify.app ]]`;
  
  const decoder = `
local function E(E)return r[E${offsetExpr}]end
for E,M in ipairs({{-512178+512179,782660-782189},{251061+-251060,-928189+928559};{415663+-415292,-222803+223274}})do
while M[-517810+517811]<M[298629+-298627]do r[M[198780+-198779]],r[M[-622346+622348]],M[-131884+131885],M[-226190-(-226192)]=r[M[-38528-(-38530)]],r[M[806755-806754]],M[447643+-447642]+(777417+-777416),M[939661-939659]-(906318+-906317)end end
do local E=string.sub local M=table.insert local V=string.len local L=table.concat local R=type local J=r local x=math.floor local l=string.char
local I={}
for x=1,#J do local h=J[x]if R(h)=="string"then
local R=V(h)local Q={}local v=1 local A=0 local m=0
while v<=R do local r=E(h,v,v)local V=I[r]if V then A=A+V*(32)^(3-m)m=m+1
if m==4 then m=0 local r=x(A/256)local E=x((A%256)/16)local V=A%16
M(Q,l(r,E,V))A=0 end elseif r=="="then M(Q,l(x(A/256)))if v>=R or E(h,v+1,v+1)~="="then M(Q,l(x((A%256)/16)))end break end v=v+1 end J[x]=L(Q)end end end`;

  const oneLineCode = code.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  const loader = `return(function(...)local r={${stringTable}};${decoder}return(function($,_,__,___,____,_____,______,_______) ${oneLineCode} end)(getfenv and getfenv()or _ENV,unpack or table[${Math.floor(Math.random() * 1000) + 100}],newproxy,setmetadatagetmetatable,select,{...})end)(...)`;

  return header + loader;
}

app.listen(PORT, () => console.log(`✅ BlackMamer Obfuscator API running on port ${PORT}`));
