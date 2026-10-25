/* Explicit adoption with a stable retry identity and confirmed source coordinates. */
(() => {
  "use strict";
  const el=(tag,attrs={},text="")=>{const node=document.createElement(tag);Object.assign(node,attrs);node.textContent=text;return node;};
  const labelled=(text,field)=>{const label=el("label",{},text);label.append(field);return label;};
  const send=payload=>new Promise((resolve,reject)=>chrome.runtime.sendMessage(payload,response=>{
    if(chrome.runtime.lastError)return reject(Error(chrome.runtime.lastError.message));
    if(!response?.ok)return reject(Error(response?.error||"请求失败"));resolve(response.data);
  }));
  async function open(options){
    if(document.querySelector(".evidence-adoption-dialog"))throw Error("请先完成或取消已打开的采纳窗口");
    if(!options?.sources?.length)throw Error("没有可核对的原始消息，请先采集");
    const directory=await send({type:"EV_PROJECTS"}),projects=(directory.projects||[]).filter(p=>p.stage==="active"&&!p.deleted&&!p.unavailable);
    if(!projects.length)throw Error(directory.error||"请先在“对话切换 → 全部课题与管理”创建进行中的课题");
    return new Promise(resolve=>{
      const opener=document.activeElement,dialog=el("dialog",{className:"evidence-adoption-dialog"}),heading=el("h2",{id:"evidence-adopt-heading"},"采纳一条证据结论");
      dialog.setAttribute("aria-labelledby",heading.id);
      dialog.append(heading,el("p",{className:"subtle"},"核对正文与原始依据后保存。采纳不等于事实已经证实。"));
      const project=el("select",{id:"evidence-adopt-project"});projects.forEach(p=>project.add(new Option(p.name||p.id,p.id)));
      const preferred=options.projectId||document.getElementById("evidence-project")?.value;if(projects.some(p=>p.id===preferred))project.value=preferred;
      const text=el("textarea",{id:"evidence-adopt-text",rows:4,placeholder:"一条可独立使用的重要结论，最多 4,000 字符"});text.value=options.text||"";
      const conditions=el("textarea",{id:"evidence-adopt-conditions",rows:2,placeholder:"例如适用时间、范围或尚未核实的限制（可选）"});
      const counter=el("small",{},"");const count=()=>counter.textContent=Array.from(text.value).length.toLocaleString()+" / 4,000 字符";text.addEventListener("input",count);count();
      dialog.append(labelled("保存到课题",project),labelled("结论正文",text),counter,labelled("适用条件",conditions),el("h3",{},"核对依据"));
      const sources=el("div",{id:"evidence-adopt-sources"}),status=el("p",{role:"status",className:"tl-form-status"});status.setAttribute("aria-live","polite");
      function sourceRow(){
        const row=el("section",{className:"evidence-adoption-source"}),select=el("select"),original=el("textarea",{rows:5,readOnly:true,ariaLabel:"原始消息全文"}),excerpt=el("textarea",{rows:3,ariaLabel:"依据片段",placeholder:"粘贴唯一片段，或在上方选中文字后点击“使用上方选中文本”"}),relation=el("select");
        options.sources.forEach((s,i)=>select.add(new Option(s.label||"原始消息 "+(i+1),String(i))));
        for(const [value,label] of [["cites","引用"],["supports","支持"],["opposes","反对"],["background","背景"]])relation.add(new Option(label,value));
        const coverage=el("small"),pick=el("button",{type:"button",className:"secondary"},"使用上方选中文本"),remove=el("button",{type:"button",className:"secondary"},"移除此依据");
        const reset=()=>{const source=options.sources[Number(select.value)];original.value=source.content||"";excerpt.value="";delete excerpt.dataset.start;delete excerpt.dataset.end;coverage.textContent=[source.coverage,source.nonText?"含非文本内容，文本片段可能不完整":"",source.aiCoverage?"AI 输入范围："+source.aiCoverage:""].filter(Boolean).join("；");};
        select.addEventListener("change",reset);reset();
        excerpt.addEventListener("input",()=>{delete excerpt.dataset.start;delete excerpt.dataset.end;});
        pick.onclick=()=>{const start=original.selectionStart,end=original.selectionEnd;if(start===end){status.textContent="请先在原始消息全文中选中一段文字";original.focus();return;}excerpt.value=original.value.slice(start,end);excerpt.dataset.start=String(start);excerpt.dataset.end=String(end);status.textContent="已使用所选片段，请确认内容和关系。";};
        remove.onclick=()=>{if(sources.children.length===1){status.textContent="至少保留一条依据";return;}row.remove();};
        row.append(labelled("原始消息",select),coverage,labelled("原始消息全文（只读）",original),pick,labelled("依据片段",excerpt),labelled("与结论的关系",relation),remove);return row;
      }
      sources.append(sourceRow());dialog.append(sources);
      const actions=el("div",{className:"evidence-adoption-actions"}),add=el("button",{type:"button",className:"secondary"},"添加另一条依据"),cancel=el("button",{type:"button",className:"secondary"},"取消"),save=el("button",{type:"button",className:"primary"},"确认采纳");
      actions.append(add,cancel,save);dialog.append(status,actions);document.body.append(dialog);
      let busy=false,closed=false,signature=null,operationId=null;
      const close=value=>{if(closed)return;closed=true;dialog.close();dialog.remove();if(opener?.isConnected)opener.focus();resolve(value);};
      add.onclick=()=>{if(sources.children.length>=8){status.textContent="最多 8 条依据；未增加或截断";return;}sources.append(sourceRow());};
      cancel.onclick=()=>{if(!busy)close(null);};dialog.addEventListener("cancel",event=>{event.preventDefault();if(!busy)close(null);});
      save.onclick=async()=>{
        if(busy)return;
        try{
          const body=text.value.trim();if(!body){text.focus();throw Error("请填写结论正文");}if(Array.from(body).length>4000){text.focus();throw Error("结论正文超过 4,000 字符");}
          const selections=[...sources.children].map(row=>{const fields=row.querySelectorAll("select,textarea"),source=options.sources[Number(fields[0].value)],excerpt=fields[2];if(!excerpt.value.trim()){excerpt.focus();throw Error("请核对并填写每条依据片段");}return {source,selection:excerpt.value,selectionStart:excerpt.dataset.start===undefined?null:Number(excerpt.dataset.start),selectionEnd:excerpt.dataset.end===undefined?null:Number(excerpt.dataset.end),relation:fields[3].value};});
          const form={projectId:project.value,text:body,conditions:conditions.value.trim(),selections},key=JSON.stringify(form);
          if(signature!==key){signature=key;operationId="op_ui_adopt_"+crypto.randomUUID().replace(/-/g,"");}
          busy=true;dialog.setAttribute("aria-busy","true");dialog.querySelectorAll("button,input,select,textarea").forEach(n=>n.disabled=true);status.textContent="正在保存…";
          let result=await options.submit({...form,operationId});
          if(typeof result?.ok==="boolean"){if(!result.ok)throw Error(result.error||"后台拒绝采纳");result=result.data;}
          if(!result?.conclusionId)throw Error("后台未返回保存标识，请核对后用相同内容重试");
          status.textContent=(result?.dedupe?"已存在相同采纳，未重复创建。":"已采纳。")+(result?.projectionPending?"共享摘要待更新，证据已经保存。":"可在“证据与复核”中查看和备份。");
          window.dispatchEvent(new Event("threadline-evidence-changed"));setTimeout(()=>close(result),900);
        }catch(error){busy=false;dialog.removeAttribute("aria-busy");dialog.querySelectorAll("button,input,select,textarea").forEach(n=>n.disabled=false);status.textContent="采纳未完成："+error.message;status.dataset.error="true";}
      };
      dialog.showModal();text.focus();
    });
  }
  globalThis.ThreadLineEvidenceAdoption={open};
})();
