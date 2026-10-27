/* S0a trial recorder for human operators on a disposable, synthetic profile.
 * This never sends to ChatGPT, never self-approves a task, and never exports original text. */
(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const send=payload=>new Promise((resolve,reject)=>{
    chrome.runtime.sendMessage(payload,response=>{
      if(chrome.runtime.lastError)return reject(Error(chrome.runtime.lastError.message));
      if(!response?.ok)return reject(Error(response?.error||"后台无返回"));
      resolve(response.data);
    });
  });
  const notice=(text,isError=false)=>{
    $("ev-notice").textContent=text;$("ev-notice").dataset.error=String(isError);
  };
  const source="线上实测 K4 材料：线路A转化率3.2%，线路B转化率4.1%。";
  const excerpt="线路A转化率3.2%，线路B转化率4.1%。";
  let session=null,active=null,busy=false;
  window.__manualTrials=[];
  window.__manualSummary=()=>ThreadLineS0ATrials.summarize(window.__manualTrials);
  function summary() {
    const x=window.__manualSummary();
    $("ev-manual-summary").textContent=
      "任务记录 "+x.recordedCases+"/12；有效提交 "+x.eligibleCommitted+
      "；其中未求助 "+x.unassisted+"；非设计者操作 "+x.nonDesignerOperations+
      "；中位 "+(x.medianMs===null?"未知":Math.round(x.medianMs)+" ms")+
      "；P90 "+(x.p90Ms===null?"未知":Math.round(x.p90Ms)+" ms")+
      "。数字门槛："+(x.thresholdsMet?"达到，但仍需独立人工核查":"尚未达到或证据不足")+
      "。此处始终不会自动验收通过。";
  }
  function fixture(index) {
    const caseNumber=index+1,caseType=ThreadLineS0ATrials.TYPES[index];
    const initialText=caseType==="correct"
      ?"案例 "+caseNumber+"：线路A转化率4.1%，高于线路B的3.2%。"
      :"案例 "+caseNumber+"：线路B转化率4.1%，高于线路A的3.2%。";
    const instruction=caseType==="direct" ? "核对结论与依据，直接采纳。" :
      caseType==="correct" ? "原句把 A/B 数据写反，请依据原始材料修改正文后采纳。" :
      "目前缺少依据片段，请添加片段，引用下方原文后采纳。";
    return {caseNumber,caseType,initialText,instruction};
  }
  function displayFixture(row) {
    $("ev-text").value=row.initialText;
    $("ev-conditions").value="仅适用于本组合成数据";
    $("ev-fragments").replaceChildren();
    if(row.caseType!=="missing_source"){
      $("ev-add-fragment").click();
      const box=$("ev-fragments").querySelector(".frag");
      box.querySelector('[data-part="selection"]').value=excerpt;
      box.querySelector('[data-part="relation"]').value="supports";
      box.querySelector('[data-part="completeness"]').value="complete";
    }
    $("ev-manual-assist").checked=false;
    $("ev-manual-confirm").checked=false;
    $("ev-manual-instructions").textContent=
      "第 "+row.caseNumber+"/12 项（"+row.caseType+"）："+row.instruction+
      " 完成前请自行核对；接受过帮助必须勾选。";
    $("ev-manual-reference").textContent="虚构原始材料："+source;
  }
  function fragments() {
    return [...document.querySelectorAll("#ev-fragments .frag")].map(box=>{
      const read=name=>box.querySelector('[data-part="'+name+'"]').value;
      return {before:read("before"),selection:read("selection"),after:read("after"),
        relation:read("relation"),completeness:read("completeness"),kind:"manual"};
    });
  }
  function finish(outcome,extra={}) {
    if(!active)return;
    const row=active;
    window.__manualTrials.push({
      caseNumber:row.caseNumber,caseType:row.caseType,operatorCode:row.operatorCode,
      nonDesigner:row.nonDesigner,assisted:$("ev-manual-assist").checked,
      taskConfirmed:$("ev-manual-confirm").checked,outcome,
      elapsedMs:Math.round(performance.now()-row.startedMs),
      startedAt:row.startedAt,finishedAt:new Date().toISOString(),
      operationId:row.operationId,...extra
    });
    active=null;
    $("ev-manual-save").disabled=true;$("ev-manual-abandon").disabled=true;
    $("ev-adopt").disabled=false;
    $("ev-start-manual").disabled=window.__manualTrials.length>=12;
    $("ev-manual-operator").disabled=false;$("ev-manual-nondesign").disabled=false;
    $("ev-manual-instructions").textContent=window.__manualTrials.length>=12
      ?"12 项已记录；复制脱敏日志交独立人员核对，不能据此直接标为 S0A done。"
      :"第 "+row.caseNumber+" 项记录为 "+outcome+"；可以开始下一项。";
    $("ev-manual-reference").textContent="";
    summary();
  }
  $("ev-start-manual").addEventListener("click",async()=>{
    if(active||busy||window.__manualTrials.length>=12)return;
    if(!session&&$("ev-run-protocol").disabled){
      notice("自动基准仍在运行，请勿混入人工试次。",true);return;
    }
    const operatorCode=$("ev-manual-operator").value.trim();
    if(!ThreadLineS0ATrials.validOperator(operatorCode)){
      notice("请使用 2–16 位匿名操作代码，例如 P01；不要填写真实姓名。",true);return;
    }
    busy=true;$("ev-start-manual").disabled=true;
    try{
      if(!session){
        const id=crypto.randomUUID().replace(/-/g,"").slice(0,16);
        const projectId="proto-human-"+id;
        await send({type:"EV_ENSURE",projectId});
        const option=document.createElement("option");
        option.value=projectId;option.textContent="人工合成测试 "+id;
        $("ev-project").append(option);
        session={id,projectId};
        $("ev-run-protocol").disabled=true;
      }
      $("ev-project").value=session.projectId;
      $("ev-project").disabled=true;
      const row=fixture(window.__manualTrials.length);
      displayFixture(row);
      active={...row,operatorCode,nonDesigner:$("ev-manual-nondesign").checked,
        operationId:"op_s0ahuman_"+crypto.randomUUID().replace(/-/g,"").slice(0,20),
        startedAt:new Date().toISOString(),startedMs:performance.now()};
      $("ev-manual-operator").disabled=true;$("ev-manual-nondesign").disabled=true;
      $("ev-adopt").disabled=true;
      $("ev-manual-save").disabled=false;$("ev-manual-abandon").disabled=false;
      notice("已开始人工任务计时；从阅读材料至保存回执或放弃均计入。");
    }catch(error){notice("人工任务启动失败："+error.message,true);}
    finally{
      busy=false;
      if(!active&&window.__manualTrials.length<12)$("ev-start-manual").disabled=false;
    }
  });
  $("ev-manual-save").addEventListener("click",async()=>{
    if(!active||busy)return;
    const row=active,text=$("ev-text").value.trim(),parts=fragments();
    if(!text){notice("请填写结论正文后保存。",true);return;}
    if(row.caseType==="correct"&&text===row.initialText.trim()){
      notice("当前结论仍为故意写反的样例，请先修正再保存。",true);return;
    }
    if(!parts.length||parts.some(p=>!p.selection.trim()||!source.includes(p.selection.trim()))){
      notice("必须填写从虚构原始材料中实际摘录的依据；缺失依据不能成功。",true);return;
    }
    if(!$("ev-manual-confirm").checked){
      notice("请核对任务要求与原始依据，再勾选「已核对采纳结果」。",true);return;
    }
    busy=true;$("ev-manual-save").disabled=true;$("ev-manual-abandon").disabled=true;
    try{
      const saved=await send({type:"EV_ADOPT",projectId:session.projectId,text,
        conditions:$("ev-conditions").value,fragments:parts,operationId:row.operationId});
      if(!Number.isSafeInteger(saved.revision))throw Error("提交回执无修订号");
      finish("committed",{revision:saved.revision});
      $("ev-refresh").click(); // read-only list refresh from the authoritative DB
      notice("本项已收到持久化回执；仍需由独立人员确认任务完成质量。");
    }catch(error){
      // A lost receipt could follow a committed write: never automatically retry.
      finish("unknown",{errorKind:"WRITE_OR_ACK_UNKNOWN"});
      notice("写入失败或结果未知："+error.message+"。未自动重放；请核对权威库。",true);
    }finally{busy=false;}
  });
  $("ev-manual-abandon").addEventListener("click",()=>{
    if(!active||busy)return;
    finish("abandoned");
    notice("本项已记为放弃，不计入有效采纳。");
  });
  $("ev-copy-manual").addEventListener("click",async()=>{
    const payload={protocol:ThreadLineS0ATrials.VERSION,
      mode:"human_self_report",sessionId:session?.id||null,
      trials:window.__manualTrials,summary:window.__manualSummary(),
      at:new Date().toISOString(),excludesRawConversationAndEvidence:true,
      limitation:"虚构材料与操作者自报；须独立人工核验，不可自动完成 S0A。"};
    try{
      await navigator.clipboard.writeText(JSON.stringify(payload,null,2));
      notice("已复制脱敏人工日志；不包含结论正文、依据原文或真实对话。");
    }catch(error){notice("人工日志复制失败："+error.message,true);}
  });
  summary();
})();