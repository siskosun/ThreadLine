/* Local dependency/review workbench. It never sends evidence automatically. */
(() => {
  "use strict";
  const send = payload => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, response => {
      if (chrome.runtime.lastError) {
        reject(Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(Error(response?.error || "请求失败"));
        return;
      }
      resolve(response.data);
    });
  });
  const q = id => document.getElementById(id);
  const op = p => p + crypto.randomUUID().replace(/-/g, "").slice(0,12);
  const el = (tag, attrs = {}, text = "") => {
    const node = document.createElement(tag);
    Object.assign(node, attrs);
    node.textContent = text;
    return node;
  };
  let data, current, request=0, writing=false,activeReview=null,reviewGeneration=0,revisedTextTouched=false,revisedConditionsTouched=false;
  const pid = () => q("evidence-project")?.value || "";
  const row = id => data?.rows?.find(r => r.conclusion.id === id);
  const active = () => row(current) || data?.rows?.[0];
  const version = id => row(id)?.current?.id;
  const say = (text, bad=false) => { q("research-notice").textContent=text; q("research-notice").classList.toggle("warn",bad); };
  function syncReviewControls(){
    if(!q("research-review-id"))return;const id=q("research-review-id").value,review=data?.research?.reviews?.find(r=>r.id===id)||activeReview;
    const completed=!!review?.completions?.length;
    q("research-prepare").disabled=writing||!data?.rows?.length;
    q("research-complete").disabled=!id||completed||writing;q("research-reference-btn").disabled=!id;q("research-copy-blind").disabled=!q("research-blind").value;
    q("research-outcome").disabled=completed;
    for(const name of ["research-analysis","research-review-reason","research-revised-text","research-revised-conditions","research-branch-url"])q(name).readOnly=completed;
  }
  function restoreReview(review){
    blankReview();activeReview=review;q("research-review-panel").open=true;
    q("research-review-id").value=review.id;q("research-blind").value=JSON.stringify(review.blindMaterials,null,2);
    const completion=review.completions.at(-1);if(completion){q("research-analysis").value=completion.analysis||"";q("research-review-reason").value=completion.reason;q("research-outcome").value=completion.outcome;q("research-branch-url").value=completion.branchUrl||"";}
    syncReviewControls();say(completion?"已打开完成的复核历史；原范围和结果保留，不可重复提交。":"已恢复未完成的冻结材料。完成时仍会检查版本是否过期。");
  }
  function blankReview() {
    activeReview=null;++reviewGeneration;revisedTextTouched=false;revisedConditionsTouched=false;
    q("research-review-id").value = "";
    q("research-blind").value = "";
    q("research-reference").value = "";
    for(const id of ["research-analysis","research-branch-url","research-review-reason","research-revised-text","research-revised-conditions"])if(q(id))q(id).value="";
  }
  function option(r){ return new Option((r.current?.text || r.conclusion.id).slice(0,78),r.conclusion.id); }
  async function refresh(){
    const projectId=pid(),ticket=++request;if(!projectId){data=null;say("先创建课题并采纳结论，再记录依赖。 ");return;}
    try {
      const next=await send({type:"EV_RESEARCH_LIST",projectId});if(ticket!==request||pid()!==projectId)return;
      if(data?.project?.evidenceRevision!==next.project.evidenceRevision&&q("research-proposals").childElementCount){q("research-proposals").replaceChildren();say("结论范围已变化，旧建议已清除；请重新生成并预览。");}
      data=next;if(!data.rows.some(r=>r.conclusion.id===current))current=data.rows[0]?.conclusion.id;render();
    }catch(e){if(ticket!==request)return;data=null;q("research-edges").replaceChildren();q("research-proposals").replaceChildren();say("依赖与复核不可用："+e.message,true);}
  }
  async function exclusive(action){
    if(writing){say("上一项操作正在保存，请稍候。 ");return;}
    writing=true;q("research-workbench").setAttribute("aria-busy","true");
    try{return await action();}finally{writing=false;q("research-workbench").removeAttribute("aria-busy");}
  }
  async function reasonFor(title,action){
    const projectId=pid();
    await ThreadLineDialogs.form({title,description:"这个判断会保留在当前关系的历史中。",submitLabel:title,fields:[{name:"reason",label:"理由",type:"textarea",required:true,maxPoints:2000}],onSubmit:async values=>{
      if(projectId!==pid())throw Error("课题已变化，请重新核对");
      const result=await command({...action,reason:values.reason});if(!result)throw Error("操作未保存，请查看工作台提示");return result;
    }});
  }
  function drawGraph(target, edges) {
    const host = q("research-graph");
    host.replaceChildren();
    if (!target || !edges.length) {
      host.textContent = "当前结论尚未记录依赖。";
      return;
    }
    const ids = [...new Set(edges.flatMap(edge => [edge.upstreamConclusionId, edge.downstreamConclusionId]))];
    const shown = ids.slice(0,20);
    const height = Math.max(96, shown.length * 34 + 24);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 560 ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "当前结论的一跳依赖图");
    const defs=document.createElementNS("http://www.w3.org/2000/svg","defs"),marker=document.createElementNS("http://www.w3.org/2000/svg","marker"),arrow=document.createElementNS("http://www.w3.org/2000/svg","path");
    marker.setAttribute("id","research-arrow");marker.setAttribute("viewBox","0 0 10 10");marker.setAttribute("refX","18");marker.setAttribute("refY","5");marker.setAttribute("markerWidth","6");marker.setAttribute("markerHeight","6");marker.setAttribute("orient","auto");arrow.setAttribute("d","M 0 0 L 10 5 L 0 10 z");arrow.setAttribute("fill","#667f9b");marker.append(arrow);defs.append(marker);svg.append(defs);
    const positions = new Map(shown.map((id, index) => [id, {
      x: id === target.conclusion.id ? 280 : (index % 2 ? 470 : 90),
      y: id === target.conclusion.id ? height / 2 : 28 + index * 34
    }]));
    edges
      .filter(edge => positions.has(edge.upstreamConclusionId) && positions.has(edge.downstreamConclusionId))
      .forEach(edge => {
        const upstream = positions.get(edge.upstreamConclusionId);
        const downstream = positions.get(edge.downstreamConclusionId);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        line.setAttribute("d", `M ${upstream.x} ${upstream.y} L ${downstream.x} ${downstream.y}`);
        line.setAttribute("stroke", "#7a8ca3");line.setAttribute("marker-end","url(#research-arrow)");
        svg.append(line);
      });
    for (const id of shown) {
      const position = positions.get(id);
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      circle.setAttribute("cx", position.x);
      circle.setAttribute("cy", position.y);
      circle.setAttribute("r", id === target.conclusion.id ? 19 : 14);
      circle.setAttribute("fill", id === target.conclusion.id ? "#2868a5" : "#dbe7f4");
      label.setAttribute("x", position.x);
      label.setAttribute("y", position.y + 28);
      label.setAttribute("text-anchor", "middle");
      label.textContent = (row(id)?.current?.text || id).slice(0,15);
      const group=document.createElementNS("http://www.w3.org/2000/svg","g"),title=document.createElementNS("http://www.w3.org/2000/svg","title");
      group.setAttribute("role","button");group.setAttribute("tabindex","0");group.setAttribute("aria-label","查看结论："+(row(id)?.current?.text||id));title.textContent=row(id)?.current?.text||id;group.append(title,circle,label);
      const choose=()=>{current=id;blankReview();render();q("research-target").focus();};group.addEventListener("click",choose);group.addEventListener("keydown",event=>{if(["Enter"," "].includes(event.key)){event.preventDefault();choose();}});svg.append(group);
    }
    host.append(svg);
    if (ids.length > shown.length) {
      host.append(el("p", {className:"subtle"}, `图中显示前 ${shown.length} 项，关系列表保留全部 ${ids.length} 项。`));
    }
  }
  function render(){
    if(!data)return; const target=active(), selects=[q("research-target"),q("research-upstream"),q("research-downstream")];
    const priorUp=q("research-upstream").value,priorDown=q("research-downstream").value;
    selects.forEach(s=>{s.replaceChildren();data.rows.filter(r=>s===q("research-target")||r.conclusion.status!=="withdrawn").forEach(r=>s.add(option(r)));});
    if(data.rows.some(r=>r.conclusion.id===priorUp))q("research-upstream").value=priorUp;
    if(data.rows.some(r=>r.conclusion.id===priorDown))q("research-downstream").value=priorDown;
    if(target){current=target.conclusion.id;q("research-target").value=current;if(!priorDown)q("research-downstream").value=current;}
    const edges=(data.edges||[]).filter(e=>e.status!=="removed"&&(e.upstreamConclusionId===current||e.downstreamConclusionId===current)),list=q("research-edges"); list.replaceChildren();
    for(const edge of edges){
      const up=row(edge.upstreamConclusionId)?.current?.text||edge.upstreamConclusionId,down=row(edge.downstreamConclusionId)?.current?.text||edge.downstreamConclusionId;
      const li=el("li",{},`${up} → ${down}`);li.append(el("p",{className:"subtle"},edge.reason||"待核对"));
      const confirm=el("button",{type:"button",className:"secondary"},"确认已对照版本"),remove=el("button",{type:"button",className:"secondary"},"移除关系");
      confirm.onclick=()=>reasonFor("确认已对照当前版本",{kind:"confirmDependency",edgeId:edge.id,upstreamVersionId:edge.upstreamVersionId,downstreamVersionId:edge.downstreamVersionId});
      remove.onclick=()=>reasonFor("移除关系",{kind:"removeDependency",edgeId:edge.id});li.append(confirm,remove);list.append(li);
    }
    if(!edges.length)list.append(el("li",{},"没有已登记关系。未登记不表示没有依赖。"));
    const pending=(data.notifications||[]).flatMap(note=>note.affected.filter(target=>target.pending).map(target=>({note,target})));
    const queue=q("research-pending");queue.replaceChildren();
    queue.append(el("p",{},pending.length?`待核对 ${pending.length} 项（按变化原因计）` : "没有已登记关系产生的待核对通知；未登记依赖不在覆盖范围内。"));
    for(const {note,target:affected} of pending){
      const item=el("div",{},`${row(note.conclusionId)?.current?.text||note.conclusionId} 发生变化 → ${row(affected.conclusionId)?.current?.text||affected.conclusionId}`);
      item.append(el("p",{className:"subtle"},affected.causes.map(c=>c.path.map(id=>row(id)?.current?.text||id).join(" → ")).join("；")));
      const choose=el("button",{type:"button",className:"secondary"},"复核此结论");choose.onclick=()=>{current=affected.conclusionId;blankReview();render();q("research-review-panel").open=true;q("research-question").focus();};item.append(choose);queue.append(item);
    }
    q("research-history").textContent=JSON.stringify({events:data.research?.events||[],reviews:data.research?.reviews||[]},null,2);
    const history=q("research-reviews");history.replaceChildren();
    for(const review of data.research?.reviews||[]){const outcome=review.completions.at(-1),label=outcome?({keep:"保留",revise:"修订",withdraw:"撤回",inconclusive:"无法判断"}[outcome.outcome]+(outcome.stale?" · 已过期":"")):"未完成";const button=el("button",{type:"button",className:"secondary"},new Date(review.at).toLocaleDateString()+" · "+label);button.onclick=()=>{current=review.targetConclusionId;render();restoreReview(review);};history.append(button);}
    drawGraph(target,edges);syncReviewControls();
  }
  async function command(command){
    if(!data?.project){say("请先采纳结论并刷新。",true);return null;}
    const projectId=pid(),expectedRevision=data.project.evidenceRevision;
    return exclusive(async()=>{try{const result=await send({type:"EV_RESEARCH_COMMAND",projectId,expectedRevision,command,operationId:op("op_research_")});await refresh();say("关系已保存。人工确认仅适用于本次核对的版本。");window.dispatchEvent(new Event("threadline-evidence-changed"));return result;}
      catch(e){await refresh();say("未保存："+e.message+"。输入已保留，请核对后重试。",true);return null;}});
  }
  async function prepare() {
    if(writing)return;
    const target = active();
    const question = q("research-question").value.trim();
    if (!target || !question) {
      say("请选择结论并填写独立核对问题", true);
      return;
    }
    blankReview();
    writing=true;syncReviewControls();
    const projectId=pid(),targetId=target.conclusion.id,generation=reviewGeneration;
    try {
      const response = await send({
        type: "EV_REVIEW_PREPARE",
        projectId,
        targetConclusionId: target.conclusion.id,
        question,
        expectedRevision: data.project?.evidenceRevision,
        operationId: op("op_review_")
      });
      if(projectId!==pid()||targetId!==current||generation!==reviewGeneration)return;
      const materials = response.review?.blindMaterials || [];
      q("research-blind").value = typeof materials === "string"
        ? materials
        : JSON.stringify({question,materials}, null, 2);
      activeReview=response.review; q("research-review-id").value = response.review?.id || "";
      if (Number.isSafeInteger(response.revision)) {
        data.project.evidenceRevision = response.revision;
      }
      say("已冻结独立核对材料。先独立分析，再按需查看旧结论。");
    } catch (error) {
      say("无法准备复核：" + error.message, true);
    } finally {writing=false;syncReviewControls();}
  }
  async function reference() {
    const projectId=pid(),reviewId=q("research-review-id").value,generation=reviewGeneration,targetId=current;
    if(!reviewId)return;
    try {
      const response=await send({type:"EV_REVIEW_REFERENCE",projectId,reviewId});
      if(projectId!==pid()||reviewId!==q("research-review-id").value||generation!==reviewGeneration||targetId!==current)return;
      q("research-reference").value=`${response.text||""}\n\n适用条件：${response.conditions||""}`;
      if(!revisedTextTouched)q("research-revised-text").value=response.text||"";
      if(!revisedConditionsTouched)q("research-revised-conditions").value=response.conditions||"";
    }catch(error){if(generation===reviewGeneration)say("无法读取旧结论："+error.message,true);}
  }
  async function complete() {
    if(writing)return;writing=true;syncReviewControls();
    const generation=reviewGeneration,projectId=pid();
    try {
      const reason = q("research-review-reason").value.trim();
      const outcome = q("research-outcome").value;
      const reviewId = q("research-review-id").value;
      if (!reviewId || !reason) {
        throw Error("请先准备复核并填写理由");
      }
      const payload = {
        type: "EV_REVIEW_COMPLETE",
        projectId: pid(),
        reviewId,
        outcome,
        reason,
        analysis:q("research-analysis").value,branchUrl:q("research-branch-url").value,
        expectedRevision: data.project?.evidenceRevision,
        operationId: op("op_review_")
      };
      if (outcome === "revise") {
        payload.text = q("research-revised-text").value;
        if(revisedConditionsTouched)payload.conditions=q("research-revised-conditions").value;
      }
      const response = await send(payload);
      if(generation!==reviewGeneration||projectId!==pid())return;
      await refresh();
      if(generation!==reviewGeneration||projectId!==pid())return;
      q("research-review-id").value="";
      say(response.stale
        ? "复核材料已过期，仅作为历史保留；未改变当前结论。"
        : "复核结果已记录。");
    } catch (error) {
      say("复核未完成：" + error.message, true);
    } finally {writing=false;syncReviewControls();}
  }
  async function promptForDeps(){try{const r=await send({type:"EV_DEPENDENCY_PROMPT",projectId:pid()});await navigator.clipboard.writeText(r.prompt||"");say("已复制包含结论文本的 AI 建议提示词；粘贴返回 JSON 后仍须逐项确认。范围哈希："+(r.scopeHash||"未知"));}catch(e){say("无法生成提示词："+e.message,true);}}
  async function preview(){
    const projectId=pid(),revision=data?.project?.evidenceRevision;
    try{const result=await send({type:"EV_SUGGESTIONS_PREVIEW",projectId,json:q("research-suggestions").value});if(projectId!==pid()||revision!==data?.project?.evidenceRevision)throw Error("结论范围已变化，请重新预览");
      const host=q("research-proposals");host.replaceChildren();
      for(const proposal of result.proposals||[]){const button=el("button",{type:"button",className:"secondary"},"确认此条关系");button.onclick=()=>{if(projectId!==pid()||revision!==data?.project?.evidenceRevision){host.replaceChildren();say("此建议已过期，请重新预览。",true);return;}command({kind:"addDependency",upstreamConclusionId:proposal.upstreamConclusionId,downstreamConclusionId:proposal.downstreamConclusionId,upstreamVersionId:proposal.upstreamVersionId,downstreamVersionId:proposal.downstreamVersionId,reason:proposal.reason});};host.append(el("p",{},`${row(proposal.upstreamConclusionId)?.current?.text} → ${row(proposal.downstreamConclusionId)?.current?.text}：${proposal.reason}`),button);}
      if(!result.proposals.length)host.append(el("p",{className:"subtle"},"没有可确认的候选关系，没有写入。"));
    }catch(e){say("建议预览失败："+e.message,true);}
  }
  function mount(){
    const host=q("evidence-section");if(!host||q("research-workbench"))return; const box=el("details",{id:"research-workbench",className:"research-workbench"});box.append(el("summary",{},"依赖、变化与局部复核"));
    const body=el("div",{});body.innerHTML=`<p class="subtle">只显示当前结论的一跳关系。依赖、复核和 AI 建议均需人工确认，不自动发送或改写结论。</p><button id="research-refresh" type="button" class="secondary">刷新依赖与复核</button><label>当前结论 <select id="research-target"></select></label><div id="research-graph"></div><div id="research-pending" class="subtle"></div><ul id="research-edges"></ul><label>上游结论 <select id="research-upstream"></select></label><label>下游结论 <select id="research-downstream"></select></label><label>必要前提理由 <input id="research-reason"/></label><button id="research-add" type="button">登记人工确认的依赖</button><details><summary>完整依赖与复核历史</summary><pre id="research-history" class="subtle"></pre></details><div id="research-reviews"></div><details id="research-review-panel"><summary>局部复核：冻结材料、独立分析与记录结果</summary><label>独立复核问题 <input id="research-question"/></label><button id="research-prepare" type="button">冻结独立核对材料</button><textarea id="research-blind" rows="6" readonly aria-label="独立核对材料"></textarea><button id="research-copy-blind" type="button" class="secondary">复制独立核对材料</button><button id="research-reference-btn" type="button" class="secondary">查看旧结论</button><textarea id="research-reference" rows="4" readonly aria-label="旧结论参考"></textarea><input id="research-review-id" type="hidden"/><label>独立分析结果 <textarea id="research-analysis" rows="4"></textarea></label><label>复核对话链接（可选）<input id="research-branch-url" type="url"/></label><label>复核结果 <select id="research-outcome"><option value="keep">保留</option><option value="revise">修订</option><option value="withdraw">撤回</option><option value="inconclusive">无法判断</option></select></label><label>理由 <textarea id="research-review-reason" rows="2"></textarea></label><label>修订正文（仅“修订”使用）<textarea id="research-revised-text" rows="3"></textarea></label><label>修订后的适用条件（仅“修订”使用）<textarea id="research-revised-conditions" rows="2"></textarea></label><button id="research-complete" type="button">记录复核结果</button></details><details id="research-ai-panel"><summary>AI 依赖建议（逐条确认）</summary><p class="subtle">复制提示词会将当前结论文本写入剪贴板；不会自动发送。</p><button id="research-prompt" type="button" class="secondary">复制 AI 依赖建议提示词</button><label>粘贴建议 JSON（仅预览）<textarea id="research-suggestions" rows="4"></textarea></label><button id="research-preview" type="button" class="secondary">预览建议</button><div id="research-proposals"></div></details><p id="research-notice" role="status" class="subtle"></p>`;
    box.append(body);host.append(box);q("research-refresh").onclick=refresh;q("research-revised-text").addEventListener("input",()=>revisedTextTouched=true);q("research-revised-conditions").addEventListener("input",()=>revisedConditionsTouched=true);q("research-target").onchange=e=>{current=e.target.value;blankReview();render();};q("research-add").onclick=()=>command({kind:"addDependency",upstreamConclusionId:q("research-upstream").value,downstreamConclusionId:q("research-downstream").value,upstreamVersionId:version(q("research-upstream").value),downstreamVersionId:version(q("research-downstream").value),reason:q("research-reason").value});q("research-prepare").onclick=prepare;q("research-reference-btn").onclick=reference;q("research-complete").onclick=complete;q("research-prompt").onclick=promptForDeps;q("research-preview").onclick=preview;q("research-copy-blind").onclick=()=>navigator.clipboard.writeText(q("research-blind").value).then(()=>say("已复制独立核对材料；粘贴到外部工具仍须由你决定。"),e=>say("复制失败："+e.message,true));window.addEventListener("threadline-evidence-changed",refresh);q("evidence-project")?.addEventListener("change",()=>{current=null;data=null;q("research-proposals").replaceChildren();blankReview();refresh();});syncReviewControls();refresh();
  }
  let refreshTimer;
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local"&&changes["tl_evidence_summary_"+pid()]){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,80);}});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
})();
