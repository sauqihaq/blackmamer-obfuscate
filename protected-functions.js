'use strict';
// BLACKMAMER EXTERNAL FUNCTION PROTECTION (experimental).
// A HMAC-SHA256 based stream encryption and encrypt-then-MAC construction.
// Keys must be supplied separately at runtime; NEVER embed them into Luau.
// Cryptographic implementation is testable against Node's crypto module.
// Warning: a client that receives a key can still inspect the decrypted code.
const crypto=require('node:crypto');
const PREFIX_STREAM=Buffer.from('BM-EF-STREAM\0','utf8');
const PREFIX_TAG=Buffer.from('BM-EF-TAG\0','utf8');
function requireKey(value) {
  if(typeof value!=='string' || !/^[a-fA-F0-9]{64}$/.test(value))
    throw new TypeError('Function key must be 64 hexadecimal characters (32 bytes)');
  return Buffer.from(value,'hex');
}
function requireId(id) {
  if(typeof id!=='string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id))
    throw new TypeError('Protected function id must use 1-64 letters/digits/underscore/dash, starting with a letter');
  return id;
}
function streamCrypt(bytes,key,nonce) {
  const output=Buffer.alloc(bytes.length);
  for(let offset=0,counter=0;offset<bytes.length;offset+=32,counter++){
    const counterBytes=Buffer.allocUnsafe(4);counterBytes.writeUInt32BE(counter);
    const stream=crypto.createHmac('sha256',key)
      .update(PREFIX_STREAM).update(nonce).update(counterBytes).digest();
    for(let j=0;j<32&&offset+j<bytes.length;j++)
      output[offset+j]=bytes[offset+j]^stream[j];
  }
  return output;
}
function tagFor(cipher,key,id,nonce) {
  return crypto.createHmac('sha256',key).update(PREFIX_TAG)
    .update(Buffer.from(id,'utf8')).update(Buffer.from([0]))
    .update(nonce).update(cipher).digest();
}
function encryptBytes(plain,keyHex,id) {
  requireId(id);
  const key=requireKey(keyHex);
  const nonce=crypto.randomBytes(12);
  const cipher=streamCrypt(Buffer.from(plain),key,nonce);
  const tag=tagFor(cipher,key,id,nonce);
  return {bytes:Array.from(cipher),nonce:nonce.toString('hex'),tag:tag.toString('hex')};
}
function decryptBytes(cipher,keyHex,id,nonceHex,tagHex) {
  const key=requireKey(keyHex);requireId(id);
  if(!/^[a-f0-9]{24}$/i.test(nonceHex)||!/^[a-f0-9]{64}$/i.test(tagHex))
    throw new Error('Invalid protected function metadata');
  const nonce=Buffer.from(nonceHex,'hex');
  const bytes=Buffer.from(cipher);
  const expected=tagFor(bytes,key,id,nonce);
  if(!crypto.timingSafeEqual(expected,Buffer.from(tagHex,'hex')))
    throw new Error('External function key invalid or ciphertext modified');
  return streamCrypt(bytes,key,nonce);
}
const LUA_SHA256_K=[
  '428a2f98','71374491','b5c0fbcf','e9b5dba5','3956c25b','59f111f1','923f82a4','ab1c5ed5',
  'd807aa98','12835b01','243185be','550c7dc3','72be5d74','80deb1fe','9bdc06a7','c19bf174',
  'e49b69c1','efbe4786','0fc19dc6','240ca1cc','2de92c6f','4a7484aa','5cb0a9dc','76f988da',
  '983e5152','a831c66d','b00327c8','bf597fc7','c6e00bf3','d5a79147','06ca6351','14292967',
  '27b70a85','2e1b2138','4d2c6dfc','53380d13','650a7354','766a0abb','81c2c92e','92722c85',
  'a2bfe8a1','a81a664b','c24b8b70','c76c51a3','d192e819','d6990624','f40e3585','106aa070',
  '19a4c116','1e376c08','2748774c','34b0bcb5','391c0cb3','4ed8aa4a','5b9cca4f','682e6ff3',
  '748f82ee','78a5636f','84c87814','8cc70208','90befffa','a4506ceb','bef9a3f7','c67178f2'
];
function runtimeLines(){
  // Emitted inside the Luau VM chunk, after nativeByte/nativeConcat etc exist.
  // HMAC-SHA256 is implemented in Luau rather than assuming a non-existent
  // general-purpose Roblox crypto primitive.
  return [
    '  local efK={'+LUA_SHA256_K.map(x=>'0x'+x).join(',')+'}',
    '  local efMod=4294967296;local efRor=bit32.rrotate;local efRsh=bit32.rshift',
    '  local efBand=bit32.band;local efBor=bit32.bor;local efNot=bit32.bnot',
    '  local efXor=bit32.bxor',
    '  local function efU32(n)',
    '    return nativeChar(efRsh(n,24)%256,efRsh(n,16)%256,efRsh(n,8)%256,n%256) end',
    '  local function efHex(s,count)',
    '    if nativeType(s)~="string" or #s~=count*2 or not string.match(s,"^[0-9a-fA-F]+$") then',
    '      nativeError("BLACKMAMER external key has invalid hex length")end',
    '    local a={};for i=1,#s,2 do a[#a+1]=nativeChar(tonumber(string.sub(s,i,i+1),16))end',
    '    return nativeConcat(a)',
    '  end',
    '  local function efSha256(message)',
    '    local bitLength=#message*8',
    '    local msg=message..nativeChar(128)',
    '    msg=msg..string.rep(nativeChar(0),(56-#msg%64)%64)',
    '    msg=msg..efU32(math.floor(bitLength/efMod))..efU32(bitLength%efMod)',
    '    local state={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,',
    '      0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19}',
    '    for pos=1,#msg,64 do',
    '      local w={}',
    '      for i=0,15 do',
    '        local at=pos+i*4;local b1,b2,b3,b4=nativeByte(msg,at,at+3)',
    '        w[i]=b1*16777216+b2*65536+b3*256+b4',
    '      end',
    '      for i=16,63 do',
    '        local p=w[i-15];local q=w[i-2]',
    '        local s0=efXor(efRor(p,7),efRor(p,18),efRsh(p,3))',
    '        local s1=efXor(efRor(q,17),efRor(q,19),efRsh(q,10))',
    '        w[i]=(w[i-16]+s0+w[i-7]+s1)%efMod',
    '      end',
    '      local a,b,c,d,e,f,g,h=table.unpack(state)',
    '      for i=0,63 do',
    '        local big1=efXor(efRor(e,6),efRor(e,11),efRor(e,25))',
    '        local choose=efXor(efBand(e,f),efBand(efNot(e),g))',
    '        local t1=(h+big1+choose+efK[i+1]+w[i])%efMod',
    '        local big0=efXor(efRor(a,2),efRor(a,13),efRor(a,22))',
    '        local major=efXor(efBand(a,b),efBand(a,c),efBand(b,c))',
    '        local t2=(big0+major)%efMod',
    '        h=g;g=f;f=e;e=(d+t1)%efMod',
    '        d=c;c=b;b=a;a=(t1+t2)%efMod',
    '      end',
    '      state[1]=(state[1]+a)%efMod;state[2]=(state[2]+b)%efMod',
    '      state[3]=(state[3]+c)%efMod;state[4]=(state[4]+d)%efMod',
    '      state[5]=(state[5]+e)%efMod;state[6]=(state[6]+f)%efMod',
    '      state[7]=(state[7]+g)%efMod;state[8]=(state[8]+h)%efMod',
    '    end',
    '    local result={};for i=1,8 do result[i]=efU32(state[i]) end',
    '    return nativeConcat(result)',
    '  end',
    '  local function efHmac(key,payload)',
    '    local ipad={};local opad={}',
    '    for i=1,64 do',
    '      local b=i<=#key and nativeByte(key,i) or 0',
    '      ipad[i]=nativeChar(efXor(b,54));opad[i]=nativeChar(efXor(b,92))',
    '    end',
    '    return efSha256(nativeConcat(opad)..efSha256(nativeConcat(ipad)..payload))',
    '  end',
    '  local function efDecrypt(cipher,keyHex,id,nonceHex,tagHex)',
    '    local key=efHex(keyHex,32);local nonce=efHex(nonceHex,12)',
    '    local tag=efHex(tagHex,32)',
    '    local expected=efHmac(key,"BM-EF-TAG"..nativeChar(0)..id..nativeChar(0)..nonce..cipher)',
    '    local different=0',
    '    for i=1,32 do different=efBor(different,efXor(nativeByte(tag,i),nativeByte(expected,i)))end',
    '    if different~=0 then nativeError("BLACKMAMER external function key invalid or ciphertext changed")end',
    '    local chunks={};local index=0',
    '    for pos=1,#cipher,32 do',
    '      local block=efHmac(key,"BM-EF-STREAM"..nativeChar(0)..nonce..efU32(index))',
    '      index=index+1',
    '      local chars={};for i=0,math.min(31,#cipher-pos) do',
    '        chars[#chars+1]=nativeChar(efXor(nativeByte(cipher,pos+i),nativeByte(block,i+1)))end',
    '      chunks[#chunks+1]=nativeConcat(chars)',
    '    end',
    '    return nativeConcat(chunks)',
    '  end'
  ];
}
module.exports={requireKey,requireId,encryptBytes,decryptBytes,runtimeLines};
