'use strict';
// No third-party modules: validate frontend JS and simulate basic user interactions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.resolve(__dirname, '../netlify-frontend/index.html');
const html = fs.readFileSync(file, 'utf8');
assert.match(html, /BLACKMAMER STUDIO/);
assert.match(html, /Prometheus \(Elias Oelschner\)/);
assert.match(html, /id="preset"/);
assert.match(html, /value="RobloxStrong"/);
assert.match(html, /id="hybrid"/);
assert.match(html, /id="result"/);
const match = html.match(/<script>\s*([\s\S]*?)<\/script>/);
assert.ok(match, 'Missing embedded frontend script');
const compiled = new vm.Script(match[1], { filename: file });
const elements = new Map();
function byId(id) {
  if (!elements.has(id)) {
    const handlers = {};
    elements.set(id, {
      id, handlers, textContent:'', value:'', checked:false, disabled:false,
      hidden:false, style:{}, className:'', focus(){}, select(){},
      addEventListener(event, handler) { handlers[event] = handler; },
      click() { return handlers.click && handlers.click(); }
    });
  }
  return elements.get(id);
}
byId('preset').value = 'Medium';
byId('target').value = 'LuaU';
let calls = [];
const fetchMock = async (url, options) => {
  calls.push({ url, options });
  return url.includes('/api/health') ?
    { ok:true, json:async () => ({status:'ready'}) } :
    { ok:true, json:async () => ({
      obfuscated:'-- test output\nreturn true',
      engine:'Prometheus',
      blackmamerVM:{ enabled:true, applied:true, virtualizedExpressions:1, fallback:false }
    }) };
};
const sandbox = {
  document:{
    getElementById:byId,
    createElement:() => ({click(){},remove(){}}),
    body:{appendChild(){}}
  },
  navigator:{clipboard:{writeText:async()=>{}}},
  URL:{createObjectURL:()=>'',revokeObjectURL(){}},
  Blob, performance, setTimeout, clearTimeout, AbortController,
  fetch:fetchMock, console
};
compiled.runInContext(vm.createContext(sandbox));
(async () => {
  byId('source').value = 'local x=20*5\nprint(x)';
  await byId('obfuscate').click();
  let send = calls.find(item => item.url.endsWith('/api/obfuscate'));
  assert.ok(send, 'POST was not sent');
  assert.equal(send.options.method, 'POST');
  assert.equal(JSON.parse(send.options.body).preset, 'Medium');
  assert.equal(JSON.parse(send.options.body).vmMode, 'v1');
  assert.equal(JSON.parse(send.options.body).target, 'LuaU');
  assert.equal(byId('result').value, '-- test output\nreturn true');
  assert.equal(byId('download').disabled, false);

  byId('preset').value = 'RobloxStrong';
  byId('hybrid').checked = true;
  calls = [];
  await byId('obfuscate').click();
  send = calls.find(item => item.url.endsWith('/api/obfuscate'));
  const payload = JSON.parse(send.options.body);
  assert.equal(payload.preset, 'RobloxStrong');
  assert.equal(payload.vmMode, 'hybrid-v2');
  assert.equal(payload.blackmamerVM, true);

  byId('preset').value = 'NativeV3';
  byId('preset').handlers.change();
  byId('antiTamper').checked = true;
  byId('antiDebug').checked = true;
  calls = [];
  await byId('obfuscate').click();
  send = calls.find(item => item.url.endsWith('/api/obfuscate'));
  const v3 = JSON.parse(send.options.body);
  assert.equal(v3.preset, 'NativeV3');
  assert.equal(v3.vmMode, 'native-v3');
  assert.equal(v3.target, 'LuaU');
  assert.equal(v3.antiTamper, true);
  assert.equal(v3.antiDebug, true);
  assert.equal(byId('hybrid').disabled, true);

  byId('source').value = '';
  calls = [];
  await byId('obfuscate').click();
  assert.equal(calls.filter(item => item.url.endsWith('/api/obfuscate')).length, 0);
  console.log('Frontend smoke: 16 assertions passed (syntax, UI bindings, payload, output, validation)');
})().catch(err=>{ console.error(err); process.exitCode=1; });
