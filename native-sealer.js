'use strict';
// Optional native build-time sealing accelerator. Output is identical to the
// JavaScript fallback. This cannot hide keys from the resulting Luau runtime.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const defaultBinary = path.join(__dirname, 'native', 'bm-sealer');
const binaryPath = () => process.env.BLACKMAMER_NATIVE_SEALER || defaultBinary;
const available = () => {
  try { fs.accessSync(binaryPath(), fs.constants.X_OK); return true; }
  catch { return false; }
};
function sealBatch(chunks, sbox, fallback) {
  if (!Array.isArray(chunks) || chunks.length > 8192 ||
      !Array.isArray(sbox) || sbox.length !== 256 ||
      typeof fallback !== 'function') throw new TypeError('Invalid sealing inputs');
  if (!available()) {
    if (process.env.BLACKMAMER_REQUIRE_NATIVE === '1')
      throw new Error('BLACKMAMER native sealer is required but not executable');
    return {sealed: chunks.map(([seed, bytes]) => fallback(bytes, seed)), nativeUsed: false};
  }
  const count = chunks.length;
  let length = 9 + 256;
  for (const [seed, bytes] of chunks) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 65535 ||
        !Array.isArray(bytes) || bytes.length > 16 * 1024 * 1024)
      throw new RangeError('Invalid native sealing chunk');
    length += 6 + bytes.length;
  }
  if (length > 64 * 1024 * 1024) throw new RangeError('Native sealing request too large');
  const input = Buffer.allocUnsafe(length);
  input.write('BMVP', 0, 'ascii'); input.writeUInt8(1, 4);
  input.writeUInt32LE(count, 5);
  for (let i = 0; i < 256; i++) input[9 + i] = sbox[i];
  let offset = 265;
  for (const [seed, bytes] of chunks) {
    input.writeUInt16LE(seed, offset);offset+=2;
    input.writeUInt32LE(bytes.length, offset);offset+=4;
    for (let i = 0; i < bytes.length; i++) input[offset+i] = bytes[i];
    offset += bytes.length;
  }
  const result = spawnSync(binaryPath(), [], {
    input, timeout: 20000, maxBuffer: 72 * 1024 * 1024, windowsHide: true
  });
  if (result.error || result.status !== 0) throw new Error(
    'Native sealer failed: ' + (result.error?.message || String(result.stderr || result.status).slice(0,120)));
  const out = result.stdout;
  if (out.length < 9 || out.toString('ascii',0,4) !== 'BMVO' ||
      out[4] !== 1 || out.readUInt32LE(5) !== count)
    throw new Error('Native sealer response header mismatch');
  offset = 9;
  const sealed = [];
  for (let i = 0; i < count; i++) {
    if (offset + 4 > out.length) throw new Error('Truncated native sealer response');
    const n = out.readUInt32LE(offset);offset+=4;
    if (n !== chunks[i][1].length || offset + n > out.length)
      throw new Error('Invalid native sealer output length');
    sealed.push(Array.from(out.subarray(offset,offset+n)));
    offset += n;
  }
  if (offset !== out.length) throw new Error('Trailing native sealer data');
  return {sealed, nativeUsed: true};
}
module.exports = {sealBatch, available};
