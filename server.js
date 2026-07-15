const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "BlackMamer Lua Obfuscator API" });
});

app.post("/obfuscate", (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== "string") return res.status(400).json({ error: "No code provided." });
  if (code.length > 300000) return res.status(400).json({ error: "Code too large (max ~300KB)." });

  try {
    const result = obfuscate(code);
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: "Obfuscation failed: " + e.message });
  }
});

// ─── CORE OBFUSCATOR ────────────────────────────────────────────────────────

const LUA_KEYWORDS = new Set([
  "and","break","do","else","elseif","end","false","for","function","goto",
  "if","in","local","nil","not","or","repeat","return","then","true","until","while",
]);

const ROBLOX_GLOBALS = new Set([
  "game","workspace","script","math","table","string","os","io","coroutine","bit32",
  "utf8","task","wait","tick","time","pairs","ipairs","next","select","unpack",
  "rawget","rawset","rawequal","rawlen","setmetatable","getmetatable","pcall","xpcall",
  "error","assert","type","tostring","tonumber","print","warn","require","load","loadstring",
  "Instance","Vector3","CFrame","Color3","UDim","UDim2","Rect","Ray","Enum","TweenInfo",
  "NumberSequence","ColorSequence","NumberRange","PhysicalProperties","Random","DateTime",
  "self","_G","_VERSION","shared",
  "RunService","Players","ReplicatedStorage","ServerStorage","ServerScriptService",
  "StarterGui","StarterPack","StarterPlayer","CollectionService","TweenService",
  "DataStoreService","HttpService","MessagingService","Debris","SoundService",
  "TextService","MarketplaceService","TeleportService","VirtualInputManager",
  "ContextActionService","UserInputService","GuiService","PolicyService",
  "PathfindingService","PhysicsService","MemoryStoreService","GroupService",
  "BadgeService","InsertService","AssetService","RbxAnalyticsService",
]);

function obfuscate(src) {
  // 1. Strip comments
  let code = src
    .replace(/--\[\[[\s\S]*?--\]\]/g, "")
    .replace(/--[^\n]*/g, "");

  // 2. Encode string literals
  code = encodeStrings(code);

  // 3. Rename locals
  code = renameLocals(code);

  // 4. Number literals → expressions
  code = obfuscateNumbers(code);

  // 5. Minify whitespace
  code = minify(code);

  // 6. Wrap in bytecode loader
  return wrapLoader(code);
}

function encodeStrings(code) {
  // Ganti "string" dan 'string' dengan char-array loader
  return code.replace(/(["'])((?:[^\1\\]|\\[\s\S])*?)\1/g, (match, q, content) => {
    // Unescape content dulu
    let raw;
    try {
      // Simple unescape
      raw = content
        .replace(/\\n/g, "\n").replace(/\\t/g, "\t")
        .replace(/\\r/g, "\r").replace(/\\\\/g, "\\")
        .replace(/\\"/g, '"').replace(/\\'/g, "'");
    } catch { return match; }
    if (raw.length === 0) return match;
    if (raw.length > 200) return match; // skip strings panjang banget

    const bytes = [];
    for (let i = 0; i < raw.length; i++) bytes.push(raw.charCodeAt(i));
    const seed = Math.floor(Math.random() * 200) + 10;
    const xored = bytes.map(b => b ^ seed);
    return `(function()local _s=""local _k=${seed}local _t={${xored.join(",")}}for _i=1,#_t do _s=_s..string.char(_t[_i]~_k)end;return _s end)()`;
  });
}

function renameLocals(code) {
  const map = {};
  let idx = 0;

  const genName = () => {
    // Generate nama yg susah dibaca: kombinasi l, I, 1
    const chars = ["l","I","1","O","0"];
    let n = "_";
    let i = idx++;
    do {
      n += chars[i % chars.length];
      i = Math.floor(i / chars.length);
    } while (i > 0);
    return n;
  };

  // Temuin semua local variable names
  const localRegex = /\blocal\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)/g;
  let m;
  while ((m = localRegex.exec(code)) !== null) {
    const names = m[1].split(",").map(s => s.trim());
    for (const name of names) {
      if (!LUA_KEYWORDS.has(name) && !ROBLOX_GLOBALS.has(name) && !map[name]) {
        map[name] = genName();
      }
    }
  }

  // Juga rename function parameters
  const funcRegex = /function\s*(?:[a-zA-Z_.:\[\]"']*)\s*\(([^)]*)\)/g;
  while ((m = funcRegex.exec(code)) !== null) {
    const params = m[1].split(",").map(s => s.trim()).filter(Boolean);
    for (const p of params) {
      const clean = p.replace(/^\.\.\./, "").trim();
      if (clean && !LUA_KEYWORDS.has(clean) && !ROBLOX_GLOBALS.has(clean) && !map[clean]) {
        map[clean] = genName();
      }
    }
  }

  // Replace semua occurrences
  let result = code;
  for (const [orig, obf] of Object.entries(map)) {
    result = result.replace(new RegExp(`\\b${orig}\\b`, "g"), obf);
  }
  return result;
}

function obfuscateNumbers(code) {
  return code.replace(/\b(\d+)\b/g, (match, num) => {
    const n = parseInt(num);
    if (isNaN(n) || n < 2 || n > 9999) return match;
    const a = Math.floor(Math.random() * (n - 1)) + 1;
    const b = n - a;
    return `(${a}+${b})`;
  });
}

function minify(code) {
  return code
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
}

function wrapLoader(code) {
  const bytes = [];
  for (let i = 0; i < code.length; i++) bytes.push(code.charCodeAt(i));
  const key = Math.floor(Math.random() * 100) + 50;
  const enc = bytes.map(b => b ^ key);

  const loader =
    `local _k=${key}\n` +
    `local _d={${enc.join(",")}}\n` +
    `local _s=""\n` +
    `for _i=1,#_d do _s=_s..string.char(_d[_i]~_k) end\n` +
    `loadstring(_s)()\n`;  // ← PERBAIKAN: loadstring untuk Roblox

  return header + loader;
}

  return header + loader;
}

// ────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`BlackMamer Obfuscator API on :${PORT}`));
