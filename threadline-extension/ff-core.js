/* Fork Beta domain contract. No webpage or send operations. */
const ThreadLineFFCore=(()=>{
"use strict";
const MAX_BYTES=24000, RULE="canonicalization-v1";
const STATES=["pending","done","failed","unknown"];
const PHASES=["created","draft_ready","awaiting_send","generating","capturing"];
const encoder=new TextEncoder();
const canonical=s=>s.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n");
const compare=s=>canonical(s).replace(/\u00a0/g," ").trim();
const byteLength=s=>encoder.encode(s).byteLength;
function assert(cond,msg){if(!cond)throw new Error(msg);}
function string(s,label){assert(typeof s==="string",label+" must be a string");return s;}
function id(s){assert(typeof s==="string"&&/^[a-zA-Z0-9_-]{6,100}$/.test(s),"invalid ID");return s;}
async function hash(s){const b=await crypto.subtle.digest("SHA-256",encoder.encode(s));return Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,"0")).join("");}
async function fingerprints(s){string(s,"text");return {raw:await hash(s),frozen:await hash(canonical(s)),compare:await hash(compare(s)),rule:RULE};}
function formatText(w,p){return "【共同材料 W₀】\n"+w+"\n\n【任务指令 P】\n"+p;}
async function freeze(w,p){
 string(w,"W0");string(p,"P");
 const text=formatText(w,p), bytes=byteLength(text);
 assert(bytes>0&&bytes<=MAX_BYTES,"frozen input exceeds 24000 UTF-8 bytes");
 const parts=await Promise.all([fingerprints(w),fingerprints(p),fingerprints(text)]);
 return {w0:w,p,text,bytes,rule:RULE,w0Hashes:parts[0],pHashes:parts[1],textHashes:parts[2],frozenAt:Date.now()};
}
async function verifyFrozen(f){
 assert(f&&f.rule===RULE&&typeof f.text==="string","invalid frozen record");
 assert(f.text===formatText(f.w0,f.p),"frozen text changed");
 assert(byteLength(f.text)===f.bytes&&f.bytes<=MAX_BYTES,"frozen byte count changed");
 const found=await Promise.all([fingerprints(f.w0),fingerprints(f.p),fingerprints(f.text)]);
 for(const [want,got] of [[f.w0Hashes,found[0]],[f.pHashes,found[1]],[f.textHashes,found[2]]])
   for(const key of ["raw","frozen","compare","rule"])assert(want?.[key]===got[key],"frozen hash mismatch");
 return true;
}
async function classify(expected,observed,{trusted=false,complete=false}={}){
 string(expected,"expected");
 if(!trusted||!complete||typeof observed!=="string")return {level:"unverified",rule:RULE};
 const a=await fingerprints(expected),b=await fingerprints(observed);
 return {level:expected===observed?"exact":a.frozen===b.frozen||a.compare===b.compare?"canonical_equivalent":"differs",rule:RULE,expected:a,observed:b};
}
function newExperiment(frozen,experimentId){
 id(experimentId);
 assert(frozen&&frozen.rule===RULE,"missing frozen input");
 const make=label=>({id:experimentId+"_"+label,label,status:"pending",phase:"created",revision:0,attempts:[],history:[]});
 return {id:experimentId,revision:0,frozen,createdAt:Date.now(),branches:{A:make("A"),B:make("B")},decision:null};
}
function advance(exp,{branch,expectedRevision,operationId,attemptId,status,phase,evidence={},reason=""}){
 assert(exp&&["A","B"].includes(branch),"invalid branch");
 id(operationId);id(attemptId);
 const b=exp.branches[branch];
 assert(Number.isSafeInteger(expectedRevision)&&expectedRevision===exp.revision,"stale revision");
 assert(STATES.includes(status)&&PHASES.includes(phase),"invalid state");
 assert(!b.history.some(x=>x.operationId===operationId),"duplicate operation");
 assert(b.status==="pending"||status===b.status&&status!=="done","terminal state cannot be replaced");
 assert(status==="pending"||status==="unknown"||status==="failed"||status==="done","invalid transition");
 const current=b.attempts.find(x=>x.id===attemptId);
 assert(!current||current.status==="pending","terminal attempt immutable");
 if(status==="done"){
   assert(evidence.inputLevel==="exact"||evidence.inputLevel==="canonical_equivalent","input unverified");
   assert(evidence.sessionId&&typeof evidence.sessionId==="string","missing session identity");
   assert(evidence.taskCount===1&&evidence.captureComplete===true&&typeof evidence.reply==="string","response incomplete");
   assert(Array.isArray(evidence.endSignals)&&new Set(evidence.endSignals).size>=2,"insufficient completion signals");
   assert(evidence.persisted===true,"response not persisted");
 }
 const now=Date.now(),record={operationId,attemptId,status,phase,reason:String(reason).slice(0,400),at:now};
 const next=structuredClone(exp),target=next.branches[branch];
 if(!current)target.attempts.push({id:attemptId,status,phase,createdAt:now,updatedAt:now,evidence});
 else Object.assign(target.attempts.find(x=>x.id===attemptId),{status,phase,updatedAt:now,evidence});
 target.status=status;target.phase=phase;target.revision++;target.history.push(record);next.revision++;
 return next;
}
return {MAX_BYTES,RULE,STATES,PHASES,canonical,compare,byteLength,hash,fingerprints,formatText,freeze,verifyFrozen,classify,newExperiment,advance};
})();
if(typeof globalThis!=="undefined")globalThis.ThreadLineFFCore=ThreadLineFFCore;
if(typeof module!=="undefined")module.exports=ThreadLineFFCore;
