const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// ─── ROUTES ──────────────────────────────────────────────────────────────

app.get("/api", (req, res) => {
    res.json({ status: "ok", service: "BlackMamerStudio Lua Obfuscator", version: "1.0.0" });
});

app.post("/api/obfuscate", (req, res) => {
    const { script } = req.body;
    if (!script) return res.status(400).json({ error: "No script" });

    const tempDir = path.join(__dirname, "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const tempFile = path.join(tempDir, `script_${Date.now()}.lua`);
    fs.writeFileSync(tempFile, script);

    // Jalankan Prometheus (Lua)
    const prometheusPath = path.join(__dirname, "prometheus", "prometheus-main.lua");
    const cmd = `lua ${prometheusPath} -file ${tempFile} -obfuscate`;

    exec(cmd, (error, stdout, stderr) => {
        try { fs.unlinkSync(tempFile); } catch(e) {}

        if (error) {
            console.error("Prometheus error:", stderr);
            return res.status(500).json({ error: "Prometheus failed: " + stderr });
        }

        res.json({ success: true, obfuscated: stdout });
    });
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`✅ Obfuscator running on port ${PORT}`));
