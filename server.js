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
    
    // 1. Hapus komentar
    code = code.replace(/--\[\[[\s\S]*?\]\]/g, '');
    code = code.replace(/--[^\n]*/g, '');
    
    // 2. Extract strings
    const strings = [];
    let stringIdx = 0;
    
    code = code.replace(/(["'])((?:[^\1\\]|\\[\s\S])*?)\1/g, (match, quote, content) => {
        const encoded = content.split('').map(c => {
            return `\\${String(c.charCodeAt(0)).padStart(3, '0')}`;
        }).join('');
        strings.push(`"${encoded}"`);
        const placeholder = `__STR_${stringIdx}__`;
        stringIdx++;
        return placeholder;
    });
    
    // 3. Obfuscate variables
    const varMap = {};
    let varIdx = 0;
    const reserved = new Set([
        "and","break","do","else","elseif","end","false","for","function",
        "goto","if","in","local","nil","not","or","repeat","return",
        "then","true","until","while"
    ]);
    
    const allVars = new Set();
    const varRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let match;
    while ((match = varRegex.exec(code)) !== null) {
        const name = match[1];
        if (!reserved.has(name)) {
            allVars.add(name);
        }
    }
    
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const name of allVars) {
        let newName;
        do {
            newName = letters[varIdx % letters.length];
            varIdx++;
        } while (reserved.has(newName) || varMap[newName]);
        varMap[name] = newName;
    }
    
    for (const [orig, obf] of Object.entries(varMap)) {
        code = code.replace(new RegExp(`\\b${orig}\\b`, 'g'), obf);
    }
    
    // 4. Replace string placeholders
    for (let i = 0; i < stringIdx; i++) {
        code = code.replace(new RegExp(`__STR_${i}__`, 'g'), `r[${i + 1}]`);
    }
    
    // 5. Clean up
    code = code.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    
    // 6. Wrap (SAMA PERSIS dengan WeAreDevs)
    return wrapWeAreDevs(code, strings);
}

// ─── WRAPPER (100% SAMA DENGAN WEAREDEVS) ────────────────────────────

function wrapWeAreDevs(code, strings) {
    const stringTable = strings.length > 0 ? strings.join(",") : '""';
    const randomTableIndex = Math.floor(Math.random() * 1000) + 100;
    
    // HEADER - SAMA PERSIS
    const header = '--[[ v1.0.0 https://wearedevs.net/obfuscator ]]';
    
    // DECODER - COPY PASTE DARI WEAREDEVS
    const decoder = `
local function E(E)return r[E+(981936-935207)]end
for E,M in ipairs({{-512178+512179,782660-782189},{251061+-251060,-928189+928559};{415663+-415292,-222803+223274}})do
while M[-517810+517811]<M[298629+-298627]do r[M[198780+-198779]],r[M[-622346+622348]],M[-131884+131885],M[-226190-(-226192)]=r[M[-38528-(-38530)]],r[M[806755-806754]],M[447643+-447642]+(777417+-777416),M[939661-939659]-(906318+-906317)end end
do local E=string.sub local M=table.insert local V=string.len local L=table.concat local R=type local J=r local x=math.floor local l=string.char
local I={m=911891+-911884,g=-765722+765760,["\\057"]=656151+-656143,t=558628+-558574,E=-349304-(-349339),["\\050"]=495225+-495196,G=272588+-272577,z=-722283-(-722314);e=952847+-952785,["\\048"]=-318026+318046,f=-191818+191819,L=267069+-267030;a=256346+-256336,T=-1008455+1008507;H=-367776-(-367837),M=-871978-(-871984),F=377849+-377808;k=-143233-(-143269),["\\049"]=-626330+626332;S=-587347-(-587406),b=971289-971249;K=342986+-342970;x=603818+-603785,J=763235+-763180,j=195700-195652,h=82096+-82039,p=736127-736100;["\\047"]=-987187-(-987191);C=307261+-307235;w=37062-37047,["\\051"]=-923854+923878;Z=855143-855101,D=458284+-458250,N=-243858+243861;["\\054"]=-530873-(-530878);["\\055"]=-759293-(-759343);["\\043"]=361025-360965,v=-143310-(-143368);l=-447562-(-447562),["\\052"]=-167371+167403,o=39801+-39754,u=726228-726210;R=776275+-776229,["\\056"]=-779801+779818,X=555204+-555179;P=934489-934444,V=134004-133992,A=587593-587537;O=339211-339197;c=-299346+299399,q=18936+-18908;I=416559-416510;U=934239-934230,d=251117-251098,s=237873+-237830;r=608906+-608883,y=-821249+821300,i=-892426-(-892463);Q=-854269+854290;n=-907174-(-907204),["\\053"]=-586618+586681;W=124778+-124734;B=689125-689112;Y=-134854+134876}
for r=1002956+-1002955,#J,-681511+681512 do local h=J[r]if R(h)=="string"then
local R=V(h)local Q={}local v=-764320-(-764321)local A=-934156-(-934156)local m=335139-335139
while v<=R do local r=E(h,v,v)local V=I[r]if V then A=A+V*(548711-548647)^((1027446+-1027443)-m)m=m+(672207+-672206)
if m==705040+-705036 then m=705959+-705959 local r=x(A/(-159578+225114))local E=x((A%(-948015-(-1013551)))/(-503648-(-503904)))local V=A%(392393+-392137)
M(Q,l(r,E,V))A=255081+-255081 end elseif r=="\\061"then M(Q,l(x(A/(488834-423298))))if v>=R or E(h,v+(-3951-(-3952)),v+(236622+-236621))~="\\061"then M(Q,l(x((A%(-360575+426111))/(-48825+49081))))end break end v=v+(280658-280657)end J[r]=L(Q)end end end`;
    
    // WRAPPER - SAMA PERSIS
    const wrapper = `
return(function($,_,__,___,____,_____,______,_______) ${code} end)(getfenv and getfenv()or _ENV,unpack or table[${randomTableIndex}],newproxy,setmetadatagetmetatable,select,{...})end)(...)`;
    
    return header + `return(function(...)local r={${stringTable}};` + decoder + wrapper;
}

app.listen(PORT, () => console.log(`✅ Obfuscator running on port ${PORT}`));
