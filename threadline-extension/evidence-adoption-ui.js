/* Shared explicit evidence-adoption dialog. Source excerpts are selected or
 * written by the user; the UI never truncates or invents source content. */
(()=>{
  "use strict";
  const pointCount=s=>Array.from(String(s||"")).length;
  const send=payload=>new Promise((resolve,reject)=>chrome.runtime.sendMessage(payload,r=>{if(chrome.runtime.lastError)return reject(Error(chrome.runtime.lastError.message));if(!r?.ok)return reject(Error(r?.error||"请求失败"));resolve(r.data);}));
  const el=(tag,attrs={},text="")=>{const n=document.createElement(tag);Object.assign(n,attrs);if(text)n.textContent=text;return n;};
  const labelled=(label,field)=>{const wrap=el("label",{},label);wrap.append(field);return wrap;};
  const relations=[["cites","引用"],["supports","支持"],["opposes","反对"],["background","背景"]];
  async function open(options) {
    if(!options || !Array.isArray(options.sources) || !options.sources.length)throw Error("没有可选择的原始消息，不能采纳");
    const snap=await send({type:"EV_PROJECTS"}),projects=(snap.projects||[]).filter(p=>p.stage==="active"&&!p.deleted&&!p.unavailable);if(!projects.length)throw Error(snap.error||"请先在研线面板创建进行中的课题");
    const dialog=el("dialog",{className:"evidence-adoption-dialog",ariaLabel:"采纳证据结论"});
    const style=el("style",{},`.evidence-adoption-dialog{width:min(760px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:22px}.evidence-adoption-dialog label{display:block;margin:12px 0;font-weight:600}.evidence-adoption-dialog textarea,.evidence-adoption-dialog select{display:block;width:100%;margin-top:5px;font:14px/1.5 system-ui}.evidence-adoption-source{border-top:1px solid #dce3ed;margin-top:12px;padding-top:10px}.evidence-adoption-source textarea[readonly]{background:#f4f7fa}.evidence-adoption-actions{display:flex;gap:10px;flex-wrap:wrap}`);
    dialog.append(style,el("h3",{},"采纳一条证据结论"),el("p",{className:"subtle"},"正文、依据和关系均由你确认。原始采集范围、AI 输入范围与依据选区是不同事实。"));
    const project=el("select",{id:"evidence-adopt-project"});projects.forEach(p=>project.add(new Option(p.name||p.id,p.id)));
    const text=el("textarea",{id:"evidence-adopt-text",rows:4,placeholder:"填写一条已核对的结论（最多 4,000 字符）"});text.value=options.text||"";
    const conditions=el("textarea",{id:"evidence-adopt-conditions",rows:2,placeholder:"适用条件（可选）"});dialog.append(labelled("课题",project),labelled("结论正文",text),labelled("适用条件",conditions));
    const sourceRows=el("div",{id:"evidence-adopt-sources"});dialog.append(el("h4",{},"依据片段（最多 8 条）"),sourceRows);const notice=el("p",{className:"subtle",role:"status"});
    function sourceRow(initial=0) {
      const row=el("section",{className:"evidence-adoption-source"}),select=el("select",{}),original=el("textarea",{rows:5,readOnly:true,ariaLabel:"原始消息全文"}),excerpt=el("textarea",{rows:4,placeholder:"从上方原始消息复制或选择并确认依据片段"}),relation=el("select",{}),useSelection=el("button",{type:"button",className:"secondary"},"使用上方选中文本"),remove=el("button",{type:"button",className:"secondary"},"移除此依据");
      options.sources.forEach((s,i)=>select.add(new Option(s.label||`消息 ${i+1}`,String(i))));select.value=String(initial);relations.forEach(([v,label])=>relation.add(new Option(label,v)));
      const setSource=()=>{const s=options.sources[Number(select.value)];original.value=s?.content||"";notice.textContent=(s?.coverage||"")+(s?.nonText?"；含非文本内容":"")+(s?.aiCoverage?"；AI 输入范围："+s.aiCoverage:"");};select.addEventListener("change",setSource);setSource();
      useSelection.addEventListener("click",()=>{const start=original.selectionStart,end=original.selectionEnd;if(start===end){notice.textContent="请先在原始消息全文中选中一段文本";return;}excerpt.value=original.value.slice(start,end);excerpt.dataset.start=String(start);excerpt.dataset.end=String(end);});remove.addEventListener("click",()=>{if(sourceRows.children.length>1)row.remove();});
      row.append(labelled("原始消息",select),labelled("原始消息全文（只读）",original),useSelection,labelled("依据片段",excerpt),labelled("关系",relation),remove);return row;
    }
    sourceRows.append(sourceRow());const add=el("button",{type:"button",className:"secondary"},"添加另一条依据");add.addEventListener("click",()=>{if(sourceRows.children.length>=8){notice.textContent="每条结论最多 8 个依据片段";return;}sourceRows.append(sourceRow());});
    const cancel=el("button",{type:"button",className:"secondary"},"取消"),save=el("button",{type:"button",className:"primary"},"确认采纳"),actions=el("div",{className:"evidence-adoption-actions"});actions.append(add,cancel,save);dialog.append(notice,actions);document.body.append(dialog);const close=()=>{dialog.close();dialog.remove();};cancel.addEventListener("click",close);
    save.addEventListener("click",async()=>{try{const body=text.value.trim();if(!body)throw Error("请填写结论正文");if(pointCount(body)>4000)throw Error("结论正文超过 4,000 字符");const selections=[...sourceRows.children].map(row=>{const fields=row.querySelectorAll("select, textarea"),chosen=options.sources[Number(fields[0].value)],excerpt=fields[2];if(!excerpt.value)throw Error("每条依据都必须填写并核对片段");return {source:chosen,selection:excerpt.value,selectionStart:excerpt.dataset.start===undefined?null:Number(excerpt.dataset.start),selectionEnd:excerpt.dataset.end===undefined?null:Number(excerpt.dataset.end),relation:fields[3].value};});save.disabled=true;notice.textContent="正在保存…";const result=await options.submit({projectId:project.value,text:body,conditions:conditions.value.trim(),selections});notice.textContent=result?.dedupe?"已存在相同采纳，未重复创建。":"已采纳。请在面板的“证据结论”中查看、导出或修订。";setTimeout(close,900);}catch(e){notice.textContent="采纳未完成："+e.message;save.disabled=false;}});
    dialog.showModal();text.focus();
  }
  globalThis.ThreadLineEvidenceAdoption={open};
})();
