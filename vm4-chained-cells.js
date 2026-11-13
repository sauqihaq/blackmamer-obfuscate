'use strict';

// Standalone Maximum V4: per-prototype sequential instruction-cell feedback.
// This deliberately makes row N depend on the PREVIOUS decoded row, so a
// stateless bytecode reader cannot decode each PC independently. It is not
// secret-key cryptography: the loader contains all parameters and can still
// be reverse engineered by anyone who controls its execution environment.
const MODULUS=10000019;
function initialState(schema,opSeed){
  return (schema.seed*97+opSeed*31+schema.bias)%MODULUS;
}
function mask(schema,pc,logical,state,coefA,coefB){
  const {mul,bias,mode}=schema;
  if(mode===0)return (state+((pc*mul)%65521)*bias+logical*coefA)%MODULUS;
  if(mode===1)return ((state*logical)%MODULUS+
    ((pc+logical)*bias)%65521+pc*coefB)%MODULUS;
  if(mode===2)return (state+(((pc+logical)*mul)%65521)*coefB+
    bias*17)%MODULUS;
  return (((state*(logical+1))%MODULUS)+pc*bias+
    ((pc*logical)%251)*coefA)%MODULUS;
}
function advance(schema,pc,row,state,coefA,coefB){
  return (state+(row[0]%65521)*schema.mul+
    (row[1]%65521)*schema.bias+(row[2]%65521)*coefA+
    (row[3]%65521)*coefB+pc*17+schema.seed)%MODULUS;
}
function states(rows,schema,opSeed,coefA,coefB){
  let state=initialState(schema,opSeed);
  return rows.map((row,index)=>{
    const previous=state;
    state=advance(schema,index+1,row,state,coefA,coefB);
    return previous;
  });
}
module.exports={MODULUS,initialState,mask,advance,states};
