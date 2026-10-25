/* S2: explicit necessary dependencies only. No auto-edit, no S3/S4 review. */
(() => {
  "use strict";
  const el=(tag,text="",className="")=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
  const send=p=>new Promise((ok,no)=>chrome.runtime.sendMessage(p,r=>chrome.runtime.lastError?no(Error(chrome.runtime.lastError.message)):r?.ok?ok(r.data):no(Error(r?.error||"后台未确认"))));
  const operationId=()=> "op_s2_"+crypto.randomUUID().replace(/-/g,"");
  const $=id=>document.getElementById(id);
  let cached=null,request=0,busy=false;
  function projectId(){return $("evidence-project")?.value||"";}
  function status(message,error=false){const box=$("dependency-status");if(box){box.textContent=message;box.dataset.error=String(error);}}
  function options(select,rows,previous){
    select.replaceChildren();
    for(const row of rows.filter(r=>r.conclusion.status!=="withdrawn")){
      const opt=new Option((row.current?.text||row.conclusion.id).slice(0,74),row.conclusion.id);
      select.add(opt);
    }
    if([...select.options].some(o=>o.value===previous))select.value=previous;
  }
  const current=id=>cached?.rows?.find(r=>r.conclusion.id===id);
  async function save(command){
    if(busy||!cached)return;
    if(!projectId()||cached.project.projectId!==projectId())throw Error("课题已切换，请刷新");
    busy=true;
    try{
      const result=await send({type:"EV_RESEARCH_COMMAND",projectId:projectId(),
        expectedRevision:cached.project.evidenceRevision,operationId:operationId(),command});
      status("已保存人工确认的必要依赖；不代表原结论经过事实核验。");
      await refresh();window.dispatchEvent(new Event("threadline-evidence-changed"));
      return result;
    }catch(error){status("操作未确认："+error.message,true);throw error;}
    finally{busy=false;}
  }
  function draw(){
    if(!cached)return;
    for(const id of ["dependency-upstream","dependency-downstream"]){
      const select=$(id);options(select,cached.rows,select.value);
    }
    const edges=$("dependency-edges");edges.replaceChildren();
    for(const edge of (cached.edges||[]).filter(x=>x.active)){
      const row=el("section","","line"),up=current(edge.upstreamConclusionId),down=current(edge.downstreamConclusionId);
      const label=el("p",(up?.current?.text||edge.upstreamConclusionId).slice(0,120)+
        " → "+(down?.current?.text||edge.downstreamConclusionId).slice(0,120)+
        " · "+(edge.status==="confirmed"?"已对照当前版本":"需重新确认："+edge.reason),"subtle");
      row.append(label);
      if(edge.status!=="confirmed"){
        const btn=el("button","确认当前版本","secondary");btn.type="button";
        btn.onclick=async()=>{
          const reason=prompt("核对上下游原文后填写确认理由：");
          if(reason===null)return;
          try{await save({kind:"confirmDependency",edgeId:edge.id,
            upstreamVersionId:edge.upstreamVersionId,downstreamVersionId:edge.downstreamVersionId,reason});}
          catch{}
        };
        row.append(btn);
      }
      const remove=el("button","移除此依赖","secondary");remove.type="button";
      remove.onclick=async()=>{
        const reason=prompt("说明为什么移除这一必要依赖：");if(reason===null)return;
        try{await save({kind:"removeDependency",edgeId:edge.id,reason});}catch{}
      };
      row.append(remove);edges.append(row);
    }
    if(!edges.children.length)edges.append(el("p","没有已登记的必要依赖。先核对结论与原始依据，再登记确实必要的前提。","subtle"));
    $("dependency-add").disabled=!cached.rows||cached.rows.filter(r=>r.conclusion.status!=="withdrawn").length<2||busy;
  }
  async function refresh(){
    const id=projectId(),ticket=++request;if(!id){cached=null;$("dependency-edges")?.replaceChildren();return;}
    try{
      const result=await send({type:"EV_RESEARCH_LIST",projectId:id});
      if(ticket!==request||id!==projectId())return;
      cached=result;draw();
    }catch(e){if(ticket!==request)return;cached=null;status("依赖不可用："+e.message,true);}
  }
  async function preview(){
    if(!cached)return;
    const id=projectId(),revision=cached.project.evidenceRevision;
    try{
      const response=await send({type:"EV_SUGGESTIONS_PREVIEW",projectId:id,json:$("dependency-json").value});
      if(projectId()!==id||cached?.project?.evidenceRevision!==revision)throw Error("课题已变化，请重新预览");
      const holder=$("dependency-proposals");holder.replaceChildren();
      for(const item of response.proposals||[]){
        const row=el("div","","line"),label=el("span",(current(item.upstreamConclusionId)?.current?.text||item.upstreamConclusionId).slice(0,70)+
          " → "+(current(item.downstreamConclusionId)?.current?.text||item.downstreamConclusionId).slice(0,70)+" · "+item.reason,"subtle");
        const add=el("button","核对后登记","secondary");add.type="button";
        add.onclick=async()=>{if(!confirm("确认这是确实必要的前提关系，并已核对对应原始证据？"))return;
          try{await save({kind:"addDependency",...item});holder.replaceChildren();}catch{};};
        row.append(label,add);holder.append(row);
      }
      if(!response.proposals?.length)holder.append(el("span","无候选关系。","subtle"));
      status("仅显示 AI 候选；没有自动登记。");
    }catch(e){status("建议无法预览："+e.message,true);}
  }
  function mount(){
    const host=$("evidence-section");if(!host||$("dependency-workbench"))return;
    const details=el("details");details.id="dependency-workbench";details.className="manage-accordion";
    details.append(el("summary","必要前提（人工登记）"));
    const body=el("div");
    const help=el("p","只登记“下游结论必须依赖上游结论成立”的关系。修改结论不会自动宣布其他结论错误。","subtle");
    const up=el("select");up.id="dependency-upstream";up.setAttribute("aria-label","必要前提结论");
    const down=el("select");down.id="dependency-downstream";down.setAttribute("aria-label","依赖此前提的结论");
    const reason=el("textarea");reason.id="dependency-reason";reason.rows=2;reason.placeholder="为什么下游判断必须依赖这个前提？";
    const add=el("button","登记确认的必要依赖","secondary");add.type="button";add.id="dependency-add";
    const edges=el("div");edges.id="dependency-edges";
    const ai=el("details");ai.append(el("summary","AI 候选建议（可选）"));
    const aiBody=el("div"),copyPrompt=el("button","复制建议提示词","secondary");copyPrompt.type="button";
    const json=el("textarea");json.rows=4;json.id="dependency-json";json.setAttribute("aria-label","粘贴建议 JSON");
    const buttonPreview=el("button","预览候选依赖","secondary");buttonPreview.type="button";
    const proposals=el("div");proposals.id="dependency-proposals";
    aiBody.append(copyPrompt,json,buttonPreview,proposals);ai.append(aiBody);
    const msg=el("p");msg.id="dependency-status";msg.setAttribute("role","status");
    body.append(help,el("label","上游必要前提"),up,el("label","下游结论"),down,el("label","确认理由"),reason,add,edges,ai,msg);
    details.append(body);host.append(details);
    add.onclick=async()=>{const a=current(up.value),b=current(down.value);
      if(!a||!b){status("请选择两条有效结论",true);return;}
      try{await save({kind:"addDependency",upstreamConclusionId:up.value,
        downstreamConclusionId:down.value,upstreamVersionId:a.current.id,
        downstreamVersionId:b.current.id,reason:reason.value});}catch{};
    };
    copyPrompt.onclick=async()=>{try{const p=await send({type:"EV_DEPENDENCY_PROMPT",projectId:projectId()});await navigator.clipboard.writeText(p.prompt);
      status("提示词已复制，但不会自动发送；返回建议需人工核对。");
    }catch(e){status("复制失败："+e.message,true);}};
    buttonPreview.onclick=preview;
    details.addEventListener("toggle",()=>{if(details.open)refresh()});
    $("evidence-project")?.addEventListener("change",()=>{cached=null;refresh();});
    window.addEventListener("threadline-evidence-changed",()=>{if(details.open)refresh();});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
})();
