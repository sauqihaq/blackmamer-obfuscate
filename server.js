const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transform } = require('./blackmamer-vm');

const app = express();
const execFileAsync = promisify(execFile);
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

// BLACKMAMER VM V1 is on by default; Prometheus remains the main engine.
const PRESETS = new Set(['Weak', 'Medium', 'Strong']);
const MAX_SCRIPT_BYTES = 1024 * 1024;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'blackmamer-obfuscator',
    engine: 'Prometheus',
    vm: 'BLACKMAMER VM V1',
    version: '1.1.0'
  });
});

// Each request uses its own directory to avoid collisions and cross-user data leaks.
async function runPrometheus(source, preset) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'blackmamer-'));
  const inputPath = path.join(dir, 'input.lua');
  const outputPath = path.join(dir, 'output.lua');

  try {
    await fs.promises.writeFile(inputPath, source, 'utf8');
    await execFileAsync('lua', [
      PROMETHEUS_CLI,
      '--preset', preset,
      inputPath,
      '--out', outputPath,
      '--nocolors'
    ], {
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024
    });

    const result = await fs.promises.readFile(outputPath, 'utf8');
    if (!result.trim()) throw new Error('Empty Prometheus output');
    return result;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

// Runtime diagnostic: a live Node process does not guarantee Lua/Prometheus are available.
app.get('/api/health', async (_req, res) => {
  const cli = fs.existsSync(PROMETHEUS_CLI);
  let luaAvailable = false;
  try {
    await execFileAsync('lua', ['-v'], { timeout: 3000 });
    luaAvailable = true;
  } catch (_error) {
    luaAvailable = false;
  }

  res.status(200).json({
    status: cli && luaAvailable ? 'ready' : 'runtime_not_ready',
    node: true,
    luaAvailable,
    prometheusInstalled: cli,
    dockerRequired: !cli || !luaAvailable,
    message: cli && luaAvailable
      ? 'Lua and Prometheus are present'
      : 'Render must deploy with the Docker runtime to use the bundled Lua and Prometheus'
  });
});

app.post('/api/obfuscate', async (req, res) => {
  const body = req.body || {};
  const code = body.script;
  const preset = body.preset || 'Medium';

  if (typeof code !== 'string' || code.trim().length === 0) {
    return res.status(400).json({
      error: 'Field "script" (string) wajib diisi di body JSON.'
    });
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_SCRIPT_BYTES) {
    return res.status(413).json({ error: 'Script terlalu besar. Maksimal 1 MB.' });
  }
  if (!PRESETS.has(preset)) {
    return res.status(400).json({
      error: 'Preset tidak valid. Gunakan Weak, Medium, atau Strong.'
    });
  }

  // No frontend changes needed: existing requests enable VM automatically.
  // To disable it explicitly: { "blackmamerVM": false }.
  const vmEnabled = body.blackmamerVM !== false;
  let vmResult = { code, literals: 0, protectedBytes: 0 };
  let fallback = false;

  if (vmEnabled) {
    try {
      vmResult = transform(code, {
        maxLiteralBytes: 256,
        maxTotalBytes: 4096
      });
    } catch (error) {
      fallback = true;
      console.warn('[BLACKMAMER VM] Transform failed; using original:', error.message);
    }
  }

  try {
    let obfuscated;
    try {
      obfuscated = await runPrometheus(vmResult.code, preset);
    } catch (error) {
      if (!vmEnabled || vmResult.literals === 0) throw error;
      fallback = true;
      console.warn('[BLACKMAMER VM] Prometheus rejected VM output; retrying original');
      obfuscated = await runPrometheus(code, preset);
    }

    return res.json({
      obfuscated: BANNER + obfuscated,
      engine: 'Prometheus',
      blackmamerVM: {
        enabled: vmEnabled,
        applied: vmEnabled && !fallback && vmResult.literals > 0,
        fallback,
        protectedLiterals: fallback ? 0 : vmResult.literals,
        protectedBytes: fallback ? 0 : vmResult.protectedBytes
      }
    });
  } catch (error) {
    console.error('[PROMETHEUS ERROR]', error.stderr || error.message);
    return res.status(500).json({
      error: 'Obfuscation gagal.',
      detail: String(error.stderr || error.message || '').slice(0, 500)
    });
  }
});

app.use((error, _req, res, _next) => {
  console.error('[API ERROR]', error.message);
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request terlalu besar.' });
  }
  return res.status(error.status === 400 ? 400 : 500).json({
    error: 'Request gagal diproses.'
  });
});

app.listen(PORT, () => {
  console.log('BLACKMAMER STUDIO Obfuscator: Prometheus + VM on port ' + PORT);
});
