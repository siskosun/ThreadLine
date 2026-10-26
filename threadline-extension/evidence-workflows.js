/* Explicit, recoverable user workflows. All callers enter the background queue. */
(() => {
  "use strict";
  const STORE="threadline_state_v1", SNAPSHOTS="threadline_state_snapshots", PREFIX="tl_evidence_summary_";
  const operationId=()=>"op_"+crypto.randomUUID().replace(/-/g,"");
  const recordId=()=>"dep_"+crypto.randomUUID().replace(/-/g,"");
  const copy=x=>structuredClone(x);
  function create(env) {
    const {chrome,Core,DB,Lifecycle,Source}=env;
    const raw=async()=>{const db=await env.db();return {db,state:await DB.snapshot(db),local:await chrome.storage.local.get(null)};};
    const topic=local=>env.TopicCore.normalizedState(local[STORE]);
    const counts=pkg=>Object.fromEntries(["conclusions","versions","sources","links"].map(k=>[k,pkg[k].length]));
    const token=async data=>Core.hashRequest({state:data.state,topic:data.local[STORE]||null,summary:Object.fromEntries(Object.entries(data.local).filter(([k])=>k.startsWith(PREFIX)))});
    const checkId=id=>Core.requireProjectId(id);
    const TOPIC_FIELDS=new Set(["id","name","goal","stage"]);
    function safeTopicMetadata(meta,projectId) {
      const fallback={id:projectId,name:"恢复的课题 "+projectId,goal:"",stage:"active"};
      if(meta===null||meta===undefined)return fallback;
      if(typeof meta!=="object"||Array.isArray(meta) ||
          Object.keys(meta).some(key=>!TOPIC_FIELDS.has(key)))
        throw Error("备份课题包含不支持的元信息字段；未写入");
      if(meta.id!==projectId||typeof meta.name!=="string"||meta.name.length>80||
          typeof meta.goal!=="string"||meta.goal.length>600||
          !["active","closed"].includes(meta.stage))
        throw Error("备份课题信息无效；未写入");
      return {id:projectId,name:meta.name,goal:meta.goal,stage:meta.stage};
    }
    function envelope(input) {
      if(!input||Core.bytes(JSON.stringify(input))>Core.LIMITS.packageBytes)throw Error("备份超过 20 MiB 或格式无效");
      const wrapped=input.format==="threadline-project-backup/1", pkg=wrapped?input.evidence:input;
      checkId(pkg?.projectId);
      const meta=safeTopicMetadata(wrapped?input.topic:null,pkg.projectId);
      return {pkg,meta};
    }
    function scrubState(value,id,bump=false) {
      const s=env.TopicCore.normalizedState(value),had=s.projects.some(p=>p.id===id);
      s.projects=s.projects.filter(p=>p.id!==id);
      for(const [key,c] of Object.entries(s.chats))if(c.projectId===id)delete s.chats[key];
      if(had&&bump)s.revision++;
      return s;
    }
    async function cleanupPending() {
      const data=await raw();
      for(const p of Object.values(data.state.projects)) {
        if(p.deleted&&p.cleanupPending) {
          const local=await chrome.storage.local.get(null);
          const next=scrubState(local[STORE],p.projectId,true);
          const snapshots=(local[SNAPSHOTS]||[]).map(s=>({...s,state:scrubState(s.state,p.projectId)}));
          // No normal writeState: that would create a new original-text undo copy.
          await chrome.storage.local.set({[STORE]:next,[SNAPSHOTS]:snapshots});
          await chrome.storage.local.remove(PREFIX+p.projectId);
          const session=await chrome.storage.session.get(null);
          const drafts=Object.entries(session).filter(([k,v])=>k.startsWith("tl_handoff_")&&v?.projectId===p.projectId).map(([k])=>k);
          if(drafts.length)await chrome.storage.session.remove(drafts);
          await DB.markCleanupDone(data.db,p.projectId,p.evidenceRevision);
        } else if(p.restorePending) {
          const local=await chrome.storage.local.get(null),s=topic(local),at=Date.now(),meta=p.restoreTopic;
          let t=s.projects.find(t=>t.id===p.projectId);
          if(!t){if(s.projects.length>=100)throw Error("课题数量达到上限，恢复已保存，等待腾出空间");t={id:p.projectId,knowledgeVersion:0,history:[],lastChange:null,createdAt:at,updatedAt:at,closedAt:null,decision:""};s.projects.push(t);}
          Object.assign(t,safeTopicMetadata(meta,p.projectId),
            {evidenceTakeover:true,evidenceProjectionRevision:0});s.revision++;
          // Preserve old raw data via explicit diagnostic export; never restore stale summaries.
          await chrome.storage.local.set({[STORE]:s});
          await DB.markRestoreDone(data.db,p.projectId,p.evidenceRevision);
        }
      }
    }
    async function planMetadata(state,id,request,research,handoffs,result) {
      const p=state.projects[id];if(!p||p.deleted)throw Error("课题不可用");
      const hash=await Core.hashRequest({schema:2,kind:"metadata",input:request});
      const prior=state.operations[request.operationId];
      if(prior){if(prior.schema!==2||prior.kind!=="metadata"||prior.requestHash!==hash)throw Error("操作 ID 已用于不同请求");return {replay:prior.result};}
      if(!/^op_[a-z0-9_-]{8,64}$/.test(request.operationId||""))throw Error("操作 ID 无效");
      if(request.expectedRevision!==p.evidenceRevision)throw Error("课题已变化，请刷新后重新审阅");
      const next={...p,evidenceRevision:p.evidenceRevision+1,projectionTodo:true};
      if(research!==undefined)next.research=research;
      if(handoffs!==undefined)next.handoffs=handoffs;
      const answer={...result,revision:next.evidenceRevision};
      return {expectedRevision:p.evidenceRevision,result:answer,writes:{project:next,ledger:{schema:2,kind:"metadata",projectId:id,operationId:request.operationId,requestHash:hash,result:answer,at:Date.now()}}};
    }
    async function commit(authority,plan) {
      await env.budget(authority.state,plan);
      const result=await DB.applyPlan(authority.db,plan);
      try{await env.reconcile();return {...result,projectionPending:false};}
      catch(e){return {...result,projectionPending:true,projectionError:e.message};}
    }
    async function requestReplay(state,payload,kind) {
      if(!/^op_[a-z0-9_-]{8,64}$/.test(payload.operationId||""))throw Error("操作 ID 无效");
      const hash=await Core.hashRequest({schema:2,kind,input:payload}),prior=state.operations[payload.operationId];
      if(prior&&(prior.schema!==2||prior.kind!==kind||prior.requestHash!==hash))throw Error("操作 ID 已用于不同请求");
      if(prior?.redacted)throw Error("旧操作所属数据已删除或替换，不能重放");
      return {hash,prior};
    }
    function scope(state,id) {
      return Object.values(state.conclusions).filter(c=>c.projectId===id)
        .sort((a,b)=>a.id.localeCompare(b.id))
        .map(c=>({id:c.id,status:c.status,versionId:c.currentVersionId,
          sources:Object.values(state.links).filter(l=>l.versionId===c.currentVersionId)
            .map(l=>({id:l.sourceId,hash:state.sources[l.sourceId]?.textHash,relation:l.relation}))
            .sort((a,b)=>a.id.localeCompare(b.id))}));
    }
    function handoffText(state,id) {
      const lines=["研究交接材料；采纳不等于事实已核实。"];
      for(const c of Object.values(state.conclusions).filter(c=>c.projectId===id)) {
        const v=state.versions[c.currentVersionId];
        lines.push("",(c.status==="withdrawn"?"[已撤回，不应继续引用] ":v.predecessorId?"[已修订] ":"[已采纳] ")+v.text,"版本："+v.id);
        if(v.conditions)lines.push("适用条件："+v.conditions);
        for(const l of Object.values(state.links).filter(l=>l.versionId===v.id)){const s=state.sources[l.sourceId];lines.push("依据（"+l.relation+"；"+s.completeness+"）："+s.selection,"来源："+(s.url||s.conversationId||"仅片段")+"；消息 "+(s.messageId||"未知")+"；来源哈希 "+s.textHash);}
      }
      lines.push("","已知未知项：来源可能只含文本或选区；未逐项核验。复制、人工看过与模型理解是不同事实。");
      const text=lines.join("\n");if(Core.bytes(text)>128*1024)throw Error("交接材料超过 128 KiB，请缩小课题范围或使用完整备份；未截断");return text;
    }
    const commands=new Set(["EV_PROJECTS","EV_BACKUP","EV_DELETE_PREVIEW","EV_DELETE_COMMIT",
      "EV_RESTORE_PREVIEW","EV_RESTORE_COMMIT","EV_ADOPT_CAPTURE","EV_ADOPT_FORK",
      "EV_HANDOFF_PREPARE","EV_HANDOFF_VALIDATE","EV_HANDOFF_RECORD"]);
    async function handle(payload) {
      if(!commands.has(payload.type))return undefined;
      return env.serialize(async()=>{
        const type=payload.type;
        if(type==="EV_PROJECTS"){
          const {state,local}=await raw();let error=null;try{await env.loadAuthority();}catch(e){error=e.message;}
          const byId=new Map((local[STORE]?.projects||[]).map(p=>[p.id,{id:p.id,name:p.name,stage:p.stage}]));
          for(const p of Object.values(state.projects))byId.set(p.projectId,{...(byId.get(p.projectId)||{id:p.projectId,name:p.projectId}),evidenceRevision:p.evidenceRevision,deleted:!!p.deleted,unavailable:!!error});
          return {projects:[...byId.values()],error};
        }
        if(type==="EV_DELETE_PREVIEW"||type==="EV_DELETE_COMMIT"){
          const data=await raw(),id=payload.projectId||payload.preview?.projectId;checkId(id);
          if(type==="EV_DELETE_COMMIT"&&payload.preview?.projectId!==id)throw Error("删除课题与预览不一致");
          const p=data.state.projects[id];if(!p)throw Error("课题没有持久证据，请使用普通课题删除");
          if(type==="EV_DELETE_PREVIEW"){
            const ids=Lifecycle.deleteIds(data.state,id);
            return {preview:{projectId:id,expectedRevision:p.evidenceRevision,topicRevision:topic(data.local).revision,scopeHash:await token(data)},counts:Object.fromEntries(Object.entries(ids).map(([k,v])=>[k,v.length])),retainedOriginalsNotice:"删除课题证据、摘要、版本历史和撤销副本；独立的采集/Fork原始资料及外部导出文件保留，可在各自入口单独删除。"};
          }
          const preview=payload.preview;if(!preview)throw Error("请先预览删除范围");
          const sealed=await requestReplay(data.state,payload,"delete");
          if(!sealed.prior&&preview.scopeHash!==await token(data))throw Error("删除预览已变化，请重新核对");
          const plan=sealed.prior?{replay:sealed.prior.result}:await Lifecycle.planDelete(data.state,id,payload.operationId,preview.expectedRevision);
          if(plan.writes)plan.writes.ledger.requestHash=sealed.hash;
          const result=await DB.applyPlan(data.db,plan);
          try{await cleanupPending();return {...result,cleanupPending:false};}catch(e){return {...result,cleanupPending:true,error:e.message};}
        }
        if(type==="EV_RESTORE_PREVIEW"||type==="EV_RESTORE_COMMIT"){
          const data=await raw(),{pkg,meta}=envelope(payload.backup);await Core.validateExportPackage(pkg);
          const p=data.state.projects[pkg.projectId],t=topic(data.local).projects.find(t=>t.id===pkg.projectId);
          const minimum=Math.max(p?.evidenceRevision||0,t?.evidenceProjectionRevision||0,data.local[PREFIX+pkg.projectId]?.evidenceRevision||0);
          const backupHash=await Core.hashRequest(payload.backup);
          const preview=type==="EV_RESTORE_PREVIEW"?{projectId:pkg.projectId,backupHash,expectedRevision:p?.evidenceRevision??null,minimumRevision:minimum,topicRevision:topic(data.local).revision,scopeHash:await token(data),replace:payload.replace===true}:payload.preview;
          if(!preview||preview.projectId!==pkg.projectId)throw Error("请先核对恢复预览");
          if(preview.backupHash!==backupHash)throw Error("恢复内容与预览不一致，请重新预览");
          const sealed=type==="EV_RESTORE_COMMIT"?await requestReplay(data.state,payload,"restore"):null;
          if(sealed&&!sealed.prior&&preview.scopeHash!==await token(data))throw Error("恢复预览已变化，请重新核对");
          const plan=sealed?.prior?{replay:sealed.prior.result}:await Lifecycle.planRestore(data.state,pkg,payload.operationId||operationId(),preview);
          if(type==="EV_RESTORE_PREVIEW")return {preview,counts:counts(pkg),topic:meta,includesOriginalExcerpts:true};
          if(plan.writes){plan.writes.ledger.requestHash=sealed.hash;plan.writes.project.restorePending=true;plan.writes.project.restoreTopic=meta;}
          await env.budget(data.state,plan);const result=await DB.applyPlan(data.db,plan);
          try{await cleanupPending();await env.reconcile();return {...result,projectionPending:false};}catch(e){return {...result,projectionPending:true,error:e.message};}
        }
        const authority=await env.loadAuthority(),{state,db}=authority,id=payload.projectId;
        if(type==="EV_BACKUP"){
          const pkg=Core.exportPackage(state,id);await Core.validateExportPackage(pkg);
          const t=authority.topic.projects.find(p=>p.id===id)||{id,name:id,goal:"",stage:"active"};
          const backup={format:"threadline-project-backup/1",exportedAt:Date.now(),topic:{id,name:t.name,goal:t.goal,stage:t.stage},evidence:pkg};
          if(Core.bytes(JSON.stringify(backup))>Core.LIMITS.packageBytes)throw Error("备份超过 20 MiB，未截断");return backup;
        }
        if(type==="EV_ADOPT_CAPTURE"||type==="EV_ADOPT_FORK"){
          // Seal the original source coordinates, not a cache-dependent reconstruction.
          // A committed retry remains available even after capture cache expiry.
          const sealed=await requestReplay(state,payload,"adopt");
          if(sealed.prior)return commit(authority,{replay:sealed.prior.result});
          if(!Array.isArray(payload.selections)||!payload.selections.length||payload.selections.length>8)throw Error("需要 1–8 条明确的原文选区");
          const fragments=[];
          for(const selected of payload.selections){
            if(type==="EV_ADOPT_CAPTURE"){
              const run=await env.CaptureDB.getRun(selected.captureRunId);if(!run)throw Error("原始采集缓存已过期，请重新采集");
              const messages=env.CaptureCore.assemble(await env.CaptureDB.pages(run.id));
              if(!Number.isSafeInteger(selected.messageIndex)||selected.messageIndex<0||selected.messageIndex>=messages.length)throw Error("来源消息编号不属于本次采集");
              fragments.push(Source.fragment(run,messages[selected.messageIndex],selected));
            }else{
              const exp=await env.FFDB.read(payload.experimentId),a=exp?.branches[payload.branch]?.attempts.find(a=>a.id===payload.attemptId),ev=a?.evidence;
              if(!exp?.decision?.verdict||a?.status!=="done"||!ev?.captureRunId||!ev?.messageId)throw Error("需完成揭盲且具备完整回复来源，旧实验请重新采集");
              fragments.push(Source.fragment({id:ev.captureRunId,conversationId:ev.sessionId,url:ev.sourceUrl,complete:ev.captureComplete,mode:ev.captureMode,notice:ev.captureNotice,updatedAt:ev.capturedAt},{id:ev.messageId,role:"assistant",content:ev.reply,hasNonText:ev.hasNonText},selected));
            }
          }
          await DB.ensureProject(db,id,Core);const fresh=await DB.snapshot(db);
          const plan=await Core.planAdoption(fresh,{projectId:id,text:payload.text,conditions:payload.conditions,fragments,legacyDecision:authority.taken.has(id)?"":authority.topic.projects.find(p=>p.id===id)?.decision||""},payload.operationId);
          if(plan.writes)plan.writes.ledger.requestHash=sealed.hash;
          return commit({...authority,state:fresh},plan);
        }
        const p=state.projects[id];if(!p||p.deleted)throw Error("请先采纳一条结论");
        const replay=payload.operationId&&state.operations[payload.operationId];
        if(replay&&replay.kind==="metadata"){
          if(replay.redacted)throw Error("旧操作所属数据已删除或替换，不能重放");
          const expected=await Core.hashRequest({schema:2,kind:"metadata",input:payload});
          if(replay.requestHash!==expected)throw Error("操作 ID 已用于不同请求");
          return commit(authority,{replay:replay.result});
        }
        const currentScope=scope(state,id),scopeHash=await Core.hashRequest(currentScope);
        if(type==="EV_HANDOFF_PREPARE"){
          const text=handoffText(state,id),handoffs=copy(p.handoffs||[]);if(handoffs.length>=100)throw Error("交接历史已达 100 条，请导出后整理课题");
          const handoff={id:recordId(),scope:currentScope,scopeHash,text,materialHash:await Core.hashText(text),createdAt:Date.now(),events:[]};handoffs.push(handoff);
          return commit(authority,await planMetadata(state,id,payload,undefined,handoffs,{handoff}));
        }
        const handoffs=copy(p.handoffs||[]),handoff=handoffs.find(h=>h.id===payload.handoffId);
        if(!handoff||handoff.scopeHash!==scopeHash)throw Error("证据已变化，请重新核对预览；当前草稿仍保留");
        if(typeof payload.text!=="string"||!payload.text.trim()||Core.bytes(payload.text)>128*1024)throw Error("交接正文为空或超过 128 KiB");
        const materialHash=await Core.hashText(payload.text);
        if(type==="EV_HANDOFF_VALIDATE")return {materialHash,scopeHash};
        if(!["copied","human-read"].includes(payload.event))throw Error("未知交接事件");
        if(handoff.events.length>=100)throw Error("交接事件超过上限");
        handoff.events.push({id:recordId(),event:payload.event,materialHash,text:payload.text,at:Date.now()});
        return commit(authority,await planMetadata(state,id,payload,undefined,handoffs,{handoffId:handoff.id,materialHash,event:payload.event}));
      });
    }
    return {handle,cleanupPending,scope,planMetadata};
  }
  const api={create};if(typeof module!=="undefined"&&module.exports)module.exports=api;else globalThis.ThreadLineEvidenceWorkflows=api;
})();
