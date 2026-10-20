/* Drives ONLY ChatGPT's visible project and archive controls following a button press.
   Fail closed when a menu, target chat or project cannot be identified. */
(() => {
  if (globalThis.__threadlineOrganizerInjected) return;
  globalThis.__threadlineOrganizerInjected = true;
  const C = globalThis.ThreadLineOrganizeCore;
  if (!C) return;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const names = {
    newProject: /^(new project|create project|add project|新建项目|创建项目|新增项目|建立项目)$/i,
    create: /^(create|create project|save|done|continue|创建|新建|创建项目|完成|继续)$/i,
    move: /^(move to project|add to project|change project|移至项目|移动到项目|添加到项目|更改项目|转移到项目)$/i,
    archive: /^(archive|archive chat|archive conversation|归档|归档聊天|归档对话|封存|封存对话)$/i,
    unarchive: /^(unarchive|取消归档|恢复归档|移出归档|取消封存)$/i
  };
  let busy = false;
  function label(el) {return [el?.getAttribute?.('aria-label'),el?.getAttribute?.('title'),el?.innerText,el?.textContent,el?.value].filter(Boolean).map(x=>C.cleanText(x,170))[0]||'';}
  function visible(el) {if(!el || !el.isConnected) return false;const cs=getComputedStyle(el);const box=el.getBoundingClientRect();return cs.visibility !== 'hidden' && cs.display !== 'none' && box.width > 0 && box.height > 0;}
  function clickable(root=document) {return [...root.querySelectorAll('button, [role="button"], a[href], [role="menuitem"], [role="option"], input[type="submit"]')].filter(visible);}
  function matchAction(pattern, root=document, selector=null) {
    const els = selector ? [...root.querySelectorAll(selector)].filter(visible) : clickable(root);
    return els.find(el=>pattern.test(label(el))) || null;
  }
  async function waitFor(getter, timeout=9000, reason='未找到目标') {
    const start=Date.now();while(Date.now()-start<timeout){let found=getter();if(found)return found;await sleep(180);}throw new Error(reason);
  }
  function click(el) {if(!visible(el))throw new Error('控件不可见，已终止操作');el.focus?.();el.click();}
  function chatAnchor(id){return [...document.querySelectorAll('a[href]')].find(el=>C.chatId(el.getAttribute('href'))===id&&visible(el))||null;}
  async function sidebar() {
    const nav=document.querySelector('nav[aria-label*="chat" i],aside,[data-testid*="sidebar" i]') || document.body;
    if([...nav.querySelectorAll('a[href]')].some(el=>visible(el)))return nav;
    const toggle=clickable().find(el=>/^(open sidebar|show sidebar|打开侧栏|展开侧边栏|显示侧栏)$/i.test(label(el)));
    if(toggle){click(toggle);await sleep(350);}
    return document.querySelector('nav[aria-label*="chat" i],aside,[data-testid*="sidebar" i]') || document.body;
  }
  function projectLink(name){return [...document.querySelectorAll('a[href*="/g/g-p-"]')].find(el=>visible(el)&&C.equalText(label(el),name))||null;}
  async function createProject(name){
    if(!C.validProjectName(name)) throw new Error('项目名须为 2—80 个字符');
    await sidebar();
    const existing=projectLink(name);
    if(existing){return {status:'existing',name,id:C.projectId(existing.href),url:existing.href};}
    const newProject=await waitFor(()=>matchAction(names.newProject),6000,'未找到“新建项目”控件，请在 ChatGPT 侧栏手动创建');
    click(newProject);
    const input=await waitFor(()=>{
      const dialog=[...document.querySelectorAll('[role="dialog"],dialog')].find(visible)||document;
      const inputs=[...dialog.querySelectorAll('input[type="text"],input:not([type]),textarea')].filter(visible);
      return inputs.find(el=>/project|项目|name|名称/i.test([label(el),el.placeholder,el.name,el.id].join(' '))) || (dialog===document?null:inputs.length===1?inputs[0]:null);
    },8500,'新建项目弹窗中未找到名称输入框');
    const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value')?.set;
    if(setter)setter.call(input,name);else input.value=name;
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    const dialog=input.closest('form,[role="dialog"],dialog')||document;
    const submit=await waitFor(()=>matchAction(names.create,dialog),8000,'新建项目弹窗中未找到创建按钮');
    click(submit);
    const result=await waitFor(()=>{
      const id=C.projectId(location.href);
      if(id)return {status:'created',name,id,url:location.href};
      const a=projectLink(name);
      if(a){const id=C.projectId(a.href);if(id)return {status:'created',name,id,url:a.href};}
      return null;
    },15000,'已经点击创建，但无法确认 ChatGPT 是否完成项目创建');
    return result;
  }
  async function menuForChat(id){
    if(!id || C.chatId(location.href)!==id)throw new Error('源标签页不是所选对话，已停止操作');
    await sidebar();
    const anchor=await waitFor(()=>chatAnchor(id),5500,'侧边栏找不到此对话，未执行任何操作');
    anchor.scrollIntoView?.({block:'center'});
    const row=anchor.closest('li,[data-testid*="conversation"],div[data-state]')||anchor.parentElement;
    const menuBtn=[anchor,...(row?[row]:[])].flatMap(e=>[...e.querySelectorAll('button')])
      .find(btn=>visible(btn) && (/menu|options|更多|选项/i.test(label(btn))||btn.matches('[aria-haspopup="menu"],.__menu-item-trailing-btn')));
    if(!menuBtn)throw new Error('找不到所选对话的更多操作按钮，未修改对话');
    click(menuBtn);
    return await waitFor(()=>[...document.querySelectorAll('[role="menuitem"]')].some(visible),5000,'对话操作菜单未打开');
  }
  async function archive(id){
    await menuForChat(id);
    const entry=await waitFor(()=>matchAction(names.archive,document,'[role="menuitem"]'),6000,'当前对话没有“归档”菜单项');
    click(entry);
    // ChatGPT normally archives without a confirmation. Avoid claiming verified success
    // if a page transition or an unexpected menu renders asynchronously.
    const beginning=Date.now();let checked=false,absent=0;
    while(Date.now()-beginning<6000){
      if(C.chatId(location.href)!==id){checked=true;break;}
      absent=!chatAnchor(id)?absent+1:0;
      if(absent>=3){checked=true;break;}
      await sleep(260);
    }
    return {status:checked?'archived':'submitted_unverified',conversationId:id};
  }
  async function move(id, name, targetId){
    if(!C.validProjectName(name))throw new Error('无效项目名称');
    if(targetId&&C.projectId(location.href)===targetId)return {status:'already_in_project',conversationId:id,id:targetId};
    await menuForChat(id);
    const menu=await waitFor(()=>matchAction(names.move,document,'[role="menuitem"]'),6500,'当前对话没有“移至项目”菜单项，此对话可能不符合移入资格');
    click(menu);
    const project=await waitFor(()=>{
      const opts=[...document.querySelectorAll('[role="menuitem"],[role="option"],a[href*="/g/g-p-"]')].filter(visible);
      const exact=opts.filter(el=>C.equalText(label(el),name));
      if(targetId){return exact.find(el=>C.projectId(el.href||'')===targetId)||exact[0]||null;}
      return exact[0]||null;
    },8500,'项目选择菜单未找到刚创建的项目，尚未移入对话');
    click(project);
    let verified=false;const started=Date.now();
    while(Date.now()-started<8500){
      if(targetId && C.projectId(location.href)===targetId){verified=true;break;}
      const idNow=C.projectId(location.href);
      if(idNow && targetId && idNow===targetId){verified=true;break;}
      await sleep(200);
    }
    return {status:verified?'moved':'submitted_unverified',conversationId:id,id:targetId||''};
  }
  chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
    if(!msg || !/^TL_ORG_(CREATE|MOVE|ARCHIVE|PING)$/.test(msg.type))return false;
    if(msg.type==='TL_ORG_PING'){respond({ok:true,href:location.href});return false;}
    if(busy){respond({ok:false,error:'ChatGPT 页面还有正在执行的组织操作'});return false;}
    busy=true;
    (async()=>{
      if(!C.allowedChatUrl(location.href))throw new Error('不是 ChatGPT 网页');
      if(msg.type==='TL_ORG_CREATE')return createProject(msg.name);
      if(msg.type==='TL_ORG_MOVE')return move(msg.conversationId,msg.name,msg.projectId);
      return archive(msg.conversationId);
    })().then(data=>respond({ok:true,data}),e=>respond({ok:false,error:String(e.message||e)})).finally(()=>{busy=false;});
    return true;
  });
})();
