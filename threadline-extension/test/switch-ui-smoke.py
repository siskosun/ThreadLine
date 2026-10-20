"""Offline Chromium test for v0.5 dashboard and its interactions; no ChatGPT account or network."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
ART=ROOT.parent
mock=r'''
(()=>{
 const state={schema:1,revision:4,projects:[{id:'p_test',name:'收入预测 · 反事实验证',goal:'比较下一季度收入预警能力，并确认反事实设定是否成立',decision:'上一轮对抗已发现部分年份偏差；新假设尚需独立验证。',stage:'active',knowledgeVersion:3,lastChange:{version:3,label:'有效结论已更新',sourceKey:'chat:alpha',at:5000},createdAt:1000,updatedAt:5000,closedAt:null}],chats:{
  'chat:alpha':{key:'chat:alpha',projectId:'p_test',title:'A · 历史回测',label:'A · 历史回测',stage:'done',note:'完成时间前推检验',seenVersion:3,url:'https://chatgpt.com/c/alpha',createdAt:1000,updatedAt:5000},
  'chat:beta':{key:'chat:beta',projectId:'p_test',title:'B · 参数探索',label:'B · 参数探索',stage:'active',note:'尚未复核 A 的结论',seenVersion:2,url:'https://chatgpt.com/c/beta',createdAt:1100,updatedAt:4000},
  'chat:gamma':{key:'chat:gamma',projectId:'p_test',title:'C · 独立审核',label:'C · 独立审核',stage:'review',note:'等待长期测试结果',seenVersion:3,url:'https://chatgpt.com/c/gamma',createdAt:1100,updatedAt:4500}
 }};
 const tabs=[{id:10,url:'https://chatgpt.com/c/alpha',title:'A · 历史回测',windowId:1,active:false},{id:20,url:'https://chatgpt.com/c/beta',title:'B · 参数探索',windowId:1,active:true},{id:30,url:'https://chatgpt.com/c/gamma',title:'C · 独立审核',windowId:1,active:false}];
 const local={threadline_state_v1:state,tl_last_capture_id:''},session={};
 const listeners=[];let activated=20;
 function get(obj,key){if(key===null)return {...obj}; if(typeof key==='string')return {[key]:obj[key]};return obj;}
 function report(){return {state:local.threadline_state_v1,tabs,activeTabId:activated,liveByTab:{'10':{key:'chat:alpha',streaming:false,updatedAt:Date.now()},'20':{key:'chat:beta',streaming:false,updatedAt:Date.now()}}};}
 window.__fake={state,tabs,local,session,opened:[],get active(){return activated;}};
 window.chrome={
 runtime:{id:'test',lastError:null,sendMessage(payload,cb){setTimeout(()=>{
   try{ if(payload.type==='SNAPSHOT')return cb({ok:true,data:report()});
     if(payload.type==='MUTATE'){
       const result=window.ThreadLineCore.apply(local.threadline_state_v1,payload.action,6000);
       local.threadline_state_v1=result.state;
       cb({ok:true,data:result}); listeners.forEach(fn=>fn({threadline_state_v1:{newValue:result.state}},'local'));return;
     }return cb({ok:false,error:'unsupported test request'});
   }catch(e){cb({ok:false,error:e.message});}
 },0)}},
 storage:{local:{get:async k=>get(local,k),set:async v=>{Object.assign(local,v);listeners.forEach(fn=>fn(v,'local'))}},session:{get:async k=>get(session,k),set:async v=>Object.assign(session,v)},onChanged:{addListener(fn){listeners.push(fn)}}},
 tabs:{query:async opts=>opts?.active?tabs.filter(t=>t.id===activated):tabs,update:async(id,props)=>{window.__fake.opened.push(id);activated=id;return tabs.find(t=>t.id===id)},create:async data=>{window.__fake.opened.push('created:'+data.url);return {id:50,url:data.url,windowId:1}},onActivated:{addListener(){}},onUpdated:{addListener(){}},onCreated:{addListener(){}},onRemoved:{addListener(){}}},
 windows:{update:async()=>{},getCurrent:async()=>({id:1}),onFocusChanged:{addListener(){}}},
 permissions:{request:async()=>false}
 };
})();
'''
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':420,'height':850},device_scale_factor=1)
 page=context.new_page()
 errors=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 markup=ROOT.joinpath('panel.html').read_text()
 markup=re.sub(r'<link rel="stylesheet" href="panel.css"\s*/>', '', markup)
 markup=re.sub(r'<script src="[^"]+"></script>', '', markup)
 page.set_content(markup)
 page.add_style_tag(content=ROOT.joinpath('panel.css').read_text())
 page.evaluate(mock)
 for script in ['core.js','organize-core.js','capture-core.js','capture-db.js','ai-core.js','ai-providers.js','capture-ui.js','panel.js']:
  page.add_script_tag(content=ROOT.joinpath(script).read_text())
 page.wait_for_function("document.querySelector('#quick-list')?.querySelectorAll('.quick-chat').length === 3")
 assert page.locator('#nav-switch').get_attribute('aria-selected')=='true'
 assert page.locator('#workspace-research').is_hidden()
 assert page.locator('#quick-list .quick-chat').count()==3
 assert '待核对' in page.locator('#current-content').inner_text()
 page.screenshot(path=str(ART/'ThreadLine-v0.5.0-切换首页.png'),full_page=True)
 page.locator('#current-content [data-action="ack-current"]').click()
 page.wait_for_function("!document.querySelector('#current-content')?.textContent.includes('版本待核对')")
 assert page.evaluate("__fake.local.threadline_state_v1.chats['chat:beta'].seenVersion") == 3
 page.locator('#quick-list [data-key="chat:alpha"]').click()
 page.wait_for_function('__fake.opened.includes(10)')
 page.locator('#nav-research').click()
 assert page.locator('#workspace-research').is_visible()
 assert page.locator('#workspace-switch').is_hidden()
 # Chromium denies IndexedDB in about:blank; hide this synthetic test-origin error.
 # This screenshot is a layout simulation, NOT a native extension storage test.
 page.locator('#capture-error').evaluate('(e)=>e.hidden=true')
 page.screenshot(path=str(ART/'ThreadLine-v0.5.0-研究整理.png'),full_page=True)
 page.locator('#nav-switch').click()
 page.locator('#manage-accordion').evaluate('(e)=>e.open=true')
 assert page.locator('#topic-list .topic-card').count()==1
 page.locator('[data-action="select-project"]').click()
 assert page.locator('#detail-section').is_visible()
 page.screenshot(path=str(ART/'ThreadLine-v0.5.0-课题管理.png'),full_page=True)
 # Check the minimum Chromium sidepanel width does not require horizontal scrolling.
 page.set_viewport_size({'width':320,'height':760})
 page.locator('#detail-section [data-action="collapse-details"]').click()
 assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'horizontal overflow at 320px'
 assert not errors, errors
 print('PASS v0.5: default switch / 3 branches / stale acknowledge / one-click jump / research pane / topic management')
 browser.close()
