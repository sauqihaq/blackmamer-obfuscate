const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// ─── ROUTES ──────────────────────────────────────────────────────────────

// ✅ TAMBAHKAN INI BIAR /api BISA DIAKSES
app.get("/api", (req, res) => {
    res.json({
        status: "ok",
        service: "BlackMamerStudio Lua Obfuscator (Prometheus)",
        version: "1.0.0"
    });
});

app.post("/api/obfuscate", (req, res) => {
    const { script } = req.body;
    if (!script || typeof script !== "string") {
        return res.status(400).json({ error: "No script provided." });
    }
    if (script.length > 500000) {
        return res.status(400).json({ error: "Script too large." });
    }

    // Buat folder temp
    const tempDir = path.join(__dirname, "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const tempFile = path.join(tempDir, `script_${Date.now()}.lua`);
    fs.writeFileSync(tempFile, script);

    // Cari binary Prometheus
    let prometheusPath = path.join(__dirname, "Prometheus", "prometheus");
    if (!fs.existsSync(prometheusPath)) {
        prometheusPath = path.join(__dirname, "prometheus");
    }
    
    if (!fs.existsSync(prometheusPath)) {
        return res.status(500).json({ 
            error: "Prometheus binary not found. Build failed." 
        });
    }

    // Jalankan Prometheus
    exec(`${prometheusPath} -file ${tempFile} -obfuscate`, (error, stdout, stderr) => {
        // Hapus file temp
        try { fs.unlinkSync(tempFile); } catch(e) {}

        if (error) {
            console.error("Prometheus error:", stderr || error.message);
            return res.status(500).json({ 
                error: "Prometheus failed: " + (stderr || error.message)
            });
        }

        if (!stdout || stdout.trim() === "") {
            return res.status(500).json({ 
                error: "Prometheus returned empty output."
            });
        }

        res.json({
            success: true,
            obfuscated: stdout,
            originalSize: script.length,
            obfuscatedSize: stdout.length
        });
    });
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
    console.log(`✅ BlackMamerStudio Obfuscator (Prometheus) running on port ${PORT}`);
});
