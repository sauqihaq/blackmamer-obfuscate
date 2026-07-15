const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/", (req, res) => {
    res.json({ status: "ok", service: "Lua Obfuscator API" });
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
        console.error("Error:", e.message);
        res.status(500).json({ error: "Obfuscation failed: " + e.message });
    }
});

// ─── OBFUSCATOR ─────────────────────────────────────────────────────────

function obfuscate(src) {
    let code = src;
    
    // 1. Extract & encode strings
    const strings = [];
    let stringIdx = 0;
    
    code = code.replace(/(["'])((?:[^\1\\]|\\[\s\S])*?)\1/g, (match, quote, content) => {
        let raw = content;
        try {
            raw = content
                .replace(/\\n/g, "\n").replace(/\\t/g, "\t")
                .replace(/\\r/g, "\r").replace(/\\\\/g, "\\")
                .replace(/\\"/g, '"').replace(/\\'/g, "'");
        } catch {}
        
        if (raw.length === 0 || raw.length > 500) return match;
        
        const encoded = raw.split('').map(c => {
            return `\\${String(c.charCodeAt(0)).padStart(3, '0')}`;
        }).join('');
        
        strings.push(`"${encoded}"`);
        const placeholder = `__STR_${stringIdx}__`;
        stringIdx++;
        return placeholder;
    });
    
    // 2. Rename variables
    const varMap = {};
    let varIdx = 0;
    const reserved = new Set([
        "and","break","do","else","elseif","end","false","for","function",
        "goto","if","in","local","nil","not","or","repeat","return",
        "then","true","until","while"
    ]);
    
    const foundVars = new Set();
    const varRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let match;
    while ((match = varRegex.exec(code)) !== null) {
        const name = match[1];
        if (!reserved.has(name) && !foundVars.has(name)) {
            foundVars.add(name);
        }
    }
    
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const name of foundVars) {
        let newName;
        do {
            newName = letters[varIdx % letters.length];
            varIdx++;
            if (varIdx >= letters.length) {
                newName += Math.floor(varIdx / letters.length);
            }
        } while (reserved.has(newName) || varMap[newName]);
        varMap[name] = newName;
    }
    
    for (const [orig, obf] of Object.entries(varMap)) {
        code = code.replace(new RegExp(`\\b${orig}\\b`, 'g'), obf);
    }
    
    // 3. Replace string placeholders
    for (let i = 0; i < stringIdx; i++) {
        code = code.replace(new RegExp(`__STR_${i}__`, 'g'), `r[${i + 1}]`);
    }
    
    // 4. Clean up
    code = code.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    
    // 5. Wrap
    return wrapWeAreDevs(code, strings);
}

function wrapWeAreDevs(code, strings) {
    const stringTable = strings.length > 0 ? strings.join(",") : '""';
    const offset = Math.floor(Math.random() * 100000) + 900000;
    const header = '--[[ v1.0.0 https://wearedevs.net/obfuscator ]]';
    
    return header + `return(function(...)local r={${stringTable}};
local function E(E)return r[E+(${offset}-${offset-1})]end
for E,M in ipairs({{-512178+512179,782660-782189},{251061+-251060,-928189+928559};{415663+-415292,-222803+223274}})do
while M[-517810+517811]<M[298629+-298627]do r[M[198780+-198779]],r[M[-622346+622348]],M[-131884+131885],M[-226190-(-226192)]=r[M[-38528-(-38530)]],r[M[806755-806754]],M[447643+-447642]+(777417+-777416),M[939661-939659]-(906318+-906317)end end
do local E=string.sub local M=table.insert local V=string.len local L=table.concat local R=type local J=r local x=math.floor local l=string.char
local I={}
for x=1,#J do local h=J[x]if R(h)=="string"then
local R=V(h)local Q={}local v=1 local A=0 local m=0
while v<=R do local r=E(h,v,v)local V=I[r]if V then A=A+V*(32)^(3-m)m=m+1
if m==4 then m=0 local r=x(A/256)local E=x((A%256)/16)local V=A%16
M(Q,l(r,E,V))A=0 end elseif r=="="then M(Q,l(x(A/256)))if v>=R or E(h,v+1,v+1)~="="then M(Q,l(x((A%256)/16)))end break end v=v+1 end J[x]=L(Q)end end end
return(function($,_,__,___,____,_____,______,_______) ${code} end)(getfenv and getfenv()or _ENV,unpack or table[${Math.floor(Math.random() * 1000) + 100}],newproxy,setmetadatagetmetatable,select,{...})end)(...)`;
}

app.listen(PORT, () => console.log(`✅ Obfuscator running on port ${PORT}`));
