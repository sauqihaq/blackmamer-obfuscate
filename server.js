const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────
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

// ─── PROMETHEUS OBFUSCATOR ────────────────────────────────────────────────

function obfuscateWithPrometheus(code, preset) {
  // Buat temporary file
  const tempDir = os.tmpdir();
  const inputFile = path.join(tempDir, `input_${Date.now()}.lua`);
  const outputFile = path.join(tempDir, `output_${Date.now()}.lua`);
  
  try {
    // Tulis kode ke file
    fs.writeFileSync(inputFile, code, "utf8");
    
    // Jalankan Prometheus via npx
    // Preset yang tersedia: Minify, Weak, Medium, Strong [citation:1][citation:7]
    const cmd = `npx prometheus-cli "${inputFile}" --preset ${preset} --out "${outputFile}" --LuaU`;
    
    // Eksekusi
    execSync(cmd, { stdio: "pipe", timeout: 60000 });
    
    // Baca hasil
    const result = fs.readFileSync(outputFile, "utf8");
    return result;
    
  } finally {
    // Cleanup
    try { fs.unlinkSync(inputFile); } catch(e) {}
    try { fs.unlinkSync(outputFile); } catch(e) {}
  }
}

// ─── START SERVER ──────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`✅ BlackMamer Obfuscator API running on port ${PORT}`));
