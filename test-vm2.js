'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { generate } = require('./blackmamer-vm2');

const vmTests = [
  ["local a = 2 + 3\nprint(a)", "5", 1],
  ["local a = (2 + 3) * 4\nprint(a)", "20", 1],
  ["local a = -2^2\nprint(a)", "-4", 1],
  ["local a = 2^3^2\nprint(a)", "512", 1],
  ["local a = 19 % 4\nprint(a)", "3", 1],
  ["local a = 10 >= 9\nprint(a)", "true", 1],
  ["local n = 12\nlocal m = n * 3 - 5\nprint(m)", "31", 2],
  ["local a = 0\nlocal b = if a then 10 else 20\nprint(b)", "10", 2],
  ["local a = if 10 > 2 then 70 else 90\nprint(a)", "70", 1],
  ["local a = if 2 > 10 then 70 else 90\nprint(a)", "90", 1],
  ["local a = if (2+2)==4 then 15 else 9\nprint(a)", "15", 1],
  ["local s = 'local a = 99+1'\nprint(s)", "local a = 99+1", 0],
  ["-- local a = 99+1\nprint('OK')", "OK", 0],
  ["local t = {x=2}\nprint(t.x)", "2", 0],
  ["local a = 1 + 2 -- comment\nprint(a)", "3", 1],
];

function findLua() {
  for (const candidate of [process.env.LUA_EXEC, 'lua', 'texlua'].filter(Boolean)) {
    const check = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    if (!check.error) return candidate;
  }
  return null;
}

const lua = findLua();
if (!lua) throw new Error('Install Lua 5.3+ or pass LUA_EXEC to run VM tests');

function run(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmv2-'));
  try {
    const filename = path.join(dir, 'test.lua');
    fs.writeFileSync(filename, src);
    const result = spawnSync(lua, [filename], { encoding: 'utf8', timeout: 3000 });
    if (result.status !== 0) throw new Error((result.stderr || '') + (result.stdout || ''));
    return result.stdout.trim().replace(/(-?\d+)\.0(?=\s|$)/g, '$1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const [script, expected, expectedCount] of vmTests) {
  const { code, virtualizedExpressions } = generate(script);
  assert.equal(virtualizedExpressions, expectedCount, script);
  assert.equal(run(code), expected, script);
}
const a = generate('local x=5+3\nprint(x)');
const b = generate('local x=5+3\nprint(x)');
assert.notEqual(a.code, b.code, 'Each build must mutate the VM');
assert.equal(run(a.code), run(b.code));
const directive = generate('--!strict\nlocal a=2+3\nprint(a)');
assert.ok(directive.code.startsWith('--!strict\n'), 'Preserve Luau directives');
assert.equal(run(directive.code), '5');
console.log('BLACKMAMER VM2: ' + (vmTests.length + 3) + ' checks passed');
