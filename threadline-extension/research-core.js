/* Pure S2--S4 research protocol. It preserves user decisions; it never
 * determines whether an adopted conclusion is true or false. */
(() => {
  "use strict";
  const MAX_EDGES=1000, MAX_CONFIRMATIONS=5000, MAX_EVENTS=5000, MAX_REVIEWS=5000;
  const copy=x=>structuredClone(x);
  const valid=(x,p)=>typeof x==="string"&&new RegExp("^"+p+"[a-z0-9_-]{8,128}$").test(x);
  const base=()=>({schema:1,edges:[],confirmations:[],events:[],reviews:[]});
  const cur=(s,id)=>s.conclusions?.[id]&&s.versions?.[s.conclusions[id].currentVersionId];
  const owns=(s,p,id)=>s.conclusions?.[id]?.projectId===p;
  const options=o=>({id:o?.id||(()=>"dep_"+Math.random().toString(36).slice(2,14)),at:Number.isSafeInteger(o?.at)?o.at:Date.now()});
  function normal(r) {
    if(!r||r.schema!==1||![r.edges,r.confirmations,r.events,r.reviews].every(Array.isArray)||
      r.edges.length>MAX_EDGES||r.confirmations.length>MAX_CONFIRMATIONS||r.events.length>MAX_EVENTS||r.reviews.length>MAX_REVIEWS) throw Error("依赖记录格式或上限无效");
    return copy(r);
  }
  function graph(edges) {
    const map=new Map();
    for(const edge of edges.filter(x=>x.active)){if(!map.has(edge.upstreamConclusionId))map.set(edge.upstreamConclusionId,[]);map.get(edge.upstreamConclusionId).push(edge);}
    for(const items of map.values())items.sort((a,b)=>a.id.localeCompare(b.id));
    return map;
  }
  function reaches(edges,from,target) {
    const map=graph(edges),queue=[from],seen=new Set();
    while(queue.length){const id=queue.shift();if(id===target)return true;if(seen.has(id))continue;seen.add(id);queue.push(...(map.get(id)||[]).map(x=>x.downstreamConclusionId));}
    return false;
  }
  function currentPair(s,p,cmd) {
    if(!cmd||!valid(cmd.upstreamConclusionId,"con_")||!valid(cmd.downstreamConclusionId,"con_"))throw Error("依赖结论 ID 无效");
    if(cmd.upstreamConclusionId===cmd.downstreamConclusionId)throw Error("依赖不能指向自身");
    if(!owns(s,p,cmd.upstreamConclusionId)||!owns(s,p,cmd.downstreamConclusionId))throw Error("依赖必须属于同一课题");
    const up=cur(s,cmd.upstreamConclusionId),down=cur(s,cmd.downstreamConclusionId);
    if(!up||!down)throw Error("结论当前版本缺失");
    if(s.conclusions[cmd.upstreamConclusionId].status==="withdrawn"||s.conclusions[cmd.downstreamConclusionId].status==="withdrawn")throw Error("撤回结论不能登记依赖");
    if(cmd.upstreamVersionId!==up.id||cmd.downstreamVersionId!==down.id)throw Error("结论版本已变化，请刷新后确认");
    return {up,down};
  }
  function scope(cmd) {
    if(typeof cmd.scopeManifestHash!=="string"||!cmd.scopeManifestHash||typeof cmd.reason!=="string"||!cmd.reason.trim())throw Error("确认必须记录范围哈希和理由");
  }
  function appendEvent(r,body,o) {
    if(r.events.length>=MAX_EVENTS)throw Error("依赖事件超过上限");
    r.events.push({id:o.id(),at:o.at,...body});
  }
  function appendConfirmation(r,edge,cmd,o) {
    if(r.confirmations.length>=MAX_CONFIRMATIONS)throw Error("依赖确认超过上限");
    scope(cmd);
    const confirmation={id:o.id(),edgeId:edge.id,edgeRevision:edge.revision,acknowledgedUpstreamVersion:cmd.upstreamVersionId,confirmedForDownstreamVersion:cmd.downstreamVersionId,scopeManifestHash:cmd.scopeManifestHash,reason:cmd.reason,at:o.at};
    r.confirmations.push(confirmation);
    appendEvent(r,{kind:"confirmed",edgeId:edge.id,edgeRevision:edge.revision,confirmationId:confirmation.id,upstreamVersionId:confirmation.acknowledgedUpstreamVersion,downstreamVersionId:confirmation.confirmedForDownstreamVersion,reason:confirmation.reason},o);
    return confirmation;
  }
  function update(s,p,cmd,raw={}) {
    const o=options(raw),r=normal(s.projects?.[p]?.research||base());
    if(!cmd||typeof cmd.kind!=="string")throw Error("依赖命令无效");
    if(cmd.kind==="addDependency") {
      currentPair(s,p,cmd);scope(cmd);
      let edge=r.edges.find(e=>e.upstreamConclusionId===cmd.upstreamConclusionId&&e.downstreamConclusionId===cmd.downstreamConclusionId);
      if(reaches(r.edges.filter(e=>e!==edge),cmd.downstreamConclusionId,cmd.upstreamConclusionId))throw Error("依赖不能形成环");
      if(edge){if(edge.active)throw Error("依赖已登记");edge.active=true;edge.revision++;}
      else {if(r.edges.length>=MAX_EDGES)throw Error("依赖边超过上限");edge={id:o.id(),projectId:p,upstreamConclusionId:cmd.upstreamConclusionId,downstreamConclusionId:cmd.downstreamConclusionId,type:"necessary",revision:1,active:true};r.edges.push(edge);}
      appendEvent(r,{kind:edge.revision===1?"added":"reactivated",edgeId:edge.id,edgeRevision:edge.revision,upstreamVersionId:cmd.upstreamVersionId,downstreamVersionId:cmd.downstreamVersionId,reason:cmd.reason},o);
      const confirmation=appendConfirmation(r,edge,cmd,o);
      return {research:r,result:{edgeId:edge.id,revision:edge.revision,confirmationId:confirmation.id}};
    }
    const edge=r.edges.find(e=>e.id===cmd.edgeId);
    if(!edge||edge.projectId!==p)throw Error("依赖边不存在");
    if(cmd.kind==="removeDependency") {
      if(!edge.active)throw Error("依赖已移除");
      if(typeof cmd.reason!=="string"||!cmd.reason.trim())throw Error("移除依赖必须说明理由");
      edge.active=false;edge.revision++;
      appendEvent(r,{kind:"removed",edgeId:edge.id,edgeRevision:edge.revision,reason:cmd.reason},o);
      return {research:r,result:{edgeId:edge.id,removed:true}};
    }
    if(cmd.kind==="confirmDependency") {
      currentPair(s,p,{...cmd,upstreamConclusionId:edge.upstreamConclusionId,downstreamConclusionId:edge.downstreamConclusionId});
      if(!edge.active)throw Error("已移除的依赖不能确认");
      const confirmation=appendConfirmation(r,edge,cmd,o);
      return {research:r,result:{edgeId:edge.id,confirmationId:confirmation.id}};
    }
    throw Error("未知依赖命令");
  }
  function latestConfirmation(r,edge) {return r.confirmations.filter(c=>c.edgeId===edge.id&&c.edgeRevision===edge.revision).at(-1)||null;}
  function inspect(s,p) {
    const r=normal(s.projects?.[p]?.research||base());
    const edges=r.edges.map(edge=>{
      const up=cur(s,edge.upstreamConclusionId),down=cur(s,edge.downstreamConclusionId),confirmation=latestConfirmation(r,edge);
      let status="removed",reason="已移除";
      if(edge.active&&!up){status="pending";reason="上游当前版本缺失";}
      else if(edge.active&&!down){status="pending";reason="下游当前版本缺失";}
      else if(edge.active&&s.conclusions[edge.upstreamConclusionId]?.status==="withdrawn"){status="pending";reason="上游已撤回";}
      else if(edge.active&&s.conclusions[edge.downstreamConclusionId]?.status==="withdrawn"){status="pending";reason="下游已撤回";}
      else if(edge.active&&!confirmation){status="pending";reason="尚未确认";}
      else if(edge.active&&confirmation.acknowledgedUpstreamVersion!==up.id){status="pending";reason="上游版本已变化";}
      else if(edge.active&&confirmation.confirmedForDownstreamVersion!==down.id){status="pending";reason="下游版本已变化";}
      else if(edge.active){status="confirmed";reason="已对照当前版本确认";}
      return {...copy(edge),upstreamVersionId:up?.id||null,downstreamVersionId:down?.id||null,status,reason,confirmation};
    });
    const neighbors=Object.fromEntries(Object.keys(s.conclusions||{}).filter(id=>owns(s,p,id)).map(id=>[id,{upstream:edges.filter(e=>e.active&&e.downstreamConclusionId===id).map(e=>e.upstreamConclusionId),downstream:edges.filter(e=>e.active&&e.upstreamConclusionId===id).map(e=>e.downstreamConclusionId)}]));
    return {research:r,edges,neighbors};
  }
  function impacts(s,p,changedIds) {
    const r=normal(s.projects?.[p]?.research||base()),next=graph(r.edges),queue=[...new Set(changedIds||[])].filter(id=>owns(s,p,id)).sort().map(id=>({id,root:id,path:[id],edgeIds:[]})),visited=new Set(),out=new Map();
    while(queue.length) {
      const item=queue.shift(),seenKey=item.root+"|"+item.id;
      if(visited.has(seenKey))continue;visited.add(seenKey);
      for(const edge of next.get(item.id)||[]) {
        const target=edge.downstreamConclusionId,cause={rootConclusionId:item.root,path:[...item.path,target],edgeIds:[...item.edgeIds,edge.id]},row=out.get(target)||{conclusionId:target,versionId:cur(s,target)?.id||null,causes:[]};
        if(!row.causes.some(x=>x.rootConclusionId===cause.rootConclusionId&&x.path.join("/")===cause.path.join("/")))row.causes.push(cause);
        out.set(target,row);
        if(!item.path.includes(target))queue.push({id:target,root:item.root,path:cause.path,edgeIds:cause.edgeIds});
      }
    }
    return [...out.values()].map(row=>({...row,causes:row.causes.sort((a,b)=>a.path.join("/").localeCompare(b.path.join("/")))})).sort((a,b)=>a.conclusionId.localeCompare(b.conclusionId));
  }
  function recordChange(s,p,cmd,raw={}) {
    if(!cmd||!valid(cmd.triggerEventId,"evt_")||!owns(s,p,cmd.conclusionId))throw Error("变更事件无效");
    const r=normal(s.projects?.[p]?.research||base()),o=options(raw);
    if(r.events.some(e=>e.kind==="change"&&e.triggerEventId===cmd.triggerEventId))return {research:r,result:{triggerEventId:cmd.triggerEventId,replay:true}};
    const conclusion=s.conclusions[cmd.conclusionId],from=s.versions?.[cmd.fromVersion],to=s.versions?.[cmd.toVersion];
    if(!from||!to||from.conclusionId!==conclusion.id||to.conclusionId!==conclusion.id||conclusion.currentVersionId!==to.id||!["amend","withdraw"].includes(cmd.kind))throw Error("变更版本或类型无效");
    const state={...s,projects:{...s.projects,[p]:{...s.projects[p],research:r}}},affected=impacts(state,p,[cmd.conclusionId]);
    appendEvent(r,{kind:"change",triggerEventId:cmd.triggerEventId,conclusionId:cmd.conclusionId,fromVersion:from.id,toVersion:to.id,changeKind:cmd.kind,affected:affected.map(x=>({conclusionId:x.conclusionId,versionId:x.versionId,causes:x.causes}))},o);
    return {research:r,result:{triggerEventId:cmd.triggerEventId,affected}};
  }
  function prepareReview(s,p,cmd,raw={}) {
    const r=normal(s.projects?.[p]?.research||base()),o=options(raw);
    if(r.reviews.length>=MAX_REVIEWS||!valid(cmd?.targetConclusionId,"con_")||!owns(s,p,cmd.targetConclusionId)||!valid(cmd.targetVersionId,"ver_")||cur(s,cmd.targetConclusionId)?.id!==cmd.targetVersionId||typeof cmd.scopeManifestHash!=="string"||!cmd.scopeManifestHash||!Array.isArray(cmd.sourceSnapshots)||!Array.isArray(cmd.blindMaterials))throw Error("复核准备数据无效");
    const state={...s,projects:{...s.projects,[p]:{...s.projects[p],research:r}}},incoming=inspect(state,p).edges.filter(e=>e.active&&e.downstreamConclusionId===cmd.targetConclusionId).map(e=>({edgeId:e.id,edgeRevision:e.revision,upstreamVersionId:e.upstreamVersionId,downstreamVersionId:e.downstreamVersionId}));
    const review={id:o.id(),status:"prepared",projectId:p,targetConclusionId:cmd.targetConclusionId,targetVersionId:cmd.targetVersionId,scopeManifestHash:cmd.scopeManifestHash,sourceSnapshots:copy(cmd.sourceSnapshots),blindMaterials:copy(cmd.blindMaterials),incoming,at:o.at};
    r.reviews.push(review);return {research:r,result:{reviewId:review.id,review}};
  }
  function completeReview(s,p,cmd,raw={}) {
    const r=normal(s.projects?.[p]?.research||base()),o=options(raw),review=r.reviews.find(x=>x.id===cmd?.reviewId);
    if(!review||review.projectId!==p||review.status!=="prepared"||!["keep","revise","withdraw","inconclusive"].includes(cmd.outcome)||typeof cmd.reason!=="string"||!cmd.reason.trim())throw Error("复核完成数据无效");
    const stale=cur(s,review.targetConclusionId)?.id!==review.targetVersionId;
    review.status="completed";review.outcome=cmd.outcome;review.reason=cmd.reason;review.completedAt=o.at;review.stale=stale;
    const edgesToConfirm=stale||cmd.outcome!=="keep"?[]:review.incoming.filter(pair=>pair.upstreamVersionId===cur(s,s.versions[pair.upstreamVersionId]?.conclusionId)?.id&&pair.downstreamVersionId===review.targetVersionId);
    appendEvent(r,{kind:"reviewCompleted",reviewId:review.id,outcome:cmd.outcome,reason:cmd.reason,stale,edgesToConfirm:edgesToConfirm.map(x=>x.edgeId)},o);
    return {research:r,result:{reviewId:review.id,stale,edgesToConfirm}};
  }
  function validateResearch(input,s,p) {
    const r=normal(input),all=[...r.edges,...r.confirmations,...r.events,...r.reviews].map(x=>x.id);
    if(new Set(all).size!==all.length||!all.every(id=>valid(id,"dep_")))throw Error("研究记录 ID 无效或重复");
    for(const edge of r.edges)if(edge.projectId!==p||edge.type!=="necessary"||!Number.isSafeInteger(edge.revision)||edge.revision<1||typeof edge.active!=="boolean"||!owns(s,p,edge.upstreamConclusionId)||!owns(s,p,edge.downstreamConclusionId)||edge.upstreamConclusionId===edge.downstreamConclusionId)throw Error("依赖边无效");
    for(const edge of r.edges.filter(x=>x.active))if(reaches(r.edges.filter(x=>x.active&&x.id!==edge.id),edge.downstreamConclusionId,edge.upstreamConclusionId))throw Error("依赖存在环");
    for(const c of r.confirmations){const e=r.edges.find(x=>x.id===c.edgeId),up=s.versions?.[c.acknowledgedUpstreamVersion],down=s.versions?.[c.confirmedForDownstreamVersion];if(!e||!Number.isSafeInteger(c.edgeRevision)||c.edgeRevision<1||!up||!down||up.conclusionId!==e.upstreamConclusionId||down.conclusionId!==e.downstreamConclusionId||typeof c.scopeManifestHash!=="string"||!c.scopeManifestHash||typeof c.reason!=="string"||!c.reason.trim()||!Number.isSafeInteger(c.at))throw Error("依赖确认无效");}
    for(const event of r.events)if(!Number.isSafeInteger(event.at)||typeof event.kind!=="string")throw Error("依赖事件无效");
    return true;
  }
  const Research={base,update,inspect,impacts,recordChange,prepareReview,completeReview,validateResearch,MAX_EDGES,MAX_CONFIRMATIONS,MAX_EVENTS,MAX_REVIEWS};
  if(typeof module!=="undefined"&&module.exports)module.exports=Research;else globalThis.ThreadLineResearchCore=Research;
})();
