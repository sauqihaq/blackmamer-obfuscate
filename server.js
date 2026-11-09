const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transform } = require('./blackmamer-vm');
const { generate: compileBlackmamerVM2 } = require('./blackmamer-vm2');

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
    vm: 'BLACKMAMER VM V1 + experimental V2',
    version: '1.2.0'
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

  // Existing requests keep V1 for compatibility.
  // Explicit opt-in to experimental V2:
  // { "vmMode": "hybrid-v2", "blackmamerVM": true }.
  const vmEnabled = body.blackmamerVM !== false;
  const vmMode = body.vmMode === 'hybrid-v2' ? 'hybrid-v2' : 'v1';
  let vm2Result = { code, virtualizedExpressions: 0, vmInstructions: 0 };
  let vmResult = { code, literals: 0, protectedBytes: 0 };
  let fallback = false;

  if (vmEnabled) {
    if (vmMode === 'hybrid-v2') {
      try {
        vm2Result = compileBlackmamerVM2(code, { maxExpressions: 32 });
      } catch (error) {
        fallback = true;
        console.warn('[BLACKMAMER VM2] Compile failed, retaining source:', error.message);
      }
    }
    try {
      vmResult = transform(vm2Result.code, {
        maxLiteralBytes: 256,
        maxTotalBytes: 4096
      });
    } catch (error) {
      fallback = true;
      vmResult = { code: vm2Result.code, literals: 0, protectedBytes: 0 };
      console.warn('[BLACKMAMER VM1] String pass failed:', error.message);
    }
  }

  try {
    let obfuscated;
    try {
      obfuscated = await runPrometheus(vmResult.code, preset);
    } catch (error) {
      if (!vmEnabled || (vmResult.literals === 0 && vm2Result.virtualizedExpressions === 0)) throw error;
      fallback = true;
      console.warn('[BLACKMAMER VM] Prometheus rejected VM output; retrying original');
      obfuscated = await runPrometheus(code, preset);
    }

    return res.json({
      obfuscated: BANNER + obfuscated,
      engine: 'Prometheus',
      blackmamerVM: {
        enabled: vmEnabled,
        applied: vmEnabled && !fallback && (vmResult.literals > 0 || vm2Result.virtualizedExpressions > 0),
        mode: vmMode,
        virtualizedExpressions: fallback ? 0 : vm2Result.virtualizedExpressions,
        vmInstructions: fallback ? 0 : vm2Result.vmInstructions,
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
