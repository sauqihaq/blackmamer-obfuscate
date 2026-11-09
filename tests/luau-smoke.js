'use strict';
// Compatibility smoke test: compare original script against VM+Prometheus output
// running in a Luau CLI. This is NOT a Roblox Studio integration test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { generate } = require('../blackmamer-vm2');
const { transform } = require('../blackmamer-vm');

const LUA = process.env.LUA_BIN || 'lua';
const LUAU = process.env.LUAU_BIN || 'luau';
const PROMETHEUS = process.env.PROMETHEUS_CLI || '/app/prometheus/cli.lua';
const TIMEOUT = 40000;

function cmd(binary, args, label) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: TIMEOUT,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      label + ' failed: ' + (result.error?.message || result.stderr || result.stdout)
    );
  }
  return result.stdout.replace(/\r\n/g, '\n').trim();
}

const cases = [
  { label: 'hello', code: 'print("Hello World")', preset: 'Medium' },
  { label: 'arithmetic', code: 'local x=20*5\nprint(x)', preset: 'Strong' },
  { label: 'closure', code: 'local function add(x,y) return x+y end\nprint(add(2,3))', preset: 'Medium' },
  { label: 'branch', code: 'local x=if 9>4 then 10 else 20\nprint(x)', preset: 'Strong' },
  { label: 'table', code: 'local t={a=7}\nprint(t.a+2)', preset: 'Medium' },
  {
    label: 'roblox-style-method',
    code: 'local game={GetService=function(_,name) return {Name=name} end}\nprint(game:GetService("Players").Name)',
    preset: 'Medium'
  }
];

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'blackmamer-luau-'));
let successful = 0;
try {
  for (const t of cases) {
    const inFile = path.join(scratch, t.label + '.luau');
    const vmFile = path.join(scratch, t.label + '.lua');
    const outputFile = path.join(scratch, t.label + '.obfuscated.lua');

    fs.writeFileSync(inFile, t.code, 'utf8');
    const expected = cmd(LUAU, [inFile], t.label + ' source');

    const custom = generate(t.code, { maxExpressions: 32 });
    const protectedResult = transform(custom.code, {
      maxLiteralBytes: 256, maxTotalBytes: 4096
    });
    fs.writeFileSync(vmFile, protectedResult.code, 'utf8');

    // Identify which stage alters behavior, instead of treating all VM failures
    // as a single opaque Prometheus error.
    const v2File = path.join(scratch, t.label + '.vm2.lua');
    fs.writeFileSync(v2File, custom.code, 'utf8');
    assert.equal(cmd(LUAU, [v2File], t.label + ' VM2 raw'),
      expected, t.label + ' changed in VM2 compiler');
    assert.equal(cmd(LUAU, [vmFile], t.label + ' VM1 raw'),
      expected, t.label + ' changed in VM1 string stage');

    cmd(LUA, [
      PROMETHEUS,
      '--preset', t.preset,
      '--LuaU',
      '--nocolors',
      vmFile,
      '--out', outputFile
    ], t.label + ' Prometheus');

    const result = cmd(LUAU, [outputFile], t.label + ' output');
    assert.equal(result, expected, t.label + ' changed program behavior');
    assert.ok(fs.statSync(outputFile).size > 0, 'Empty obfuscation result');
    console.log('PASS ' + t.label + ' [' + t.preset + ']');
    successful++;
  }
  console.log('BLACKMAMER Luau compatibility: ' + successful + '/' + cases.length + ' passed');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
