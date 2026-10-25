/* Right-side capture view. DOM text is escaped through textContent, not interpreted as HTML. */
(()=>{
  const $=id=>document.getElementById(id);
  let tabs=[],currentId="",lastCompleted="",currentRun=null,brief=null,rulesBrief=null,messages=[],collapsed=new Set(),zoom=0.8,timer=0,watchBusy=false;
  let aiAbort=null;
  let organizing=false;
  let webHelperTabId=null;
  let linkedProjectId=null;
  const htmlEsc=s=>String(s??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
  function isTab(tab){return !!ThreadLineCaptureCore.conversationId(tab.url);}
  function showProgress(value,warn=false){const n=$("capture-progress");n.hidden=false;n.textContent=value;n.classList.toggle("warn",warn);}
  function showError(value){const n=$("capture-error");n.hidden=!value;n.textContent=value||"";}
  function reply(payload){return new Promise((resolve,reject)=>chrome.runtime.sendMessage(payload,r=>{if(chrome.runtime.lastError)return reject(new Error(chrome.runtime.lastError.message));if(!r?.ok)return reject(new Error(r?.error||"请求失败"));resolve(r.data);}));}
  async function loadTabs(){
    try{
      const all=await chrome.tabs.query({url:["https://chatgpt.com/*","https://chat.openai.com/*"]});tabs=all.filter(isTab).sort((a,b)=>Number(b.active)-Number(a.active)||a.index-b.index);
      const sel=$("capture-source"),previous=sel.value;
      if(document.activeElement===sel)return;
      sel.replaceChildren();
      if(!tabs.length){sel.add(new Option("没有打开的已保存 ChatGPT 对话",""));$("capture-start").disabled=true;return;}
      $("capture-start").disabled=false;
      for(const tab of tabs){const name=(tab.title||"未命名对话").replace(/\s*[-–|]\s*ChatGPT\s*$/i,"").trim();sel.add(new Option(`${tab.active?"● ":""}${name.slice(0,66)}（窗口 ${tab.windowId}）`,String(tab.id)));}
      if(tabs.some(t=>String(t.id)===previous))sel.value=previous;
      else{const active=tabs.find(t=>t.active);if(active)sel.value=String(active.id);}
    }catch(e){showError("无法读取浏览器标签页："+e.message);}
  }
  async function begin(){
    const tab=tabs.find(t=>String(t.id)===$("capture-source").value);if(!tab)return;
    if(currentRun?.status==="capturing")return;
    $("capture-start").disabled=true;$("capture-report").hidden=true;lastCompleted="";brief=null;messages=[];showError("");
    showProgress(`准备读取「${tab.title||"未命名"}」的历史…`);
    try{const result=await reply({type:"CAPTURE_START",tabId:tab.id});currentId=result.id;await poll(true);}
    catch(e){showError(e.message);showProgress("采集启动失败",true);$("capture-start").disabled=false;}
  }
  async function poll(force=false){
    if(watchBusy||!currentId)return;watchBusy=true;
    try {
      const run=await ThreadLineCaptureDB.getRun(currentId);if(!run)return;
      currentRun=run;
      if(run.status==="capturing"){
        showProgress(`正在逐页读取：已抓取 ${run.pageCount} 页，发现约 ${run.messageCount} 条消息。请保持源标签页打开。`);
        $("capture-start").disabled=true;
      }else if(run.status==="error"){
        showProgress("采集未完成",true);showError(run.error||"采集失败，请检查标签页和网络连接");$("capture-start").disabled=false;
      }else if(run.status==="done"){
        const coverage=run.complete?"历史文本已按网页接口返回完毕":"仅部分历史";
        showProgress(`采集结束：${run.pageCount} 页 / 约 ${run.messageCount} 条消息 · ${coverage}`,!run.complete);
        $("capture-start").disabled=false;
        if(lastCompleted!==run.id || force)await showReport(run);
        lastCompleted=run.id;
      }
    }catch(e){showError("读取采集结果失败："+e.message);}
    finally{watchBusy=false;}
  }
  function sourcesForCandidate(item){
    if(!currentRun)return [];
    const refs=Array.isArray(item.sources)?item.sources:(item.source?[item.source]:[]);
    const indexes=refs.map(n=>Number(String(n).replace(/^M/i,""))-1).filter(n=>Number.isInteger(n)&&n>=0&&messages[n]);
    // A candidate without a model/rule reference is not silently attached to a
    // summary. The user must choose an actual captured message in the dialog.
    const candidates=indexes.length?indexes:messages.map((_,n)=>n);
    return [...new Set(candidates)].slice(0,200).map(n=>{const m=messages[n];return {
      label:`M${n+1} · ${m.role||"未知"} · ${String(m.content||"").slice(0,80)}`,
      captureRunId:currentRun.id,messageIndex:n,coverage:currentRun.complete?"原始采集：分页完成":"原始采集：部分历史",
      content:m.content||"",nonText:!!m.hasNonText,aiCoverage:currentRun.aiCoverage?.complete?"本次采集全部文本":"未确认或部分",messageId:m.id||null
    };});
  }
  async function adoptCandidate(item){
    try { await ThreadLineEvidenceAdoption.open({text:item.text||item.content||"",sources:sourcesForCandidate(item),submit:form=>reply({
      type:"EV_ADOPT_CAPTURE",projectId:form.projectId,text:form.text,conditions:form.conditions,
      selections:form.selections.map(x=>({captureRunId:x.source.captureRunId,messageIndex:x.source.messageIndex,selection:x.selection,selectionStart:x.selectionStart,selectionEnd:x.selectionEnd,relation:x.relation})),
      operationId:"op_capture_adopt_"+crypto.randomUUID().replace(/-/g,"").slice(0,12)
    })}); }
    catch(e){$("report-promote-hint").textContent="无法采纳此条："+e.message;}
  }
  function row(title,items,adoptable=false){
    const host=document.createElement("section");host.className="digest-group";
    const h=document.createElement("h3");h.textContent=title;host.appendChild(h);
    const ul=document.createElement("ul");host.appendChild(ul);
    if(!items.length){const li=document.createElement("li");li.textContent="本次提取没有发现明确条目";ul.appendChild(li);}
    for(const item of items){const li=document.createElement("li");const t=document.createElement("span");t.textContent=item.text;li.appendChild(t);
      if(item.sources?.length){const src=document.createElement("span");src.className="source";src.textContent=` [模型引用 ${item.sources.map(n=>`M${n}`).join(", ")}]`;li.appendChild(src);}else if(item.source){const src=document.createElement("span");src.className="source";src.textContent=` [消息 ${item.source}]`;li.appendChild(src);}else if(brief?.mode==="ai"){const src=document.createElement("span");src.className="source";src.textContent=" [未提供来源编号，请手选原始消息]";li.appendChild(src);}
      if(adoptable){const btn=document.createElement("button");btn.type="button";btn.className="secondary";btn.textContent="采纳此条为证据结论";btn.addEventListener("click",()=>adoptCandidate(item));li.appendChild(btn);}ul.appendChild(li);
    }
    return host;
  }
  async function showReport(run){
    const pages=await ThreadLineCaptureDB.pages(run.id);
    messages=ThreadLineCaptureCore.assemble(pages);
    let p=null;
    try {const snapshot=await reply({type:"SNAPSHOT"});const c=snapshot.state.chats[`chat:${run.conversationId}`];p=c?snapshot.state.projects.find(x=>x.id===c.projectId):null;}catch{}
    linkedProjectId=p?.id||null;
    $('report-promote-state').hidden=!(run.aiReport&&linkedProjectId&&p?.stage==='active');
    if(promoteDraft?.runId!==run.id)cancelPromote();
    rulesBrief=ThreadLineCaptureCore.digest(messages,{title:run.title,complete:run.complete,url:run.url,tabId:run.tabId,projectName:p?.name,projectId:p?.id,projectStage:p?.stage,projectDecision:p?.decision});
    brief=run.aiReport?ThreadLineAI.toBrief(run.aiReport,rulesBrief,run.aiProvider||"manual"):rulesBrief;
    $("capture-report").hidden=false;
    $("report-title").textContent=brief.title;
    $("report-meta").textContent=`${messages.length} 条文本消息 · ${run.pageCount} 页 · ${run.mode||"未知来源"} · ${run.complete?"分页完成":"部分采集"}`;
    $("report-aim").textContent=(brief.mode==="ai"?"研究目标（AI 提取）：":"研究目标候选：")+brief.aim;
    const warn=$("report-warning");const text=[brief.projectStage==="closed"?`关联课题「${brief.projectName}」已收口。有效结论：${brief.projectDecision||"未填写"}。请勿因旧分支重新开始而误认为课题未完成。`:"",run.notice,brief.warning,brief.mode==="ai"?"AI 分析是未经独立核实的归纳；消息编号是模型提供的引用，需回源核查。即使模型建议收口，也不会自动改变课题状态。":"这是基于可读取文本的规则提取，条目可能来自被推翻的旧回答。"].filter(Boolean).join(" ");warn.hidden=!text;warn.textContent=text;
    const meta=$("report-ai-meta");meta.hidden=brief.mode!=="ai";
    if(brief.mode==="ai")meta.textContent=`已应用 AI 分析（${brief.aiProvider==="ollama"?"本地 Ollama":brief.aiProvider==="openai"?"OpenAI API":brief.aiProvider==="webui"?"ChatGPT 网页":"手动导入"}），最后更新 ${new Date(run.aiUpdatedAt||Date.now()).toLocaleString("zh-CN")}。${brief.aiProvider==="manual"?"手动导入；无法确认模型实际审阅范围":run.aiCoverage?.complete?"已发送本次采集的全部文本消息":"来源仅为部分采集记录"}。模型建议：${brief.closureAdvice?.recommendation==="closed"?"可考虑收口":brief.closureAdvice?.recommendation==="active"?"继续研究":"尚不能判断"}。该建议不会修改课题状态。`;
    $("ai-reset").hidden=brief.mode!=="ai";
    const holder=$("report-groups");holder.replaceChildren();
    if(brief.latestQuestion)holder.appendChild(row("最近的研究提问",[{text:brief.latestQuestion}]));
    holder.appendChild(row(brief.mode==="ai"?"关键结论（需核查）":"结论线索（需核查）",brief.conclusions,true));
    if(brief.mode==="ai")holder.appendChild(row("已完成的工作",brief.completed));
    holder.appendChild(row("未解决与证据缺口",brief.pending));
    if(brief.mode==="ai")holder.appendChild(row("已否定或被替代的方案",brief.superseded));
    holder.appendChild(row("下一步工作候选",brief.next));
    if(brief.mode==="ai"&&brief.closureAdvice?.reason)holder.appendChild(row("模型对收口状态的判断（仅供参考）",[{text:brief.closureAdvice.reason}]));
    updateRemoteUI(run);
    collapsed.clear();drawMap();
  }
  function updateRemoteUI(run){
    const input=$("report-project-name");
    if(input.dataset.runId!==run.id){input.dataset.runId=run.id;input.dataset.dirty="0";}
    if(input.dataset.dirty!=="1"&&document.activeElement!==input)input.value=ThreadLineOrganizeCore.projectName(brief);
    const p=run.remoteProject,a=run.archiveWeb;
    const sentences=[];
    if(p){
      const status={moved:"已在网页项目中确认移入",created_not_moved:"项目已创建，但未完成移入",creation_unverified:"项目创建结果尚未核实，避免重复点击",move_unverified:"已点击移入，但网页未确认最终状态"}[p.status]||"";
      sentences.push(`项目「${p.name||"未知"}」：${status}${p.error?`。${p.error}`:""}`);
    }
    if(a){const status={archived:"已检测到此对话从常规列表移除",submitted_unverified:"已点击归档，但结果尚待网页确认",failed:"归档未完成"}[a.status]||"";sentences.push(`${status}${a.error?`：${a.error}`:""}`);}
    const state=$("report-organize-status");state.textContent=sentences.join("\n")||"仅点击按钮后才会操作网页；不会自动删除对话，也不会自动改变课题收口状态。";
    state.classList.toggle("warn",!!(p&&p.status!=="moved")||!!(a&&a.status!=="archived"));
    $("report-create-project").textContent=p?.status==="created_not_moved"?"重试将对话移入已创建项目":"创建网页项目并移入此对话";
    $("report-create-project").disabled=organizing||["moved","creation_unverified","move_unverified"].includes(p?.status);
    $("report-archive").disabled=organizing||["archived","submitted_unverified"].includes(a?.status);
    $("report-open-source").hidden=!p&&!a;
  }
  let promoteDraft=null;
  async function promoteAnalysisToProject(){
    if(!currentRun?.aiReport || !brief || !linkedProjectId){aiStatus('请先完成 AI 分析并关联进行中的课题',true);return;}
    const candidate=(brief.conclusions||[])[0];
    if(!candidate){$('report-promote-hint').textContent='没有可采纳的结论候选';return;}
    await adoptCandidate(candidate);
  }
  function cancelPromote(){promoteDraft=null;$('promote-review').hidden=true;$('promote-review-check').checked=false;}
  async function savePromoted(){
    // Kept only for older panel markup. New flow is per-candidate adoption.
    cancelPromote();
    $('report-promote-hint').textContent='请使用候选条目旁的“采纳此条为证据结论”。';
  }
  async function remoteAction(action){
    if(!currentRun || currentRun.status!=="done")return;
    if(organizing){aiStatus("已有网页整理操作正在运行",true);return;}
    const runId=currentRun.id;
    const name=$("report-project-name").value.trim();
    if(action==="create_and_move"&&!ThreadLineOrganizeCore.validProjectName(name)){aiStatus("项目名必须为 2—80 个字符",true);return;}
    // When the selected source tab has changed, the service worker rejects the action.
    organizing=true;updateRemoteUI(currentRun);
    $("report-organize-status").textContent=action==="archive"?"正在操作来源对话的归档菜单…":"正在新建 ChatGPT 网页项目，并将源对话移入…";
    try{
      const result=await reply({type:"WEB_ORGANIZE",action,runId,tabId:currentRun.tabId,...(action==="create_and_move"?{name}:{})});
      const fresh=await ThreadLineCaptureDB.getRun(runId);
      if(fresh && currentId===runId){currentRun=fresh;updateRemoteUI(fresh);}
      const verified=action==="archive"?result.status==="archived":result.status==="moved";
      if(verified)aiStatus(action==="archive"?"已执行归档并在网页检测到状态变化。":"已创建或复用网页项目，并验证对话移入。网页项目与本地临时课题相互独立。");
      else aiStatus("网页已返回部分结果或无法确认最终状态，请打开来源对话检查，不会自动重试以避免重复创建。",true);
    }catch(e){
      const fresh=await ThreadLineCaptureDB.getRun(runId).catch(()=>null);
      if(fresh&&currentId===runId){currentRun=fresh;updateRemoteUI(fresh);}
      aiStatus("网页操作未完成："+e.message,true);
    }finally{organizing=false;if(currentRun?.id===runId)updateRemoteUI(currentRun);}
  }
  async function openSource(){
    if(!currentRun)return;
    try{
      const tab=await chrome.tabs.get(currentRun.tabId).catch(()=>null);
      if(tab&&ThreadLineOrganizeCore.allowedChatUrl(tab.url)){
        await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});return;
      }
      if(ThreadLineOrganizeCore.allowedChatUrl(currentRun.url))await chrome.tabs.create({url:currentRun.url,active:true});
    }catch(e){aiStatus("无法打开源对话："+e.message,true);}
  }
  function node(tag,classes,x,y,w,h,value,parent,opts={}){
    const n=document.createElement(tag);n.className="map-node "+classes;
    Object.assign(n.style,{left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`});
    n.textContent=value;
    if(opts.click){n.setAttribute("aria-expanded",String(!collapsed.has(opts.id)));n.title="展开或收起";n.addEventListener("click",opts.click);}
    parent.appendChild(n);return n;
  }
  function curve(svg,x1,y1,x2,y2){const el=document.createElementNS("http://www.w3.org/2000/svg","path");const mid=Math.round((x2-x1)*.55);el.setAttribute("d",`M ${x1} ${y1} C ${x1+mid} ${y1},${x2-mid} ${y2},${x2} ${y2}`);svg.appendChild(el);}
  function drawMap(){
    if(!brief)return;
    const groups=brief.mode==="ai"?ThreadLineAI.mapGroups(brief):ThreadLineCaptureCore.mapModel(brief);
    const rows=groups.map(g=>({...g,expanded:!collapsed.has(g.id),children:collapsed.has(g.id)?0:Math.min(4,g.items.length)}));
    const padding=30,leafGap=70;
    let y=padding;
    for(const r of rows){const height=Math.max(78,r.children*leafGap+12);r.top=y;r.h=height;r.mid=y+height/2;y+=height+22;}
    const H=Math.max(310,y+20),W=820,c=$("map-canvas");
    c.replaceChildren();c.style.width=W+"px";c.style.height=H+"px";c.style.zoom=String(zoom);
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.classList.add("map-lines");svg.setAttribute("width",W);svg.setAttribute("height",H);svg.setAttribute("viewBox",`0 0 ${W} ${H}`);c.appendChild(svg);
    node("div","root",12,H/2-35,160,70,brief.title,c);
    for(const group of rows){
      const groupY=group.mid-25;
      curve(svg,172,H/2,238,group.mid);
      node("button","group",238,groupY,150,50,`${group.expanded?"−":"＋"} ${group.label}`,c,{id:group.id,click:()=>{if(collapsed.has(group.id))collapsed.delete(group.id);else collapsed.add(group.id);drawMap();}});
      if(group.expanded){
        const count=group.children;
        for(let i=0;i<count;i++){
          const leafY=group.top+6+i*leafGap;
          curve(svg,388,group.mid,445,leafY+25);
          node("div","leaf",445,leafY,350,52,group.items[i],c);
        }
      }
    }
  }
  function modifyZoom(delta){zoom=Math.max(.5,Math.min(1.5,Math.round((zoom+delta)*10)/10));drawMap();}
  async function newChat(deep=false){
    if(!brief)return;
    const prompt=deep?ThreadLineCaptureCore.analysisPrompt(messages,brief,26000).text:ThreadLineCaptureCore.handoff(brief);
    if(!deep&&brief.projectStage==="closed"&&!confirm("关联课题已收口。是否仍然开启新对话？不会自动恢复已收口状态。"))return;
    if(deep&&!confirm("将采集到的部分文本预填到新 ChatGPT 对话，用于深度整理。不会自动发送。确定继续？"))return;
    try {
      const win=await chrome.windows.getCurrent();
      await reply({type:"NEW_CHAT",handoff:prompt,windowId:win.id,projectId:!deep&&brief.projectStage==="active"?brief.projectId:""});
      showProgress("新对话已打开。若未自动填入，请在新窗口点击“复制接续提示”。");
    }catch(e){showError("无法开启新对话："+e.message);}
  }
  async function clearCurrent(){
    if(!currentId||!confirm("清除这份对话采集的本地正文和提要？不会删除 ChatGPT 原始对话。"))return;
    try{await ThreadLineCaptureDB.remove(currentId);await chrome.storage.local.set({tl_last_capture_id:""});currentId="";currentRun=null;lastCompleted="";brief=null;rulesBrief=null;linkedProjectId=null;messages=[];$("capture-report").hidden=true;$("capture-progress").hidden=true;showError("");}
    catch(e){showError("无法清除："+e.message);}
  }
  async function copyDigest(){if(!brief)return;try{await navigator.clipboard.writeText(ThreadLineCaptureCore.handoff(brief));showProgress("提要已复制到剪贴板");}catch(e){showError("复制失败："+e.message);}}
  function aiStatus(value,isError=false){
    const el=$("ai-status");el.textContent=value||"";el.classList.toggle("warn",isError);
  }
  function selectedProvider(){return $("ai-provider").value;}
  function updateProvider(){
    const mode=selectedProvider();$("ai-auto-config").hidden=mode==="manual";
    $("ai-key-row").hidden=mode!=="openai";
    $("ai-run").textContent=mode==="webui"?"使用 ChatGPT 网页分析并更新导图":mode==="ollama"?"使用本机 Ollama 分析并更新导图":mode==="openai"?"使用 OpenAI API 分析并更新导图":"自动分析并更新导图";
    const model=$("ai-model");
    if(mode!=="manual"){
      if(mode==="webui"){$("ai-key-row").hidden=true;$("ai-model").parentElement.hidden=true;$("ai-endpoint-note").textContent="实验性网页方式：使用你已登录的 ChatGPT 标签页，自动提交提示并读取新回复。依赖网页结构及使用条款；每次分析需先确认。";return;}
      $("ai-model").parentElement.hidden=false;
      if(model.dataset.provider!==mode){model.value=ThreadLineProviders.defaults[mode];model.dataset.provider=mode;}
      $("ai-endpoint-note").textContent=mode==="ollama"?
        "使用 http://127.0.0.1:11434 的本机 Ollama。需单独安装、运行模型并允许浏览器扩展来源。":
        "直接调用 api.openai.com，产生 API 费用。Key 不保存；关闭侧栏后需重新输入。不是 ChatGPT Pro 订阅授权。";
    }
  }
  async function saveAI(runId,report,provider,coverage){
    const result=await ThreadLineCaptureDB.modifyRun(runId,{aiReport:report,aiProvider:provider,aiCoverage:coverage,aiUpdatedAt:Date.now()});
    if(!result)throw new Error("原采集记录已清除，无法保存 AI 结果");
    if(currentId===runId){currentRun=result;await showReport(result);lastCompleted=runId;}
  }
  async function analyzeWithProvider(){
    if(!currentRun||!rulesBrief||!messages.length){aiStatus("请先完成对话采集",true);return;}
    if(aiAbort){aiStatus("已有一项分析正在运行",true);return;}
    const kind=selectedProvider();if(kind==="manual"){aiStatus("请先选择 ChatGPT 网页自动分析，或复制结构化提示并手动导入结果。",true);return;}
    const model=$("ai-model").value,token=$("ai-api-key").value;
    if(kind!=="webui"){try{ThreadLineProviders.config(kind,model,token);}catch(e){aiStatus(e.message,true);return;}}
    const maxChars=kind==="ollama"?4900:kind==="webui"?5600:10500;
    let units;
    try{units=ThreadLineAI.segment(messages,{maxChars});}catch(e){aiStatus(e.message,true);return;}
    const estimated=units.chunks.length+ThreadLineAI.mergeRounds(units.chunks.length);
    if(kind==="webui"){
      if(estimated>8){aiStatus(`网页模式需要 ${estimated} 次连续请求，已停止。建议改用 Ollama 或官方 API 以减少网页干扰。`,true);return;}
      if(!confirm(`试验性 ChatGPT 网页自动分析将创建一个新标签页，自动发送约 ${estimated} 条提示并读取回答。可能消耗 ChatGPT 提问额度，也可能因网页变化而失败；此模式并非官方 API。确定继续？`))return;
    }else{
      if(estimated>6&&!confirm(`此次分析需约 ${estimated} 次模型请求，可能耗时并产生费用。所有已采集文本会发送到所选服务。确定开始？`))return;
      if(estimated<=6&&!confirm(`确认将当前采集的 ${units.nonemptyCount} 条对话文本发送给 ${kind==="ollama"?"本机 Ollama":"OpenAI API"} 分析？`))return;
      const host=kind==="ollama"?"http://127.0.0.1/*":"https://api.openai.com/*";
      try {
        const allowed=await chrome.permissions.request({origins:[host]});
        if(!allowed){aiStatus("未授权连接所选模型服务，研究内容未发送。",true);return;}
      }catch(e){aiStatus("无法申请模型服务访问权限："+e.message,true);return;}
    }
    const runId=currentId,copiedMessages=[...messages],complete=!!currentRun.complete;
    aiAbort=new AbortController();$("ai-run").disabled=true;$("ai-stop").hidden=false;
    const controller=aiAbort;
    let webSucceeded=false;
    try{
      if(kind==="webui"){
        const tab=await chrome.tabs.create({url:"https://chatgpt.com/",active:false});webHelperTabId=tab.id;
        const started=Date.now();let ready=false;
        while(Date.now()-started<26000){
          if(controller.signal.aborted)throw new Error("分析已取消");
          const check=await chrome.tabs.get(tab.id);
          if(check.status==="complete"){ready=true;break;}
          await new Promise(r=>setTimeout(r,300));
        }
        if(!ready)throw new Error("ChatGPT 分析标签页加载超时");
        await chrome.scripting.executeScript({target:{tabId:tab.id},files:["web-analyzer.js"]});
      }
      const result=await ThreadLineAI.analyze(copiedMessages,{
        maxChars,complete,signal:controller.signal,
        request:({instructions,prompt,signal})=>kind==="webui"?(async()=>{
          if(signal?.aborted)throw new Error("分析已取消");
          const answer=await chrome.tabs.sendMessage(webHelperTabId,{type:"TL_WEB_ASK",prompt:instructions+"\n\n"+prompt});
          if(signal?.aborted)throw new Error("分析已取消");
          if(!answer?.ok)throw new Error(answer?.error||"ChatGPT 网页分析失败");
          return answer.text;
        })():ThreadLineProviders.request({kind,model,token,instructions,prompt,signal}),
        progress:({step,total,stage})=>aiStatus(`${stage==="merge"?"合并各段研究结论":"正在读取各段证据"} · ${step}/${total} 次请求完成`)
      });
      if(controller.signal.aborted)throw new Error("分析已取消");
      if(!complete && result.report.closure.recommendation==="closed"){
        result.report.closure={recommendation:"unknown",reason:"来源历史采集不完整，不能仅凭本次资料判定整个课题已收口。"};
      }
      await saveAI(runId,result.report,kind,result.coverage);
      webSucceeded=true;
      aiStatus(`AI 整理已写回本地报告：${result.coverage.requests} 次模型请求，${result.coverage.analyzedMessages} 条消息。请核对关键来源编号。`);
    }catch(e){aiStatus("分析未完成："+e.message,true);}
    finally{
      if(kind==="webui" && webHelperTabId){
        // Successful helper tab is closed; unsuccessful one remains for inspection.
        if(webSucceeded)await chrome.tabs.remove(webHelperTabId).catch(()=>{});
        webHelperTabId=null;
      }
      if(aiAbort===controller)aiAbort=null;$("ai-run").disabled=false;$("ai-stop").hidden=true;
    }
  }
  async function importAI(raw){
    if(!currentRun||!messages.length){aiStatus("请先采集对话文本",true);return;}
    try{
      const report=ThreadLineAI.normalize(raw,messages.length);
      if(report.closure.recommendation==="closed"&&currentRun.complete===false){
        report.closure={recommendation:"unknown",reason:"源对话采集不完整，不能据此确定整体课题已收口。"};
      }
      await saveAI(currentId,report,"manual",{complete:!!currentRun.complete,analyzedMessages:null,totalMessages:messages.length,source:"manual-import-coverage-unverified"});
      aiStatus("导入成功。已自动更新研究摘要和思维导图；请注意 ChatGPT 手动分析可能未覆盖全部对话。" );
    }catch(e){aiStatus("导入失败："+e.message,true);}
  }
  async function copyAIPrompt(){
    if(!brief||!messages.length){aiStatus("请先采集一个对话",true);return;}
    try{
      const prompt=ThreadLineAI.importPrompt(messages,brief,27000);
      await navigator.clipboard.writeText(prompt.text);
      aiStatus(`结构化分析提示已复制。包含 ${prompt.included} 条消息${prompt.omitted?`，中间遗漏 ${prompt.omitted} 条。请在 ChatGPT 发送后，复制其 JSON 结果并导入。`:"，请复制 ChatGPT 的 JSON 回复并导入。"}`);
    }catch(e){aiStatus("复制失败："+e.message,true);}
  }
  async function importClipboard(){
    try{await importAI(await navigator.clipboard.readText());}
    catch(e){aiStatus("无法读取剪贴板："+e.message+"。可改为手动粘贴 JSON。",true);}
  }
  async function resetAnalysis(){
    if(!currentRun)return;
    try{const run=await ThreadLineCaptureDB.modifyRun(currentId,{aiReport:null,aiProvider:null,aiCoverage:null,aiUpdatedAt:null});
      if(run){currentRun=run;await showReport(run);aiStatus("已恢复为原始规则提要。课题状态未改变。");}
    }catch(e){aiStatus(e.message,true);}
  }
  async function startup(){
    $("report-project-name").addEventListener("input",()=>{$("report-project-name").dataset.dirty="1";});
    $("report-create-project").addEventListener("click",()=>remoteAction("create_and_move"));
    $("report-archive").addEventListener("click",()=>remoteAction("archive"));
    $("report-open-source").addEventListener("click",openSource);
    $('report-promote-state').addEventListener('click',promoteAnalysisToProject);
    $('promote-review-check').addEventListener('change',()=>{$('promote-review-save').disabled=!$('promote-review-check').checked;});
    $('promote-review-save').addEventListener('click',savePromoted);
    $('promote-review-cancel').addEventListener('click',cancelPromote);
    $("capture-start").addEventListener("click",begin);
    $("ai-provider").addEventListener("change",updateProvider);
    $("ai-run").addEventListener("click",analyzeWithProvider);
    $("ai-stop").addEventListener("click",()=>{aiAbort?.abort();if(webHelperTabId)chrome.tabs.sendMessage(webHelperTabId,{type:"TL_WEB_STOP"}).catch(()=>{});aiStatus("正在停止分析…");});
    $("ai-copy-prompt").addEventListener("click",copyAIPrompt);
    $("ai-import-clipboard").addEventListener("click",importClipboard);
    $("ai-import-manual").addEventListener("click",()=>importAI($("ai-json").value));
    $("ai-reset").addEventListener("click",resetAnalysis);
    updateProvider();
    $("report-new-chat").addEventListener("click",()=>newChat(false));
    $("report-ai").addEventListener("click",()=>newChat(true));
    $("report-copy").addEventListener("click",copyDigest);
    $("report-delete").addEventListener("click",clearCurrent);
    $("map-minus").addEventListener("click",()=>modifyZoom(-.1));
    $("map-plus").addEventListener("click",()=>modifyZoom(.1));
    $("map-reset").addEventListener("click",()=>{zoom=Math.max(.55,Math.min(1,($('map-scroll').clientWidth-24)/820));drawMap();});
    await loadTabs();
    try {await ThreadLineCaptureDB.cleanup();const record=await chrome.storage.local.get("tl_last_capture_id");currentId=record.tl_last_capture_id||"";if(currentId)await poll(true);}catch(e){showError(e.message);}
    timer=setInterval(()=>poll(),950);
    setInterval(loadTabs,8000);
    chrome.tabs.onCreated.addListener(loadTabs);chrome.tabs.onRemoved.addListener(loadTabs);
    chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.url||change.title)loadTabs();});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",startup,{once:true});else startup();
})();
