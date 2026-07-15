const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// Path ke cli.lua hasil git clone di Dockerfile (RUN git clone ... /app/prometheus)
const PROMETHEUS_CLI = '/app/prometheus/cli.lua';

const BANNER = `--[[
    ██████╗ ██╗      █████╗  ██████╗██╗  ██╗███╗   ███╗ █████╗ ███╗   ███╗███████╗██████╗     ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗ 
    ██╔══██╗██║     ██╔══██╗██╔════╝██║ ██╔╝████╗ ████║██╔══██╗████╗ ████║██╔════╝██╔══██╗    ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
    ██████╔╝██║     ███████║██║     █████╔╝ ██╔████╔██║███████║██╔████╔██║█████╗  ██████╔╝    ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
    ██╔══██╗██║     ██╔══██║██║     ██╔═██╗ ██║╚██╔╝██║██╔══██║██║╚██╔╝██║██╔══╝  ██╔══██╗    ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
    ██████╔╝███████╗██║  ██║╚██████╗██║  ██╗██║ ╚═╝ ██║██║  ██║██║ ╚═╝ ██║███████╗██║  ██║    ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
    ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝    ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ 
                                                                ═══ OBFUSCATED & SECURED BY BLACKMAMER STUDIO ═══
                                                                   🔗 https://blackmamerstudioobfuscated.netlify.app/
                                                                        🛡️ "Code Strong, Stay Protected"
--]]

`;

app.use(cors()); // izinkan request dari domain lain (misal frontend Netlify)
app.use(express.json({ limit: '2mb' }));

// Health check - biar Render tau service masih hidup
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'blackmamer-obfuscator' });
});

app.post('/api/obfuscate', (req, res) => {
  const code = req.body && req.body.script;
  const preset = (req.body && req.body.preset) || 'Medium'; // Weak | Medium | Strong

  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return res.status(400).json({ error: 'Field "script" (string) wajib diisi di body JSON.' });
  }

  const id = crypto.randomBytes(8).toString('hex');
  const inputPath = path.join(os.tmpdir(), `script_${id}.lua`);
  const outputPath = path.join(os.tmpdir(), `script_${id}.out.lua`);

  fs.writeFile(inputPath, code, (writeErr) => {
    if (writeErr) {
      console.error('Gagal menulis temp file:', writeErr);
      return res.status(500).json({ error: 'Gagal menyiapkan file sementara.' });
    }

    execFile(
      'lua',
      [PROMETHEUS_CLI, '--preset', preset, inputPath, '--out', outputPath, '--nocolors'],
      { timeout: 30000 },
      (execErr, stdout, stderr) => {
        // Bersihin temp file input, ga peduli sukses atau gagal
        fs.unlink(inputPath, () => {});

        if (execErr) {
          console.error('Prometheus error:', stderr || execErr.message);
          return res.status(500).json({
            error: 'Obfuscation gagal.',
            detail: (stderr || execErr.message || '').toString().slice(0, 500),
          });
        }

        fs.readFile(outputPath, 'utf8', (readErr, obfuscated) => {
          fs.unlink(outputPath, () => {}); // bersihin temp file output

          if (readErr) {
            console.error('Gagal membaca hasil obfuscate:', readErr);
            return res.status(500).json({ error: 'Gagal membaca hasil obfuscate.' });
          }

          res.json({ obfuscated: BANNER + obfuscated });
        });
      }
    );
  });
});

app.listen(PORT, () => {
  console.log(`✅ Obfuscator running on port ${PORT}`);
});
