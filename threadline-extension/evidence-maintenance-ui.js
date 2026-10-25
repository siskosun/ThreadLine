/* User-facing evidence maintenance.  This script never writes evidence from
 * the panel: every destructive action is preview -> explicit confirmation ->
 * one stable operation id.  It intentionally does not depend on SNAPSHOT so
 * recovery remains reachable when the normal topic projection is damaged. */
(() => {
  "use strict";
  const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
  const countsOf = value => Object.fromEntries(["conclusions", "versions", "sources", "links"]
    .map(key => [key, Number.isSafeInteger(value?.[key]) && value[key] >= 0 ? value[key] : 0]));
  const operationId = prefix => "op_" + prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const normalizeBackup = parsed => {
    if (parsed?.format === "threadline-project-backup/1" && parsed.evidence)
      return parsed;
    if (["threadline-evidence/1", "threadline-evidence/2", "threadline-evidence/3"].includes(parsed?.format))
      return { format: "threadline-project-backup/1", topic: null, evidence: parsed, legacyEvidenceOnly: true };
    throw new Error("请选择研线证据备份（/1、/2 或 /3）");
  };
  async function parseBackupFile(file) {
    if (!file) throw new Error("请选择备份文件");
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_PACKAGE_BYTES)
      throw new Error("备份文件超过 20 MiB，未读取文件内容");
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch { throw new Error("备份不是有效 JSON"); }
    return normalizeBackup(parsed);
  }
  const countText = counts => {
    const c = countsOf(counts);
    return `结论 ${c.conclusions}、版本 ${c.versions}、来源片段 ${c.sources}、链接 ${c.links}`;
  };
  const download = (filename, data) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  function install({document:doc=document,chrome:extensionChrome=chrome,win=window}={}) {
    const host=doc.querySelector("#evidence-section");if(!host||doc.getElementById("evidence-maintenance"))return null;
    const send=payload=>new Promise((resolve,reject)=>extensionChrome.runtime.sendMessage(payload,response=>{if(extensionChrome.runtime.lastError)return reject(Error(extensionChrome.runtime.lastError.message));if(!response?.ok)return reject(Error(response?.error||"后台无返回"));resolve(response.data);}));
    const node=(tag,attrs={},text="")=>{const n=doc.createElement(tag);Object.assign(n,attrs);n.textContent=text;return n;};
    const button=(text,className="secondary")=>node("button",{type:"button",className},text);
    const box=node("details",{id:"evidence-maintenance"}),body=node("div"),status=node("p",{role:"status",className:"subtle"});status.setAttribute("aria-live","polite");
    box.append(node("summary",{},"证据备份、恢复与删除"),body);
    const select=node("select");select.setAttribute("aria-label","选择维护课题");
    const backup=button("导出证据备份"),pick=button("选择备份文件恢复"),diagnostic=button("导出故障原始包"),remove=button("预览删除范围","danger"),refreshButton=button("刷新课题目录");
    const actions=node("div",{className:"tl-actions"});actions.append(backup,pick,remove,refreshButton);
    const input=node("input",{type:"file",accept:"application/json,.json",hidden:true}),restorePanel=node("div",{hidden:true,className:"evidence-restore-preview"});
    const restoreText=node("p",{className:"subtle"}),replace=node("input",{type:"checkbox",id:"evidence-maintenance-replace"});
    const replaceLabel=node("label",{},"替换同 ID 的当前证据课题（先自行导出备份，当前状态将被删除）");replaceLabel.prepend(replace);
    const restore=button("确认恢复","primary"),cancelRestore=button("取消"),retry=button("重试未完成的删除清理");retry.hidden=true;restore.disabled=true;
    restorePanel.append(restoreText,replaceLabel,restore,cancelRestore);
    const advanced=node("details");advanced.append(node("summary",{},"故障恢复工具"),node("p",{className:"subtle"},"普通备份不可用时，导出所有课题的故障原始包供检查；该文件包含原文，不能直接作为恢复备份。"),diagnostic);
    body.append(node("p",{className:"subtle"},"备份包含结论和原文片段。课题删除会清理其证据、摘要、交接与历史副本；独立采集/Fork 原件、剪贴板及外部文件保留。"),select,actions,input,restorePanel,retry,status,advanced);host.append(box);
    let projects=[],pendingRestore=null,pendingDelete=null,busy=false,previewTicket=0,directoryTicket=0;
    const say=(text,error=false)=>{status.textContent=text;status.dataset.error=String(error);};
    const changed=()=>win.dispatchEvent(new Event("threadline-evidence-changed"));
    const selected=()=>projects.find(p=>p.id===select.value&&!p.deleted);
    async function refresh({announce=false}={}){
      const ticket=++directoryTicket,prior=select.value;
      try{const data=await send({type:"EV_PROJECTS"});if(ticket!==directoryTicket)return;
        projects=data.projects||[];select.replaceChildren();
        for(const project of projects){const option=node("option",{value:project.id,disabled:!!project.deleted},(project.name||project.id)+(project.deleted?"（已删除）":project.unavailable?"（需恢复）":""));select.append(option);}
        if([...select.options].some(o=>o.value===prior&&!o.disabled))select.value=prior;
        if(announce)say(data.error||(!projects.length?"暂无课题。可以选择备份恢复，或先创建课题。":"请选择要维护的课题。"),!!data.error);
      }catch(error){if(ticket===directoryTicket)say("目录读取失败："+error.message+"。故障原始包仍可导出。",true);}
    }
    async function exclusive(task){
      if(busy){say("上一项操作尚未结束，请稍候。",true);return;}
      busy=true;box.setAttribute("aria-busy","true");
      const controls=[backup,pick,diagnostic,remove,refreshButton,replace,restore,cancelRestore,select,retry];controls.forEach(c=>c.disabled=true);
      try{await task();}finally{busy=false;box.removeAttribute("aria-busy");controls.forEach(c=>c.disabled=false);restore.disabled=!pendingRestore?.preview;}
    }
    async function previewRestore(){
      if(!pendingRestore||busy)return;
      const intent=pendingRestore,ticket=++previewTicket;intent.replace=replace.checked;intent.preview=null;restore.disabled=true;
      try{const data=await send({type:"EV_RESTORE_PREVIEW",backup:intent.backup,replace:intent.replace});if(ticket!==previewTicket||pendingRestore!==intent)return;
        intent.preview=data.preview;intent.counts=data.counts;
        restoreText.textContent=`备份课题：${data.topic?.name||data.preview.projectId}\n恢复范围：${countText(data.counts)}。包含对话原文片段。\n恢复模式：${intent.replace?"替换同 ID 课题；现有状态将被删除，建议先导出备份。":"新建或恢复缺失课题。"}`;
        restore.disabled=false;say("已完成预览，尚未写入。请核对课题与范围。 ");
      }catch(error){if(ticket===previewTicket)say("无法预览恢复："+error.message+"。同 ID 课题请勾选替换后再预览。",true);}
    }
    backup.onclick=()=>{const project=selected();if(!project)return say("请先选择一个可用课题。",true);if(!win.confirm("备份包含该课题的对话原文片段。确认导出？"))return;
      return exclusive(async()=>{try{const data=await send({type:"EV_BACKUP",projectId:project.id});download("threadline-evidence-"+project.id+".json",data);say("已导出“"+project.name+"”："+countText(data.evidence?.counts));}catch(error){say("导出失败："+error.message,true);}});
    };
    diagnostic.onclick=()=>{if(!win.confirm("故障原始包包含所有课题保存的原文和历史。确认导出？"))return;return exclusive(async()=>{try{download("threadline-evidence-diagnostic.json",await send({type:"EV_DIAGNOSTIC_EXPORT"}));say("已导出故障原始包，请妥善保管其中的原文。");}catch(error){say("故障包导出失败："+error.message,true);}});};
    pick.onclick=()=>{if(!busy)input.click();};
    input.onchange=async()=>{if(busy)return;const ticket=++previewTicket,file=input.files?.[0];input.value="";pendingRestore=null;restore.disabled=true;
      try{const data=await parseBackupFile(file);if(ticket!==previewTicket)return;pendingRestore={backup:data,replace:false,operationId:operationId("restore")};replace.checked=false;restorePanel.hidden=false;restoreText.textContent="备份包含原文片段。请核对预览；若课题已存在，可选择替换模式。";await previewRestore();}
      catch(error){if(ticket===previewTicket)say("无法读取备份："+error.message,true);}
    };
    replace.onchange=()=>{if(pendingRestore){pendingRestore.operationId=operationId("restore");previewRestore();}};
    restore.onclick=()=>{const intent=pendingRestore;if(!intent?.preview)return;if(!win.confirm("确认恢复“"+(intent.backup.topic?.name||intent.preview.projectId)+"”？"+(intent.replace?"当前课题状态将被替换，请确认已有所需备份。":"")))return;
      return exclusive(async()=>{try{const result=await send({type:"EV_RESTORE_COMMIT",backup:intent.backup,preview:intent.preview,operationId:intent.operationId});pendingRestore=null;restorePanel.hidden=true;changed();await refresh();say(result.projectionPending?"证据已恢复，共享摘要重建待完成。可刷新检查。":"已恢复 "+result.restored+" 条结论。");}
        catch(error){say("恢复未能确认："+error.message+"。预览和操作标识已保留，可用原预览重试。",true);}});
    };
    cancelRestore.onclick=()=>{if(!busy){++previewTicket;pendingRestore=null;restorePanel.hidden=true;say("已关闭恢复预览，没有发起新的写入。");}};
    async function finishDelete(){
      const result=await send({type:"EV_DELETE_COMMIT",preview:pendingDelete.preview,operationId:pendingDelete.operationId});retry.hidden=!result.cleanupPending;changed();await refresh();say(result.cleanupPending?"权威证据已删除，课题副本清理待完成。请重试清理。":"课题证据与可确定的历史副本已删除。独立原始资料及外部文件保留。");
    }
    remove.onclick=()=>{const project=selected();if(!project)return say("请先选择一个可用课题。",true);return exclusive(async()=>{
      try{const data=await send({type:"EV_DELETE_PREVIEW",projectId:project.id});if(!win.confirm("删除“"+project.name+"”的课题证据？\n"+countText(data.counts)+"。\n"+data.retainedOriginalsNotice)){say("已取消删除。");return;}
        pendingDelete={preview:data.preview,operationId:operationId("delete")};await finishDelete();
      }catch(error){retry.hidden=!pendingDelete;say("删除未能确认："+error.message+"。不会自动重试；可用原预览重试或刷新核对。",true);}
    });};
    retry.onclick=()=>{if(!pendingDelete)return;return exclusive(async()=>{try{await finishDelete();}catch(error){say("清理仍未确认："+error.message,true);}});};
    refreshButton.onclick=()=>refresh({announce:true});win.addEventListener("threadline-evidence-changed",()=>refresh());refresh({announce:true});
    return {refresh,parseBackupFile};
  }
  const API = { install, parseBackupFile, normalizeBackup, countsOf, MAX_PACKAGE_BYTES };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else globalThis.ThreadLineEvidenceMaintenanceUI = API;
  if (typeof window !== "undefined" && typeof document !== "undefined" && typeof chrome !== "undefined") install();
})();
