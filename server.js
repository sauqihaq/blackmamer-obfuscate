const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transform } = require('./blackmamer-vm');
const { generate: compileBlackmamerVM2 } = require('./blackmamer-vm2');
const { compile: compileBlackmamerVM3 } = require('./blackmamer-vm3');
const { available: nativeSealerAvailable } = require('./native-sealer');
const { registerRoutes: registerCommercialRoutes, gate: licenseGate } = require('./commercial-access');

const app = express();
const execFileAsync = promisify(execFile);
const PORT = process.env.PORT || 10000;

// Path ke cli.lua hasil git clone di Dockerfile (RUN git clone ... /app/prometheus)
const PROMETHEUS_CLI = process.env.PROMETHEUS_CLI || path.join(__dirname, 'prometheus', 'cli.lua');
const ROBLOX_STRONG_CONFIG = path.join(__dirname, 'roblox-strong.lua');

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
const PRESETS = new Set(['Weak', 'Medium', 'Strong', 'RobloxStrong', 'NativeV3', 'NativeV4']);
const MAX_SCRIPT_BYTES = 1024 * 1024;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
registerCommercialRoutes(app);

app.get('/', (_req, res) => {
  res.json({
    engineReady: fs.existsSync(PROMETHEUS_CLI),
    status: 'ok',
    service: 'blackmamer-obfuscator',
    engine: 'Prometheus',
    vm: 'BLACKMAMER VM V1 + experimental V2 + native V3 / V4',
    defaultTarget: 'LuaU',
    version: '1.4.0'
  });
});

// Each request uses its own directory to avoid collisions and cross-user data leaks.
async function runPrometheus(source, preset, target = 'LuaU') {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'blackmamer-'));
  const inputPath = path.join(dir, 'input.lua');
  const outputPath = path.join(dir, 'output.lua');

  try {
    await fs.promises.writeFile(inputPath, source, 'utf8');
    const configArg = preset === 'RobloxStrong'
      ? ['--config', ROBLOX_STRONG_CONFIG]
      : ['--preset', preset];
    await execFileAsync('lua', [
      PROMETHEUS_CLI,
      ...configArg,
      inputPath,
      '--out', outputPath,
      '--nocolors',
      target === 'LuaU' ? '--LuaU' : '--Lua51'
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
    vm2Available: typeof compileBlackmamerVM2 === 'function',
    vm3Available: typeof compileBlackmamerVM3 === 'function',
    vm4Available: typeof compileBlackmamerVM3 === 'function',
    nativeSealerAvailable: nativeSealerAvailable(),
    defaultTarget: 'LuaU',
    message: cli && luaAvailable
      ? 'Lua and Prometheus are present'
      : 'Render must deploy with the Docker runtime to use the bundled Lua and Prometheus'
  });
});

app.post('/api/obfuscate', licenseGate, async (req, res) => {
  const body = req.body || {};
  const code = body.script;
  const preset = body.preset || 'Medium';
  // Luau target is the Roblox-compatible default, not Lua 5.1.
  const target = body.target === undefined ? 'LuaU' : body.target;

  if (typeof code !== 'string' || code.trim().length === 0) {
    return res.status(400).json({
      error: 'Field "script" (string) wajib diisi di body JSON.'
    });
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_SCRIPT_BYTES) {
    return res.status(413).json({ error: 'Script terlalu besar. Maksimal 1 MB.' });
  }
  if (!['LuaU', 'Lua51'].includes(target)) {
    return res.status(400).json({ error: 'Target wajib LuaU atau Lua51.' });
  }
  if (!PRESETS.has(preset)) {
    return res.status(400).json({
      error: 'Preset tidak valid. Gunakan Weak, Medium, Strong, RobloxStrong, NativeV3, atau NativeV4.'
    });
  }

  // V3 is a separate independent compiler and interpreter. It never falls back
  // to Prometheus: unsupported Luau must return a clear validation error.
  const useNativeV4 = preset === 'NativeV4' || body.vmMode === 'native-v4';
  if (preset === 'NativeV3' || body.vmMode === 'native-v3' || useNativeV4) {
    if (target !== 'LuaU') {
      return res.status(400).json({ error: 'Native V3/V4 saat ini hanya mendukung target Luau.' });
    }
    if (body.blackmamerVM === false) {
      return res.status(400).json({ error: 'Native V3/V4 membutuhkan blackmamerVM: true.' });
    }
    try {
      const result = compileBlackmamerVM3(code, {
        antiTamper: body.antiTamper !== false,
        antiDebug: body.antiDebug !== false,
        superInstructions: body.superInstructions !== false,
        hardened: useNativeV4,
        nestedVM: useNativeV4 && body.nestedVM !== false,
        autoFunctionEncryption: useNativeV4 ? (body.autoFunctionEncryption || 'off') : 'off',
        functionKeys: body.functionKeys
      });
      return res.json({
        // Keep the VM payload compact, but restore the original large
        // BLACKMAMER STUDIO ASCII-art header for both NativeV3 and NativeV4.
        obfuscated: BANNER + result.code,
        engine: result.engine,
        target: 'LuaU',
        // Generated keys are returned once with this response. The VM output
        // intentionally contains only function ids, nonces and MACs.
        externalKeys: result.generatedKeys,
        protectedFunctionIds: result.protectedFunctions,
        protection: { antiTamper: result.antiTamper, antiDebug: result.antiDebug },
        blackmamerVM: {
          enabled: true,
          applied: true,
          mode: useNativeV4 ? 'native-v4' : 'native-v3',
          nativeSealer: result.nativeSealer,
          hardened: result.hardened,
          nestedVM: result.nestedVM,
          outerVmInstructions: result.outerVmInstructions,
          runtimeBootstrap: result.runtimeBootstrap,
          opaquePredicates: result.opaquePredicates,
          periodicRuntimeGuard: result.periodicRuntimeGuard,
          protectedFunctions: result.protectedFunctions.length,
          autoFunctionEncryption: result.autoFunctionEncryption,
          autoEncryptedFunctions: result.autoEncryptedFunctions,
          externallyKeyedFunctions: result.externallyKeyedFunctions,
          virtualizedFunctions: result.virtualizedFunctions,
          bytecodeLayout: result.bytecodeLayout,
          bytecodeWidths: result.bytecodeWidths,
          vmInstructions: result.vmInstructions,
          perFunctionOpcodePalette: result.perFunctionOpcodePalette,
          perInstructionOperandRotation: result.perInstructionOperandRotation,
          opcodePaletteSize: result.opcodePaletteSize,
          fusedInstructions: result.fusedInstructions,
          superInstructionKinds: result.superInstructionKinds,
          fallback: false,
          protectedLiterals: 0,
          protectedBytes: 0
        }
      });
    } catch (error) {
      const unsupported = error.code === 'V3_UNSUPPORTED_SYNTAX';
      const match = /(?:at(?: offset)?\\s+)(\\d+)/i.exec(String(error.message));
      const offset = Number.isInteger(error.offset)
        ? error.offset : (match ? Number(match[1]) : null);
      let position = null;
      if (Number.isInteger(offset) && offset >= 0 && offset <= code.length) {
        const before = code.slice(0, offset);
        const line = before.split('\\n').length;
        const column = offset - before.lastIndexOf('\\n');
        position = { line, column, offset };
      }
      const message = unsupported
        ? (useNativeV4 ? 'V4' : 'V3') + ' belum mendukung sintaks Luau'
          + (position ? ' di baris ' + position.line + ', kolom ' + position.column : '')
          + ': ' + String(error.message).slice(0, 220)
        : 'BLACKMAMER Native V3/V4 gagal memproses script.';
      return res.status(unsupported ? 422 : 500).json({
        error: message,
        code: error.code || 'V3_COMPILE_ERROR',
        position,
        detail: String(error.message).slice(0, 400)
      });
    }
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
    // RobloxStrong already encrypts strings inside Prometheus. Feeding V1's
    // nested string-decoder closures through another full VM can destabilize
    // some randomized builds, so keep that pass out of this preset.
    if (preset === 'RobloxStrong') {
      vmResult = { code: vm2Result.code, literals: 0, protectedBytes: 0 };
    } else {
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
  }

  try {
    let obfuscated;
    try {
      obfuscated = await runPrometheus(vmResult.code, preset, target);
    } catch (error) {
      if (!vmEnabled || (vmResult.literals === 0 && vm2Result.virtualizedExpressions === 0)) throw error;
      fallback = true;
      console.warn('[BLACKMAMER VM] Prometheus rejected VM output; retrying original');
      obfuscated = await runPrometheus(code, preset, target);
    }

    return res.json({
      obfuscated: BANNER + obfuscated,
      engine: 'Prometheus',
      target,
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
