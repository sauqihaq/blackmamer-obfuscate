const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// ─── ROUTES ──────────────────────────────────────────────────────────────

app.post("/api/obfuscate", (req, res) => {
    const { script } = req.body;
    if (!script || typeof script !== "string") {
        return res.status(400).json({ error: "No script provided." });
    }
    if (script.length > 500000) {
        return res.status(400).json({ error: "Script too large." });
    }

    // Panggil wrapper Prometheus (prometheus.go)
    const prometheus = spawn("./prometheus-wrapper", [], {
        stdio: ["pipe", "pipe", "pipe"]
    });

    let output = "";
    let errorOutput = "";

    prometheus.stdout.on("data", (data) => {
        output += data.toString();
    });

    prometheus.stderr.on("data", (data) => {
        errorOutput += data.toString();
    });

    prometheus.stdin.write(script);
    prometheus.stdin.end();

    prometheus.on("close", (code) => {
        if (code !== 0) {
            console.error("Prometheus error:", errorOutput);
            return res.status(500).json({ 
                error: "Obfuscation failed: " + errorOutput 
            });
        }

        res.json({
            success: true,
            obfuscated: output,
            originalSize: script.length,
            obfuscatedSize: output.length
        });
    });

    prometheus.on("error", (err) => {
        console.error("Failed to start prometheus:", err);
        res.status(500).json({ error: "Internal server error." });
    });
});

app.listen(PORT, () => {
    console.log(`✅ Obfuscator running on port ${PORT}`);
});
