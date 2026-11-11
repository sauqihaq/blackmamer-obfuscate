'use strict';
// Cryptographic vault regression: no network/database required.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
process.env.LICENSE_ENFORCED='true';
process.env.DATABASE_URL='postgresql://user:password@127.0.0.1:1/test';
const masterHex=crypto.randomBytes(32).toString('hex');
process.env.BLACKMAMER_VAULT_MASTER_KEY=masterHex;
const vault=require('../runtime-key-vault');
assert.equal(vault.enabled,true);
const id=crypto.randomUUID(),owner=crypto.randomUUID(),other=crypto.randomUUID();
const keys={BMAUTO_V4:crypto.randomBytes(32).toString('hex')};
const a=vault.encrypted(id,owner,keys);
const b=vault.encrypted(id,owner,keys);
assert.notDeepEqual(a.iv,b.iv,'AES-GCM requires fresh nonces');
assert.notDeepEqual(a.cipher,b.cipher,'New nonce changes ciphertext');
const row={key_iv:a.iv,key_tag:a.tag,key_cipher:a.cipher};
assert.deepEqual(vault.decrypted(id,owner,row),keys);
// Both environment formats MUST map to the exact same 32-byte master key.
// Existing encrypted records cannot be broken when adding the BM_ prefix.
function reloadWithMaster(rawKey){
 process.env.BLACKMAMER_VAULT_MASTER_KEY=rawKey;
 delete require.cache[require.resolve('../runtime-key-vault')];
 return require('../runtime-key-vault');
}
const branded=reloadWithMaster('BM_'+masterHex);
assert.equal(branded.enabled,true,'BM_ + 64 hex must be accepted');
assert.deepEqual(branded.decrypted(id,owner,row),keys,
  'Adding the branding prefix must not break existing encrypted records');
const brandedRecord=branded.encrypted(id,owner,keys);
assert.deepEqual(vault.decrypted(id,owner,{
 key_iv:brandedRecord.iv,key_tag:brandedRecord.tag,key_cipher:brandedRecord.cipher
}),keys,'The legacy vault must decrypt records written using a prefixed master key');
assert.equal(reloadWithMaster('BM_'+masterHex.slice(0,-1)).enabled,false,
  'Prefix cannot make a 31.5-byte master key valid');
assert.equal(reloadWithMaster('BM_'+masterHex.slice(0,-1)+'Z').enabled,false,
  'Only hexadecimal key material is accepted');
assert.equal(reloadWithMaster('BM_BM_'+masterHex).enabled,false,
  'Double branding prefixes are invalid');
assert.throws(()=>vault.decrypted(id,other,row),/authenticate/i);
assert.throws(()=>vault.decrypted(crypto.randomUUID(),owner,row),/authenticate/i);
const modified={...row,key_cipher:Buffer.from(row.key_cipher)};
modified.key_cipher[0]^=1;
assert.throws(()=>vault.decrypted(id,owner,modified),/authenticate/i);
assert.throws(()=>vault.encrypted(id,owner,{BMAUTO_V4:'bad'}),/32-byte|one automatic function/i);
assert.equal(vault.isUuid(id),true);
assert.equal(vault.isUuid('not-uuid'),false);
console.log('Runtime vault cryptography: BM_ prefix compatible with legacy 32-byte AES keys, GCM nonce/auth/tamper PASS');
