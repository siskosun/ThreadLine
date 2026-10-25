/* S3: explicit change-event inspection; no automatic fact adjudication. */
(() => {
 "use strict";
 const el=(tag,text="",cls="")=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
 const $=id=>document.getElementById(id),send=p=>new Promise((ok,no)=>chrome.runtime.sendMessage(p,r=>chrome.runtime.lastError?no(Error(chrome.runtime.lastError.message)):r?.ok?ok(r.data):no(Error(r?.error||"后台拒绝"))));
 let seq=0,busy=false;
 const pid=()=>$("evidence-project")?.value||"";
 const say=(text,bad=false)=>{const t=$("impact-status");if(t){t.textContent=text;t.dataset.error=String(bad)}};
 const text=row=>(row.current?.text||row.conclusion.id).slice(0,110);
 function excerptList(parent,heading,block){
   const title=el("p",heading+"："+(block.text||"")+"；适用条件："+(block.conditions||"无"),"subtle");parent.append(title);
   const details=el("details");details.append(el("summary","查看相关原始依据片段"));
   for(const s of block.sources||[])details.append(el("p",(s.relation||"引用")+" · "+s.selection+(s.completeness==="complete"?"（已完整采集）":"（可能不完整）"),"subtle"));
   if(!block.sources?.length)details.append(el("p","暂无可回查依据，请勿据此判断真伪。","subtle"));parent.append(details);
 }
 async function refresh(){
   const id=pid(),ticket=++seq;if(!id)return;
   try{
     const result=await send({type:"EV_RESEARCH_LIST",projectId:id});
     if(id!==pid()||ticket!==seq)return;
     const holder=$("impact-items");holder.replaceChildren();
     const name=id=>result.rows.find(r=>r.conclusion.id===id);
     for(const event of result.notifications||[]){
       for(const affected of event.affected.filter(x=>x.pending)){
         const section=el("section","","surface"),header=el("h4",
           "待核查："+text(name(affected.conclusionId)||{conclusion:{id:affected.conclusionId}}));
         const meta=el("p","前提版本 "+event.fromVersion+" → "+event.toVersion+
           "；已登记关系发生可能影响，不表示结论错误。","subtle");
         const check=el("button","查看变更前后与原始依据","secondary");check.type="button";
         const context=el("div"),actions=el("div");section.append(header,meta,check,context,actions);
         check.onclick=async()=>{
           check.disabled=true;
           try{
             const material=await send({type:"EV_IMPACT_CONTEXT",projectId:id,triggerEventId:event.triggerEventId,targetConclusionId:affected.conclusionId});
             if(id!==pid()||ticket!==seq)return;
             context.replaceChildren();actions.replaceChildren();
             excerptList(context,"上游变更前",material.before);
             excerptList(context,"上游变更后",material.after);
             excerptList(context,"下游当前结论",material.target);
             const missing=[...new Set((affected.pendingCauses||[]).flatMap(c=>c.uncoveredEdgeIds||[]))];
             for(const edgeId of missing){
               const edge=result.edges.find(e=>e.id===edgeId&&e.active);
               if(!edge)continue;
               const btn=el("button","核对并确认此依赖","secondary");btn.type="button";
               btn.onclick=async()=>{
                 const reason=prompt("核对上面所列变更与依据后，填写此依赖针对该事件仍成立的理由：");
                 if(reason===null)return;
                 if(!reason.trim()){say("确认理由不能为空",true);return;}
                 busy=true;btn.disabled=true;
                 try{
                   await send({type:"EV_RESEARCH_COMMAND",projectId:id,expectedRevision:material.scopeRevision,
                     operationId:"op_impact_"+crypto.randomUUID().replace(/-/g,""),
                     command:{kind:"confirmDependency",edgeId:edge.id,upstreamVersionId:edge.upstreamVersionId,
                       downstreamVersionId:edge.downstreamVersionId,reason,
                       coveredChanges:[{triggerEventId:event.triggerEventId,rootConclusionId:event.conclusionId,
                         rootVersionId:event.toVersion}]}});
                   say("已记录一次明确核查，其他路径仍可能待处理。");await refresh();
                   window.dispatchEvent(new Event("threadline-evidence-changed"));
                 }catch(e){say("确认未提交："+e.message,true);}
                 finally{busy=false;btn.disabled=false;}
               };
               actions.append(btn);
             }
             if(!missing.length)actions.append(el("p","该事件没有可确认的终端必要依赖；请核对路径是否已撤回。","subtle"));
           }catch(e){say("无法读取核查材料："+e.message,true);}
           finally{check.disabled=false;}
         };
         holder.append(section);
       }
     }
     if(!holder.childElementCount)holder.append(el("p","当前没有登记依赖引起的待核查变化；这不代表所有结论均已核实。","subtle"));
   }catch(e){if(ticket===seq)say("影响检查失败："+e.message,true);}
 }
 function mount(){
   const host=$("evidence-section");if(!host||$("impact-workbench"))return;
   const box=el("details");box.id="impact-workbench";box.className="manage-accordion";
   box.append(el("summary","变化与待核查影响"));
   const body=el("div"),refreshBtn=el("button","刷新影响列表","secondary");refreshBtn.type="button";
   const note=el("p","仅追踪已登记的必要依赖；每条变化和影响路径需要人工核对，不能自动宣布下游结论错误。","subtle");
   const items=el("div");items.id="impact-items";
   const status=el("p");status.id="impact-status";status.setAttribute("role","status");
   body.append(note,refreshBtn,items,status);box.append(body);host.append(box);
   refreshBtn.onclick=refresh;box.addEventListener("toggle",()=>{if(box.open)refresh()});
   $("evidence-project")?.addEventListener("change",()=>{++seq;items.replaceChildren();if(box.open)refresh()});
   window.addEventListener("threadline-evidence-changed",()=>{if(box.open)refresh()});
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
})();
