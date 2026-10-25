/* Shared explicit evidence-adoption dialog.  It never derives or truncates a
 * source excerpt: the user selects a saved source and confirms editable text. */
(()=>{
  "use strict";
  const pointCount=s=>Array.from(String(s||"")).length;
  const send=payload=>new Promise((resolve,reject)=>chrome.runtime.sendMessage(payload,r=>{
    if(chrome.runtime.lastError)return reject(Error(chrome.runtime.lastError.message));
    if(!r?.ok)return reject(Error(r?.error||"请求失败"));resolve(r.data);
  }));
  function el(tag,attrs={},text="") { const n=document.createElement(tag);Object.assign(n,attrs);if(text)n.textContent=text;return n; }
  async function open(options) {
    if(!options || !Array.isArray(options.sources) || !options.sources.length) throw Error("没有可选择的原始消息，不能采纳");
    const snap=await send({type:"SNAPSHOT"}), projects=(snap.state?.projects||[]).filter(p=>p.stage!=="closed");
    if(!projects.length) throw Error("请先在研线面板创建进行中的课题");
    const dialog=el("dialog",{className:"evidence-adoption-dialog"});
    dialog.append(el("h3",{},"采纳一条证据结论"));
    dialog.append(el("p",{className:"subtle"},"正文和依据都由你确认；来源范围、完整性和模型输入范围不会互相替代。"));
    const project=el("select",{name:"projectId"});projects.forEach(p=>project.add(new Option(p.name||p.id,p.id)));
    const text=el("textarea",{rows:4,maxLength:4000,placeholder:"填写一条已核对的结论（最多 4,000 字符）"});
    const conditions=el("textarea",{rows:2,maxLength:1000,placeholder:"适用条件（可选）"});
    const source=el("select",{name:"source"});
    options.sources.forEach((s,i)=>source.add(new Option(s.label||`消息 ${i+1}`,String(i))));
    const excerpt=el("textarea",{rows:5,maxLength:16384,placeholder:"从选定消息中复制并核对依据片段"});
    const relation=el("select");["cites","supports","opposes","background"].forEach(v=>relation.add(new Option(v,v)));
    const notice=el("p",{className:"subtle",role:"status"});
    const sourceInfo=()=>{const s=options.sources[Number(source.value)];notice.textContent=(s?.coverage||"")+(s?.nonText?"；含非文本内容":"")+(s?.aiCoverage?"；AI 输入范围："+s.aiCoverage:"");};
    source.addEventListener("change",sourceInfo);sourceInfo();
    const fields=[["课题",project],["结论正文",text],["适用条件",conditions],["原始消息",source],["依据片段",excerpt],["关系",relation]];
    fields.forEach(([label,field])=>{const wrap=el("label",{},label);wrap.append(field);dialog.append(wrap);});dialog.append(notice);
    const cancel=el("button",{type:"button",className:"secondary"},"取消"), save=el("button",{type:"button",className:"primary"},"确认采纳");
    const actions=el("div",{className:"line"});actions.append(cancel,save);dialog.append(actions);document.body.append(dialog);
    const close=()=>{dialog.close();dialog.remove();};cancel.addEventListener("click",close);
    save.addEventListener("click",async()=>{try{
      const body=text.value.trim(), chosen=options.sources[Number(source.value)], selected=excerpt.value;
      if(!body)throw Error("请填写结论正文");if(pointCount(body)>4000)throw Error("结论正文超过 4,000 字符");
      if(!selected)throw Error("请填写并核对依据片段");if(!chosen)throw Error("请选择原始消息");
      save.disabled=true;notice.textContent="正在保存…";
      const result=await options.submit({projectId:project.value,text:body,conditions:conditions.value.trim(),selection:selected,relation:relation.value,source:chosen});
      notice.textContent=result?.dedupe?"已存在相同采纳，未重复创建。":"已采纳。请在面板的“证据结论”中查看、导出或修订。";
      setTimeout(close,900);
    }catch(e){notice.textContent="采纳未完成："+e.message;save.disabled=false;}});
    dialog.showModal();text.focus();
  }
  globalThis.ThreadLineEvidenceAdoption={open};
})();
