/* S5 requires explicit user action before loading a large local parser. */
(() => {
  "use strict";
  function mount(){
    const host=document.getElementById("evidence-section");
    if(!host||document.getElementById("argdown-loader"))return;
    const details=document.createElement("details");details.id="argdown-loader";
    const title=document.createElement("summary");title.textContent="Argdown 互通（按需启用）";
    const button=document.createElement("button");button.type="button";button.className="secondary";
    button.textContent="加载本地 Argdown 解析器";
    const status=document.createElement("p");status.className="subtle";status.setAttribute("role","status");
    details.append(title,button,status);host.append(details);
    let pending=false;
    const load=relative=>new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src=chrome.runtime.getURL(relative);
      script.onload=()=>resolve();
      script.onerror=()=>reject(Error("本地资源加载失败："+relative));
      document.body.append(script);
    });
    button.onclick=async()=>{
      if(pending)return;pending=true;button.disabled=true;status.textContent="正在加载本地解析器…";
      try{
        if(!globalThis.ThreadLineArgdown)await load("vendor/argdown-adapter.js");
        if(!globalThis.ThreadLineArgdownUI)await load("argdown-ui.js");
        if(!globalThis.ThreadLineArgdownUI?.install)throw Error("Argdown UI 未初始化");
        globalThis.ThreadLineArgdownUI.install();
        button.hidden=true;status.textContent="Argdown 互通已启用；导入只生成候选，需逐条人工确认。";
      }catch(e){status.textContent="未启用："+e.message;button.disabled=false;}
      finally{pending=false;}
    };
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
})();
