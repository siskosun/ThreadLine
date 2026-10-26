/**
 * Offline, deterministic pilot/2 priority rule v1. NEVER reads gold truth.
 * Missing or unverifiable source/handoff/edge provenance is MUST_REVIEW.
 * The only persistent exception ("defer with reason") is a future human
 * action, not an output of this classifier.
 */
export const TIER_RULE_ID="threadline-s2-tier/1";
const OBSERVED_CHANGE_KINDS=new Set(["amend","withdraw"]);
const SOURCE_STATES=new Set(["verified","missing","hash_mismatch","unknown"]);
export function classifyImpact(event,impact,projectId) {
  if(!event||!impact||typeof impact.conclusionId!=="string"||typeof projectId!=="string")
    throw Error("分层输入缺失");
  const must=reason=>({conclusionId:impact.conclusionId,tier:"must_review",reason});
  const before=reason=>({conclusionId:impact.conclusionId,tier:"before_use",reason});
  const state=event.frozenState||{},target=state.conclusions?.[impact.conclusionId];
  if(target?.projectId!==projectId||target?.status==="withdrawn")
    return must("目标身份失效或已撤回");
  if(!SOURCE_STATES.has(event.sourceSnapshotStatus)||event.sourceSnapshotStatus!=="verified")
    return must("来源未知、丢失或哈希无法核验");
  if(!OBSERVED_CHANGE_KINDS.has(event.observedChangeKind))
    return must("缺少可观察的变更操作类型");
  if(event.observedChangeKind==="withdraw")
    return must("上游已撤回");
  const scope=event.handoffIncludedIds;
  if(!Array.isArray(scope)||scope.some(id=>typeof id!=="string"))
    return must("当前交接范围未知");
  if(scope.includes(impact.conclusionId))
    return must("当前交接引用此结论");
  const edges=state.projects?.[projectId]?.research?.edges;
  if(!Array.isArray(edges))return must("依赖图未冻结");
  const byId=new Map(edges.filter(e=>e?.active).map(e=>[e.id,e]));
  const causes=impact.causes;
  if(!Array.isArray(causes)||!causes.length)return must("传播路径缺失");
  const paths=causes.map(c=>{
    if(!Array.isArray(c.edgeIds)||!c.edgeIds.length||!Array.isArray(c.path)||
       c.path.length!==c.edgeIds.length+1)return null;
    const linked=c.edgeIds.map(id=>byId.get(id));
    if(linked.some((edge,i)=>!edge||
      edge.upstreamConclusionId!==c.path[i]||
      edge.downstreamConclusionId!==c.path[i+1]))return null;
    return {hops:linked.length,types:linked.map(e=>e.type)};
  });
  if(paths.some(p=>!p))return must("关系边证据不足");
  if(paths.some(p=>p.types.some(t=>!["necessary","background"].includes(t))))
    return must("未知关系边类型");
  if(paths.some(p=>p.hops===1&&p.types[0]==="necessary") &&
     event.observedChangeKind==="amend"&&target.status==="adopted")
    return must("已采纳结论的直接必要前提实质变化");
  // A withdrawal or corrupted source never gets demoted by hop length.
  if(paths.every(p=>p.hops>=2))
    return before("经核验的间接影响，使用前仍须核对");
  if(paths.every(p=>p.types.includes("background")))
    return before("已核验的背景关系，使用前仍须核对");
  return must("未满足安全降级条件");
}
export function classifyImpacts(event,impacts,projectId) {
  if(!Array.isArray(impacts))throw Error("缺少 flat 影响集合");
  const seen=new Set();
  return impacts.map(row=>{
    if(seen.has(row.conclusionId))throw Error("重复的影响目标");
    seen.add(row.conclusionId);
    return classifyImpact(event,row,projectId);
  });
}
