'use strict';
// Portable LZ transport for VM bytecode. Pack BEFORE encryption; never treat
// compression as encryption or as a replacement for any existing protection.
// Bitstream: mode=0 followed by raw bytes, OR mode=1 + uint32 original length
// followed by literal runs (tag 0..127, length=tag+1) and backwards matches
// (tag 128..255, length=tag-128+4, uint16 backward distance).
const hashAt=(src,p)=>
  ((((src[p]*251+src[p+1])*251+src[p+2])*251+src[p+3])>>>0)&65535;

function packVmBytes(raw,minSavings=16){
  const src=Uint8Array.from(raw);
  const size=src.length;
  if(size<96)return {bytes:[0,...src],compressed:false,plainBytes:size};
  const latest=new Int32Array(65536);latest.fill(-1);
  const data=[];
  function literals(begin,end){
    for(let at=begin;at<end;){
      const count=Math.min(128,end-at);
      data.push(count-1);
      for(let i=0;i<count;i++)data.push(src[at+i]);
      at+=count;
    }
  }
  let pos=0,start=0;
  while(pos+4<=size){
    const h=hashAt(src,pos),candidate=latest[h];latest[h]=pos;
    let found=0;
    const distance=pos-candidate;
    if(candidate>=0&&distance>0&&distance<=65535&&
       src[candidate]===src[pos]&&src[candidate+1]===src[pos+1]&&
       src[candidate+2]===src[pos+2]&&src[candidate+3]===src[pos+3]){
      const limit=Math.min(131,size-pos);found=4;
      while(found<limit&&src[candidate+found]===src[pos+found])found++;
    }
    if(found>=4){
      literals(start,pos);
      data.push(128+found-4,distance&255,distance>>>8);
      // Register consumed positions so matches can reference recent data.
      for(let k=1;k<found;k++){
        const at=pos+k;
        if(at+4<=size)latest[hashAt(src,at)]=at;
      }
      pos+=found;start=pos;
    }else pos++;
  }
  literals(start,size);
  // Refuse negative gains so random ciphertext-like buffers are never bloated.
  if(size-(data.length+5)<minSavings)
    return {bytes:[0,...src],compressed:false,plainBytes:size};
  return {bytes:[1,size&255,(size>>>8)&255,(size>>>16)&255,
    (size>>>24)&255,...data],compressed:true,plainBytes:size};
}

// JS mirror of the portable Lua decoder; test only, not used at runtime.
function unpackVmBytes(packed,maxBytes=32*1024*1024){
  const src=packed,mode=src[0];
  if(mode===0)return Array.from(src).slice(1);
  if(mode!==1||src.length<6)throw Error('Invalid VM packed format');
  const required=src[1]+src[2]*256+src[3]*65536+src[4]*16777216;
  if(required>maxBytes)throw Error('VM payload too large');
  const out=[];let at=5;
  while(at<src.length){
    const tag=src[at++];
    if(tag<128){
      const count=tag+1;
      if(at+count>src.length||out.length+count>required)
        throw Error('VM literals truncated');
      for(let j=0;j<count;j++)out.push(src[at++]);
    }else{
      const count=tag-128+4;
      if(at+2>src.length)throw Error('VM match truncated');
      const distance=src[at++]+256*src[at++];
      if(distance===0||distance>out.length||out.length+count>required)
        throw Error('VM match invalid');
      for(let j=0;j<count;j++)out.push(out[out.length-distance]);
    }
  }
  if(out.length!==required)throw Error('VM payload size mismatch');
  return out;
}
module.exports={packVmBytes,unpackVmBytes};
