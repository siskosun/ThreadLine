/* S4: frozen local review; the user controls every send and judgement. */
(() => {
  "use strict";
  const node=(tag,text="",cls="")=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
  const $=id=>document.getElementById(id),send=p=>new Promise((ok,no)=>chrome.runtime.sendMessage(p,r=>chrome.runtime.lastError?no(Error(chrome.runtime.lastError.message)):r?.ok?ok(r.data):no(Error(r?.error||"后台未确认"))));
  let seq=0,writing=false,active=null,scope=null,analysisTouched=false;
  const pid=()=>$("evidence-project")?.value||"";
  const op=()=> "op_s4_"+crypto.randomUUID().replace(/-/g,"");
  const say=(message,bad=false)=>{const element=$("review-status");if(element){element.textContent=message;element.dataset.error=String(bad);}};
  function clear(){
    active=null;analysisTouched=false;
    for(const id of ["review-blind","review-reference","review-analysis","review-reason","review-revised","review-revised-conditions","review-url"])$(id).value="";
    $("review-complete").disabled=true;
  }
  function sync(){
    const options=$("review-target"),prior=options.value;options.replaceChildren();
    for(const row of scope?.rows||[]){
      if(row.conclusion.status==="withdrawn")continue;
      options.add(new Option((row.current?.text||row.conclusion.id).slice(0,100),row.conclusion.id));
    }
    if([...options.options].some(o=>o.value===prior))options.value=prior;
    const past=$("review-history");past.replaceChildren();
    for(const entry of scope?.research?.reviews||[]){
      const completion=entry.completions.at(-1);
      const button=node("button",(entry.targetConclusionId===options.value?"本结论 · ":"其他结论 · ")+
        (completion?(completion.stale?"已过期复核":"已完成复核"):"待完成复核"),"secondary");
      button.type="button";
      button.onclick=()=>show(entry);
      past.append(button);
    }
    $("review-prepare").disabled=!options.value||writing;
  }
  function show(review){
    active=review;analysisTouched=false;
    $("review-blind").value=JSON.stringify(review.blindMaterials,null,2);
    $("review-reference").value="";
    $("review-analysis").value=review.completions.at(-1)?.analysis||"";
    $("review-reason").value=review.completions.at(-1)?.reason||"";
    $("review-complete").disabled=!!review.completions.length;
    $("review-outcome").value=review.completions.at(-1)?.outcome||"keep";
    say(review.completions.length?"此复核已形成历史记录，不允许重复提交。":"冻结材料已载入，先独立分析，再查看旧结论。");
  }
  async function refresh(){
    const id=pid(),ticket=++seq;if(!id)return;
    try{
      const data=await send({type:"EV_RESEARCH_LIST",projectId:id});
      if(id!==pid()||ticket!==seq)return;
      scope=data;sync();
    }catch(e){if(ticket===seq)say("复核数据读取失败："+e.message,true);}
  }
  async function prepare(){
    if(writing||!scope)return;writing=true;
    const id=pid(),expectedRevision=scope.project.evidenceRevision,question=$("review-question").value.trim();
    try{
      if(!question)throw Error("请说明复核问题");
      const result=await send({type:"EV_REVIEW_PREPARE",projectId:id,expectedRevision,
        targetConclusionId:$("review-target").value,question,operationId:op()});
      if(id!==pid()){say("课题已切换；新复核保存在原课题历史。",true);return;}
      await refresh();show(result.review);window.dispatchEvent(new Event("threadline-evidence-changed"));
    }catch(e){say("准备复核失败："+e.message,true);}
    finally{writing=false;}
  }
  async function reference(){
    if(!active)return;
    const id=pid(),review=active.id;
    try{
      if(!analysisTouched&&!$("review-analysis").value.trim()){
        if(!confirm("还未登记独立分析。现在查看旧结论可能影响独立判断，仍要继续吗？"))return;
      }
      const result=await send({type:"EV_REVIEW_REFERENCE",projectId:id,reviewId:review});
      if(id===pid()&&active?.id===review)$("review-reference").value=result.text+
        "\n适用条件："+(result.conditions||"");
    }catch(e){say("旧参考无法读取："+e.message,true);}
  }
  async function complete(){
    if(!active||writing||active.completions.length)return;
    if(!confirm("确认将人工核对结果保存为不可变历史？此操作不会自动发送到 ChatGPT。"))return;
    const id=pid(),reviewId=active.id,outcome=$("review-outcome").value;
    const payload={type:"EV_REVIEW_COMPLETE",projectId:id,reviewId,outcome,
      reason:$("review-reason").value.trim(),analysis:$("review-analysis").value,
      branchUrl:$("review-url").value.trim(),
      expectedRevision:scope.project.evidenceRevision,operationId:op()};
    if(outcome==="revise"){
      payload.text=$("review-revised").value;
      if($("review-revised-conditions").value.trim())payload.conditions=$("review-revised-conditions").value;
    }
    if(!payload.reason){say("必须说明核查理由",true);return;}
    writing=true;$("review-complete").disabled=true;
    try{
      const result=await send(payload);
      if(id!==pid())return;
      await refresh();window.dispatchEvent(new Event("threadline-evidence-changed"));
      const updated=scope?.research?.reviews?.find(x=>x.id===reviewId);if(updated)show(updated);
      // Reloading the completed record also resets explanatory text. Keep the
      // explicit success/stale verdict as the last accessible status update.
      say(result.stale?"原资料已变化：复核仅保留历史，没有改写现行结论。":"复核结果已保存，已记录适用的必要关系版本。",!!result.stale);
    }catch(e){say("复核提交未确认："+e.message,true);}
    finally{writing=false;$("review-complete").disabled=!!active?.completions?.length;}
  }
  function mount(){
    const host=$("evidence-section");if(!host||$("review-workbench"))return;
    const box=node("details");box.id="review-workbench";box.className="manage-accordion";
    box.append(node("summary","局部复核（冻结材料）"));
    const body=node("div");
    const intro=node("p","只核对一个结论及其已登记必要前提。先冻结原始依据并独立分析，再记录人工结论；旧材料变化时不会改写当前判断。","subtle");
    const target=node("select");target.id="review-target";target.setAttribute("aria-label","复核结论");
    const question=node("textarea");question.id="review-question";question.rows=2;question.placeholder="本次需要独立核对的具体问题";
    const prepareButton=node("button","冻结核对材料","secondary");prepareButton.type="button";prepareButton.id="review-prepare";
    const blind=node("textarea");blind.id="review-blind";blind.rows=7;blind.readOnly=true;blind.setAttribute("aria-label","已冻结原始核查材料");
    const copyButton=node("button","复制独立核查材料","secondary");copyButton.type="button";
    const referenceButton=node("button","查看冻结的旧结论","secondary");referenceButton.type="button";
    const reference=node("textarea");reference.id="review-reference";reference.rows=4;reference.readOnly=true;
    const analysis=node("textarea");analysis.id="review-analysis";analysis.rows=5;analysis.placeholder="独立分析结果；不等于模型已经核实事实";
    const link=node("input");link.id="review-url";link.type="url";link.placeholder="https:// （可选）";
    const outcome=node("select");outcome.id="review-outcome";
    for(const [value,label] of [["keep","保留"],["revise","修订"],["withdraw","撤回"],["inconclusive","证据不足"]])outcome.add(new Option(label,value));
    const reason=node("textarea");reason.id="review-reason";reason.rows=2;
    const revised=node("textarea");revised.id="review-revised";revised.rows=3;
    const conditions=node("textarea");conditions.id="review-revised-conditions";conditions.rows=2;
    const completeButton=node("button","确认并保存复核结果","secondary");completeButton.type="button";completeButton.id="review-complete";completeButton.disabled=true;
    const history=node("div");history.id="review-history";
    const status=node("p");status.id="review-status";status.setAttribute("role","status");
    const field=(title,control)=>{const label=node("label",title);label.append(control);return label};
    body.append(intro,field("目标结论",target),field("独立复核问题",question),prepareButton,
      field("冻结来源材料",blind),copyButton,referenceButton,field("旧结论（仅供复核后参考）",reference),
      field("独立分析",analysis),field("复核会话链接（可选）",link),field("复核结果",outcome),
      field("判断理由",reason),field("修订正文（选择修订时必填）",revised),
      field("修订条件（留空代表保留原条件）",conditions),completeButton,
      node("h4","历史复核"),history,status);
    box.append(body);host.append(box);
    box.addEventListener("toggle",()=>{if(box.open)refresh()});
    $("evidence-project")?.addEventListener("change",()=>{++seq;scope=null;clear();if(box.open)refresh()});
    window.addEventListener("threadline-evidence-changed",()=>{if(box.open)refresh()});
    target.addEventListener("change",clear);
    analysis.addEventListener("input",()=>analysisTouched=true);
    prepareButton.onclick=prepare;referenceButton.onclick=reference;completeButton.onclick=complete;
    copyButton.onclick=()=>navigator.clipboard.writeText(blind.value).then(()=>say("已复制冻结材料，是否用于新对话由用户决定。"),e=>say("复制失败："+e.message,true));
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
})();
