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
  const jsonSize=x=>{try{return JSON.stringify(x).length;}catch{return Infinity;}};
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
  function ancestorScope(r,target) {
    const active=r.edges.filter(edge=>edge.active),incoming=new Map(),seen=new Set([target]),queue=[target];
    for(const edge of active){if(!incoming.has(edge.downstreamConclusionId))incoming.set(edge.downstreamConclusionId,[]);incoming.get(edge.downstreamConclusionId).push(edge);}
    while(queue.length){const id=queue.shift();for(const edge of incoming.get(id)||[])if(!seen.has(edge.upstreamConclusionId)){seen.add(edge.upstreamConclusionId);queue.push(edge.upstreamConclusionId);}}
    return {conclusionIds:seen,edges:active.filter(edge=>seen.has(edge.upstreamConclusionId)&&seen.has(edge.downstreamConclusionId)).sort((a,b)=>a.id.localeCompare(b.id))};
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
    const confirmation={id:o.id(),edgeId:edge.id,edgeRevision:edge.revision,acknowledgedUpstreamVersion:cmd.upstreamVersionId,confirmedForDownstreamVersion:cmd.downstreamVersionId,scopeManifestHash:cmd.scopeManifestHash,reason:cmd.reason,at:o.at,...(Object.hasOwn(cmd,"coveredChanges")?{coveredChanges:copy(cmd.coveredChanges)}:{})};
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
      if(Object.hasOwn(cmd,"coveredChanges"))validateCoveredChanges(r,cmd.coveredChanges,edge);
      const confirmation=appendConfirmation(r,edge,cmd,o);
      return {research:r,result:{edgeId:edge.id,confirmationId:confirmation.id}};
    }
    throw Error("未知依赖命令");
  }
  function carryForward(s,p,cmd,raw={}) {
    const r=normal(s.projects?.[p]?.research||base()),o=options(raw),conclusion=s.conclusions?.[cmd?.conclusionId],from=s.versions?.[cmd?.fromVersion],to=s.versions?.[cmd?.toVersion];
    if(!valid(cmd?.conclusionId,"con_")||!owns(s,p,cmd.conclusionId)||!valid(cmd?.fromVersion,"ver_")||!valid(cmd?.toVersion,"ver_")||cmd.fromVersion===cmd.toVersion||!from||!to||from.conclusionId!==cmd.conclusionId||to.conclusionId!==cmd.conclusionId||conclusion.currentVersionId!==cmd.toVersion||conclusion.status==="withdrawn"||typeof cmd.reason!=="string"||!cmd.reason.trim())throw Error("仅措辞承接数据无效");
    const candidates=r.edges.filter(edge=>edge.active&&edge.downstreamConclusionId===cmd.conclusionId).map(edge=>({edge,confirmation:latestConfirmation(r,edge)})).filter(item=>item.confirmation?.confirmedForDownstreamVersion===cmd.fromVersion);
    if(r.confirmations.length+candidates.length>MAX_CONFIRMATIONS||r.events.length+candidates.length>MAX_EVENTS)throw Error("依赖记录超过上限");
    const carried=[];
    for(const {edge,confirmation:prior} of candidates) {
      const confirmation={id:o.id(),edgeId:edge.id,edgeRevision:edge.revision,acknowledgedUpstreamVersion:prior.acknowledgedUpstreamVersion,confirmedForDownstreamVersion:cmd.toVersion,scopeManifestHash:prior.scopeManifestHash,reason:cmd.reason,at:o.at,carryForwardFrom:cmd.fromVersion,...(Object.hasOwn(prior,"coveredChanges")?{coveredChanges:copy(prior.coveredChanges)}:{})};
      r.confirmations.push(confirmation);
      appendEvent(r,{kind:"confirmed",edgeId:edge.id,edgeRevision:edge.revision,confirmationId:confirmation.id,upstreamVersionId:confirmation.acknowledgedUpstreamVersion,downstreamVersionId:confirmation.confirmedForDownstreamVersion,reason:confirmation.reason,carryForwardFrom:cmd.fromVersion},o);
      carried.push({edgeId:edge.id,confirmationId:confirmation.id});
    }
    return {research:r,result:{conclusionId:cmd.conclusionId,fromVersion:cmd.fromVersion,toVersion:cmd.toVersion,carried}};
  }
  function latestConfirmation(r,edge) {return r.confirmations.filter(c=>c.edgeId===edge.id&&c.edgeRevision===edge.revision).at(-1)||null;}
  function changeTuple(event) {return {triggerEventId:event.triggerEventId,rootConclusionId:event.conclusionId,rootVersionId:event.toVersion};}
  function sameTuple(a,b) {return a?.triggerEventId===b?.triggerEventId&&a?.rootConclusionId===b?.rootConclusionId&&a?.rootVersionId===b?.rootVersionId;}
  function changeForTuple(r,tuple) {return r.events.find(event=>event.kind==="change"&&sameTuple(changeTuple(event),tuple))||null;}
  function validateCoveredChanges(r,items,edge) {
    if(!Array.isArray(items)||items.length>MAX_EDGES)throw Error("变更覆盖范围无效");
    const seen=new Set();
    for(const item of items) {
      if(!item||!valid(item.triggerEventId,"evt_")||!valid(item.rootConclusionId,"con_")||!valid(item.rootVersionId,"ver_"))throw Error("变更覆盖范围无效");
      const key=item.triggerEventId+"|"+item.rootConclusionId+"|"+item.rootVersionId,event=changeForTuple(r,item);
      if(seen.has(key)||!event||!event.affected.some(row=>row.conclusionId===edge.downstreamConclusionId&&row.causes.some(c=>c.rootConclusionId===item.rootConclusionId&&c.contributingEdgeIds.includes(edge.id))))throw Error("变更覆盖范围无效");
      seen.add(key);
    }
  }
  function reviewCoveredChanges(r,review) {
    const items=Array.isArray(review.scopeManifest?.changeEvents)?review.scopeManifest.changeEvents:[];
    const edgeIds=new Set(review.incoming.map(x=>x.edgeId)),out=[],seen=new Set();
    for(const item of items) {
      const event=changeForTuple(r,item),key=item?.triggerEventId+"|"+item?.rootConclusionId+"|"+item?.rootVersionId;
      if(!event||seen.has(key)||!event.affected.some(row=>row.conclusionId===review.targetConclusionId&&row.causes.some(c=>c.rootConclusionId===item.rootConclusionId&&c.contributingEdgeIds.some(id=>edgeIds.has(id)))))continue;
      seen.add(key);out.push(copy(changeTuple(event)));
    }
    return out;
  }
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
    const r=normal(s.projects?.[p]?.research||base()),next=graph(r.edges),queue=[...new Set(changedIds||[])].filter(id=>owns(s,p,id)).sort().map(id=>({id,root:id,path:[id],edgeIds:[]})),seen=new Map(),out=new Map();
    while(queue.length) {
      const item=queue.shift(),seenKey=item.root+"|"+item.id, priorEdges=seen.get(seenKey)||new Set(), itemEdges=new Set(item.edgeIds);
      let changed=false;
      for(const id of itemEdges)if(!priorEdges.has(id)){priorEdges.add(id);changed=true;}
      if(!changed&&seen.has(seenKey))continue;
      seen.set(seenKey,priorEdges);
      for(const edge of next.get(item.id)||[]) {
        const target=edge.downstreamConclusionId,cause={rootConclusionId:item.root,path:[...item.path,target],edgeIds:[...item.edgeIds,edge.id]},row=out.get(target)||{conclusionId:target,versionId:cur(s,target)?.id||null,causes:[]};
        const rootCause=row.causes.find(x=>x.rootConclusionId===cause.rootConclusionId);
        if(rootCause) {
          for(const id of cause.edgeIds)if(!rootCause.contributingEdgeIds.includes(id))rootCause.contributingEdgeIds.push(id);
          if(cause.path.join("/")<rootCause.path.join("/"))rootCause.path=cause.path;
        } else row.causes.push({...cause,contributingEdgeIds:[...cause.edgeIds]});
        out.set(target,row);
        if(!item.path.includes(target))queue.push({id:target,root:item.root,path:cause.path,edgeIds:cause.edgeIds});
      }
    }
    return [...out.values()].map(row=>({...row,causes:row.causes.map(c=>({...c,contributingEdgeIds:c.contributingEdgeIds.sort()})).sort((a,b)=>a.rootConclusionId.localeCompare(b.rootConclusionId))})).sort((a,b)=>a.conclusionId.localeCompare(b.conclusionId));
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
    const hasManifest=Object.hasOwn(cmd||{},"scopeManifest"),manifestBytes=hasManifest?jsonSize(cmd.scopeManifest):0;
    if(r.reviews.length>=MAX_REVIEWS||!valid(cmd?.targetConclusionId,"con_")||!owns(s,p,cmd.targetConclusionId)||!valid(cmd.targetVersionId,"ver_")||cur(s,cmd.targetConclusionId)?.id!==cmd.targetVersionId||typeof cmd.scopeManifestHash!=="string"||!cmd.scopeManifestHash||!Array.isArray(cmd.sourceSnapshots)||!Array.isArray(cmd.blindMaterials)||hasManifest&&(!cmd.scopeManifest||typeof cmd.scopeManifest!=="object"||manifestBytes>65536))throw Error("复核准备数据无效");
    const state={...s,projects:{...s.projects,[p]:{...s.projects[p],research:r}}},incoming=inspect(state,p).edges.filter(e=>e.active&&e.downstreamConclusionId===cmd.targetConclusionId).map(e=>({edgeId:e.id,edgeRevision:e.revision,upstreamVersionId:e.upstreamVersionId,downstreamVersionId:e.downstreamVersionId}));
    const review={id:o.id(),projectId:p,targetConclusionId:cmd.targetConclusionId,targetVersionId:cmd.targetVersionId,scopeManifestHash:cmd.scopeManifestHash,sourceSnapshots:copy(cmd.sourceSnapshots),blindMaterials:copy(cmd.blindMaterials),incoming,completions:[],at:o.at,...(hasManifest?{scopeManifest:copy(cmd.scopeManifest)}:{})};
    r.reviews.push(review);return {research:r,result:{reviewId:review.id,review}};
  }
  function completeReview(s,p,cmd,raw={}) {
    const r=normal(s.projects?.[p]?.research||base()),o=options(raw),review=r.reviews.find(x=>x.id===cmd?.reviewId);
    if(!review||review.projectId!==p||review.completions?.length||!["keep","revise","withdraw","inconclusive"].includes(cmd.outcome)||typeof cmd.reason!=="string"||!cmd.reason.trim())throw Error("复核完成数据无效");
    const sourceChanged=review.sourceSnapshots.some(x=>!x||typeof x.id!=="string"||typeof x.hash!=="string"||s.sources?.[x.id]?.textHash!==x.hash);
    const targetChanged=cur(s,review.targetConclusionId)?.id!==review.targetVersionId||s.conclusions[review.targetConclusionId]?.status==="withdrawn";
    const scope=ancestorScope(r,review.targetConclusionId),frozenConclusions=Array.isArray(review.scopeManifest?.conclusions)?review.scopeManifest.conclusions:null,frozenEdges=Array.isArray(review.scopeManifest?.edges)?review.scopeManifest.edges:null;
    const ancestorsChanged=!!frozenConclusions&&(
      frozenConclusions.length!==scope.conclusionIds.size||frozenConclusions.some(item=>!scope.conclusionIds.has(item.id)||cur(s,item.id)?.id!==item.versionId||s.conclusions?.[item.id]?.status!==item.status)
    )||!!frozenEdges&&(
      frozenEdges.length!==scope.edges.length||frozenEdges.some(item=>!scope.edges.some(edge=>edge.id===item.id&&edge.revision===item.revision))
    );
    const frozenIncoming=new Set(review.incoming.map(pair=>pair.edgeId+"@"+pair.edgeRevision));
    const currentIncoming=r.edges.filter(edge=>edge.active&&edge.downstreamConclusionId===review.targetConclusionId).map(edge=>edge.id+"@"+edge.revision);
    const incomingSetChanged=currentIncoming.length!==frozenIncoming.size||currentIncoming.some(key=>!frozenIncoming.has(key));
    const incomingChanged=incomingSetChanged||review.incoming.some(pair=>{const e=r.edges.find(x=>x.id===pair.edgeId),up=s.versions?.[pair.upstreamVersionId],down=s.versions?.[pair.downstreamVersionId];return !e||!e.active||e.revision!==pair.edgeRevision||!up||!down||up.conclusionId!==e.upstreamConclusionId||down.conclusionId!==e.downstreamConclusionId||cur(s,e.upstreamConclusionId)?.id!==pair.upstreamVersionId||cur(s,e.downstreamConclusionId)?.id!==pair.downstreamVersionId||s.conclusions[e.upstreamConclusionId]?.status==="withdrawn"||s.conclusions[e.downstreamConclusionId]?.status==="withdrawn";});
    const stale=sourceChanged||targetChanged||incomingChanged||ancestorsChanged;
    const coveredChanges=stale||cmd.outcome!=="keep"?[]:reviewCoveredChanges(r,review),completion={id:o.id(),outcome:cmd.outcome,reason:cmd.reason,at:o.at,stale};
    review.completions.push(completion);
    const edgesToConfirm=stale||cmd.outcome!=="keep"?[]:copy(review.incoming);
    appendEvent(r,{kind:"reviewCompleted",reviewId:review.id,outcome:cmd.outcome,reason:cmd.reason,stale,edgesToConfirm:edgesToConfirm.map(x=>x.edgeId)},o);
    return {research:r,result:{reviewId:review.id,completionId:completion.id,stale,edgesToConfirm,coveredChanges}};
  }
  function notifications(s,p) {
    const r=normal(s.projects?.[p]?.research||base()),active=r.edges.filter(e=>e.active),changes=r.events.filter(e=>e.kind==="change");
    const currentConfirmation=edge=>{
      const confirmation=latestConfirmation(r,edge),up=cur(s,edge.upstreamConclusionId),down=cur(s,edge.downstreamConclusionId);
      return confirmation&&confirmation.acknowledgedUpstreamVersion===up?.id&&confirmation.confirmedForDownstreamVersion===down?.id?confirmation:null;
    };
    const activePathTerminals=(root,target,edgeIds)=>{
      const edges=active.filter(edge=>edgeIds.has(edge.id)),map=graph(edges),fromRoot=new Set(),queue=[root];
      while(queue.length){const id=queue.shift();if(fromRoot.has(id))continue;fromRoot.add(id);queue.push(...(map.get(id)||[]).map(e=>e.downstreamConclusionId));}
      if(!fromRoot.has(target))return [];
      return edges.filter(edge=>edge.downstreamConclusionId===target&&fromRoot.has(edge.upstreamConclusionId)).sort((a,b)=>a.id.localeCompare(b.id));
    };
    return changes.map(event=>({...copy(event),affected:event.affected.map(row=>{
      const withdrawn=s.conclusions?.[row.conclusionId]?.status==="withdrawn",pendingCauses=[];
      for(const cause of row.causes) {
        const terminals=withdrawn?[]:activePathTerminals(cause.rootConclusionId,row.conclusionId,new Set(cause.contributingEdgeIds));
        if(!terminals.length){pendingCauses.push({rootConclusionId:cause.rootConclusionId,pending:false,reason:withdrawn?"目标已撤回":"导致路径已不再有效",terminalEdgeIds:[]});continue;}
        const tuple=changeTuple(event),uncovered=terminals.filter(edge=>{
          const confirmation=currentConfirmation(edge),confirmationIndex=confirmation?r.events.findIndex(x=>x.kind==="confirmed"&&x.confirmationId===confirmation.id):-1,eventIndex=r.events.indexOf(event);
          return !confirmation||confirmationIndex<=eventIndex||!Array.isArray(confirmation.coveredChanges)||!confirmation.coveredChanges.some(item=>sameTuple(item,tuple));
        });
        pendingCauses.push({rootConclusionId:cause.rootConclusionId,pending:uncovered.length>0,reason:uncovered.length?"尚未对照本次变更确认":"已对照本次变更确认",terminalEdgeIds:terminals.map(e=>e.id),uncoveredEdgeIds:uncovered.map(e=>e.id)});
      }
      return {...copy(row),currentVersionId:cur(s,row.conclusionId)?.id||null,withdrawn,pending:pendingCauses.some(x=>x.pending),pendingCauses};
    })}));
  }
  function validateResearch(input,s,p) {
    const r=normal(input),all=[...r.edges,...r.confirmations,...r.events,...r.reviews,...r.reviews.flatMap(x=>Array.isArray(x.completions)?x.completions:[])].map(x=>x.id);
    if(new Set(all).size!==all.length||!all.every(id=>valid(id,"dep_")))throw Error("研究记录 ID 无效或重复");
    for(const edge of r.edges)if(edge.projectId!==p||edge.type!=="necessary"||!Number.isSafeInteger(edge.revision)||edge.revision<1||typeof edge.active!=="boolean"||!owns(s,p,edge.upstreamConclusionId)||!owns(s,p,edge.downstreamConclusionId)||edge.upstreamConclusionId===edge.downstreamConclusionId)throw Error("依赖边无效");
    for(const edge of r.edges.filter(x=>x.active))if(reaches(r.edges.filter(x=>x.active&&x.id!==edge.id),edge.downstreamConclusionId,edge.upstreamConclusionId))throw Error("依赖存在环");
    for(const c of r.confirmations){const e=r.edges.find(x=>x.id===c.edgeId),up=s.versions?.[c.acknowledgedUpstreamVersion],down=s.versions?.[c.confirmedForDownstreamVersion];if(!e||!Number.isSafeInteger(c.edgeRevision)||c.edgeRevision<1||!up||!down||up.conclusionId!==e.upstreamConclusionId||down.conclusionId!==e.downstreamConclusionId||typeof c.scopeManifestHash!=="string"||!c.scopeManifestHash||typeof c.reason!=="string"||!c.reason.trim()||!Number.isSafeInteger(c.at)||Object.hasOwn(c,"carryForwardFrom")&&(!valid(c.carryForwardFrom,"ver_")||s.versions?.[c.carryForwardFrom]?.conclusionId!==e.downstreamConclusionId||c.carryForwardFrom===c.confirmedForDownstreamVersion))throw Error("依赖确认无效");if(Object.hasOwn(c,"coveredChanges"))validateCoveredChanges(r,c.coveredChanges,e);}
    for(const event of r.events) {
      if(!Number.isSafeInteger(event.at)||!["added","reactivated","removed","confirmed","change","reviewCompleted"].includes(event.kind))throw Error("依赖事件无效");
      if(["added","reactivated","removed","confirmed"].includes(event.kind)) {
        const edge=r.edges.find(x=>x.id===event.edgeId);
        if(!edge||!Number.isSafeInteger(event.edgeRevision)||event.edgeRevision<1||typeof event.reason!=="string")throw Error("依赖事件引用无效");
        if(["added","reactivated","confirmed"].includes(event.kind)) {
          const up=s.versions?.[event.upstreamVersionId],down=s.versions?.[event.downstreamVersionId];
          if(!up||!down||up.conclusionId!==edge.upstreamConclusionId||down.conclusionId!==edge.downstreamConclusionId)throw Error("依赖事件版本无效");
        }
        if(event.kind==="confirmed"){const confirmation=r.confirmations.find(c=>c.id===event.confirmationId&&c.edgeId===edge.id);if(!confirmation||Object.hasOwn(event,"carryForwardFrom")&&event.carryForwardFrom!==confirmation.carryForwardFrom||Object.hasOwn(confirmation||{},"carryForwardFrom")&&event.carryForwardFrom!==confirmation.carryForwardFrom)throw Error("依赖确认事件无效");}
      } else if(event.kind==="change") {
        const from=s.versions?.[event.fromVersion],to=s.versions?.[event.toVersion];
        if(!valid(event.triggerEventId,"evt_")||!owns(s,p,event.conclusionId)||!from||!to||from.conclusionId!==event.conclusionId||to.conclusionId!==event.conclusionId||!["amend","withdraw"].includes(event.changeKind)||!Array.isArray(event.affected)||event.affected.length>MAX_EDGES)throw Error("变更事件引用无效");
        for(const row of event.affected)if(!owns(s,p,row.conclusionId)||!s.versions?.[row.versionId]||s.versions[row.versionId].conclusionId!==row.conclusionId||!Array.isArray(row.causes)||row.causes.length>MAX_EDGES)throw Error("变更影响记录无效");
      } else if(event.kind==="reviewCompleted") {
        if(!r.reviews.some(review=>review.id===event.reviewId)||typeof event.reason!=="string"||typeof event.stale!=="boolean"||!Array.isArray(event.edgesToConfirm))throw Error("复核事件引用无效");
      }
    }
    for(const review of r.reviews) {
      if(review.projectId!==p||!owns(s,p,review.targetConclusionId)||!s.versions?.[review.targetVersionId]||s.versions[review.targetVersionId].conclusionId!==review.targetConclusionId||typeof review.scopeManifestHash!=="string"||!review.scopeManifestHash||review.scopeManifestHash.length>2048||Object.hasOwn(review,"scopeManifest")&&(!review.scopeManifest||typeof review.scopeManifest!=="object"||jsonSize(review.scopeManifest)>65536)||!Array.isArray(review.sourceSnapshots)||review.sourceSnapshots.length>64||!Array.isArray(review.blindMaterials)||review.blindMaterials.length>64||!Array.isArray(review.incoming)||review.incoming.length>MAX_EDGES||!Array.isArray(review.completions)||review.completions.length>1||!Number.isSafeInteger(review.at))throw Error("复核记录无效");
      for(const source of review.sourceSnapshots)if(!source||!valid(source.id,"src_")||typeof source.hash!=="string"||!/^[a-f0-9]{64}$/i.test(source.hash))throw Error("复核来源快照无效");
      for(const material of review.blindMaterials)if(!material||typeof material!=="object"||JSON.stringify(material).length>65536)throw Error("复核盲材料无效");
      if(review.scopeManifest?.conclusions!==undefined){
        if(!Array.isArray(review.scopeManifest.conclusions)||review.scopeManifest.conclusions.length>MAX_EDGES)throw Error("复核范围结论无效");
        const ids=new Set();for(const item of review.scopeManifest.conclusions){if(!item||!valid(item.id,"con_")||!valid(item.versionId,"ver_")||!owns(s,p,item.id)||s.versions?.[item.versionId]?.conclusionId!==item.id||!['adopted','withdrawn'].includes(item.status)||ids.has(item.id))throw Error("复核范围结论无效");ids.add(item.id);}
      }
      if(review.scopeManifest?.edges!==undefined){
        if(!Array.isArray(review.scopeManifest.edges)||review.scopeManifest.edges.length>MAX_EDGES)throw Error("复核范围依赖无效");
        const ids=new Set();for(const item of review.scopeManifest.edges){const edge=r.edges.find(x=>x.id===item?.id);if(!edge||!Number.isSafeInteger(item.revision)||item.revision<1||ids.has(item.id))throw Error("复核范围依赖无效");ids.add(item.id);}
      }
      if(review.scopeManifest?.versionIds!==undefined){
        if(!Array.isArray(review.scopeManifest.versionIds)||review.scopeManifest.versionIds.length>MAX_EDGES||review.scopeManifest.versionIds.some(id=>!valid(id,"ver_")||!s.versions?.[id]))throw Error("复核范围版本无效");
      }
      for(const pair of review.incoming){const edge=r.edges.find(x=>x.id===pair.edgeId),up=s.versions?.[pair.upstreamVersionId],down=s.versions?.[pair.downstreamVersionId];if(!edge||!Number.isSafeInteger(pair.edgeRevision)||!up||!down||up.conclusionId!==edge.upstreamConclusionId||down.conclusionId!==edge.downstreamConclusionId)throw Error("复核依赖快照无效");}
      for(const completion of review.completions)if(!["keep","revise","withdraw","inconclusive"].includes(completion.outcome)||typeof completion.reason!=="string"||!completion.reason.trim()||typeof completion.stale!=="boolean"||!Number.isSafeInteger(completion.at))throw Error("复核完成记录无效");
    }
    return true;
  }
  const Research={base,update,carryForward,inspect,impacts,recordChange,prepareReview,completeReview,notifications,validateResearch,MAX_EDGES,MAX_CONFIRMATIONS,MAX_EVENTS,MAX_REVIEWS};
  if(typeof module!=="undefined"&&module.exports)module.exports=Research;else globalThis.ThreadLineResearchCore=Research;
})();
