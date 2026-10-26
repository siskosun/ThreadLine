// Read-only UI measurement; all seeded data lives in a newly created profile.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {execFileSync}=require('child_process');
const {pathToFileURL,fileURLToPath}=require('url');
const {chromium}=require('playwright');
const root=path.resolve(process.env.THREADLINE_REPO||path.join(__dirname,'../../..'));
const extension=path.resolve(process.env.THREADLINE_EXTENSION_PATH||path.join(root,'threadline-extension'));
if(!process.env.THREADLINE_BASELINE_OUTPUT)throw Error('Set THREADLINE_BASELINE_OUTPUT to a new or empty output directory.');
const out=path.resolve(process.env.THREADLINE_BASELINE_OUTPUT);
if(fs.existsSync(out)&&fs.readdirSync(out).length)throw Error('Refusing to overwrite a non-empty baseline output directory.');
const source=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const sourceDirty=!!execFileSync('git',['-C',root,'status','--porcelain'],{encoding:'utf8'}).trim();
function fingerprint(){const hash=crypto.createHash('sha256');function walk(dir){for(const name of fs.readdirSync(dir).sort()){if(['node_modules','test','scripts'].includes(name))continue;const p=path.join(dir,name);if(fs.statSync(p).isDirectory())walk(p);else{hash.update(path.relative(extension,p).split(path.sep).join('/')+'\0');hash.update(fs.readFileSync(p));hash.update('\0');}}}walk(extension);return hash.digest('hex');}
const before=fingerprint();
const meta={source,sourceDirty,extensionFingerprint:before,capturedAt:new Date().toISOString(),playwright:require('playwright/package.json').version,scope:'Synthetic extension profile. Opaque solid-background leaf text, dialog action visibility and target candidates only; translucent colors are skipped. Not full WCAG conformance or a render benchmark.'};
fs.mkdirSync(out,{recursive:true});
const audit=()=>{
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);for(let n=e.parentElement;n;n=n.parentElement){if(n.tagName==='DETAILS'&&!n.open&&!n.querySelector(':scope > summary')?.contains(e))return false;}return e.checkVisibility()&&r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
 const identify=e=>e.id?'#'+e.id:e.tagName.toLowerCase()+(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\s+/).join('.'):'');
 const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
 const lum=arr=>arr.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{const x=lum(rgb(a)),y=lum(rgb(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
 const bg=e=>{for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(s.backgroundImage!=='none')return null;const c=s.backgroundColor;if(c==='rgba(0, 0, 0, 0)'||c==='transparent')continue;if(c.startsWith('rgba'))return null;return c;}return 'rgb(255,255,255)'};
 const scope=document.querySelector('dialog[open]')||document;
 const leaves=[...scope.querySelectorAll('*')].filter(e=>visible(e)&&![...e.children].some(visible)&&e.textContent.trim()&&!['SCRIPT','STYLE','OPTION'].includes(e.tagName));
 const samples=leaves.map(e=>{const s=getComputedStyle(e),b=bg(e),opaque=!s.color.startsWith('rgba');return {selector:identify(e),text:e.textContent.trim().slice(0,80),font:parseFloat(s.fontSize),weight:s.fontWeight,color:s.color,background:b,contrast:b&&opaque?+contrast(s.color,b).toFixed(2):null,disabled:e.matches(':disabled')};});
 const controls=[...scope.querySelectorAll('button,a,input,textarea,select,summary')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {selector:identify(e),text:(e.getAttribute('aria-label')||e.innerText||e.title||'').trim().slice(0,70),w:+r.width.toFixed(1),h:+r.height.toFixed(1),disabled:!!e.disabled}});
 const dialog=document.querySelector('dialog[open]');
 let dialogAudit=null;
 if(dialog){const outer=dialog.getBoundingClientRect(),scroller=dialog.querySelector('.tl-dialog-body,.evidence-adoption-body')||dialog,actions=[...dialog.querySelectorAll('.evidence-adoption-actions button,.tl-actions button')];dialogAudit={scrollClientHeight:scroller.clientHeight,scrollHeight:scroller.scrollHeight,actions:actions.map(e=>{const r=e.getBoundingClientRect(),inView=r.top>=Math.max(0,outer.top)&&r.bottom<=Math.min(innerHeight,outer.bottom)&&r.left>=Math.max(0,outer.left)&&r.right<=Math.min(innerWidth,outer.right);return {text:e.textContent.trim(),top:+r.top.toFixed(1),bottom:+r.bottom.toFixed(1),inView};})};}
 return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},bodyHeight:document.documentElement.scrollHeight,documentWidth:document.documentElement.scrollWidth,visibleControls:controls.length,smallTargets:controls.filter(c=>c.w<24||c.h<24),fontHistogram:samples.reduce((a,v)=>(a[v.font]=(a[v.font]||0)+1,a),{}),textContrastCandidates:samples.filter(s=>!s.disabled&&s.contrast!==null&&s.contrast<4.5).slice(0,24),samples:samples.slice(0,50),dialog:dialogAudit};
};
(async()=>{
 const profiles=path.resolve(os.tmpdir());
 const profile=fs.mkdtempSync(path.join(profiles,'threadline-ui-audit-'));
 const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.THREADLINE_CHROMIUM_PATH||undefined,channel:'chromium',headless:true,viewport:{width:360,height:900},args:['--no-sandbox','--disable-dev-shm-usage','--disable-extensions-except='+extension,'--load-extension='+extension]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const base='chrome-extension://'+worker.url().split('/')[2]+'/';
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));const results=[];
 async function measure(name,full=false){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:path.join(out,name+'.png'),fullPage:full});results.push({name,...await page.evaluate(audit)});fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify({...meta,browser:context.browser()?.version(),complete:false,results,errors},null,2));}
 async function good(p,payload){const x=await p.evaluate(p=>new Promise(r=>chrome.runtime.sendMessage(p,r)),payload);if(!x?.ok)throw Error(JSON.stringify(x));return x.data;}
 async function checkReference(){
  const p=await context.newPage(),pageErrors=[];p.on('pageerror',e=>pageErrors.push(String(e)));
  await p.goto(pathToFileURL(path.join(root,'docs/ui/reference.html')).href);
  const referenceViewports=[],layouts=[];
  for(const width of [1280,768,360,320]){await p.setViewportSize({width,height:900});referenceViewports.push(width);layouts.push(await p.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,noOverflow:document.documentElement.scrollWidth<=innerWidth})));}
  await p.locator('#search').fill('不存在的结论');
  const search=await p.locator('#no-results').isVisible()&&(await p.locator('#results-status').textContent()).includes('0');
  await p.locator('#search').fill('复访');
  const matching=await p.locator('.conclusion:visible').count()===1;
  await p.locator('#search').fill('');
  await p.locator('[data-filter="withdrawn"]').click();
  const filter=await p.locator('.conclusion:visible').count()===1&&await p.locator('.conclusion:visible').getAttribute('data-state')==='withdrawn';
  await p.locator('[data-filter="all"]').click();
  await p.locator('#preview-handoff').click();await p.locator('#demo-dialog').waitFor({state:'visible'});await p.keyboard.press('Escape');await p.locator('#demo-dialog').waitFor({state:'hidden'});
  const dialogEscapeAndFocus=await p.evaluate(()=>document.activeElement?.id==='preview-handoff');
  await p.locator('#sample-save').click();
  const saved=await p.locator('#sample-status').textContent();
  await p.locator('#sample-reason').fill('临时修改');await p.locator('#sample-reset').click();
  const feedback=saved.includes('没有写入数据')&&(await p.locator('#sample-reason').inputValue())==='补充当前结论的适用范围'&&(await p.locator('#sample-status').textContent()).includes('没有写入数据');
  const hrefs=await p.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>n.href));
  const links=hrefs.every(href=>!href.startsWith('file:')||fs.existsSync(fileURLToPath(href)));
  const result={source,sourceDirty,capturedAt:new Date().toISOString(),playwright:meta.playwright,browser:context.browser()?.version(),referenceViewports,layouts,search:search&&matching,filter,dialogEscapeAndFocus,feedback,links,pageErrors};
  fs.writeFileSync(path.join(out,'reference-check.json'),JSON.stringify(result,null,2));
  await p.close();
  if(!layouts.every(x=>x.noOverflow)||![result.search,result.filter,result.dialogEscapeAndFocus,result.feedback,result.links].every(Boolean)||pageErrors.length)throw Error('Reference check failed: '+JSON.stringify(result));
  return result;
 }
 try{
  await page.goto(base+'panel.html');await page.locator('#evidence-maintenance').waitFor({state:'attached'});await page.waitForFunction(()=>!document.querySelector('#current-content').textContent.includes('正在识别'));
  await measure('switch-empty-360');await page.locator('#manage-accordion > summary').click();await measure('manage-empty-360',true);
  await page.locator('#nav-evidence').click();await measure('evidence-empty-360');
  await page.locator('#nav-research').click();await measure('research-empty-360');
  await page.locator('#nav-switch').click();await page.locator('#topic-name').fill('合成研究：收入变化归因');await page.locator('#create-form button[type=submit]').click();await page.locator('#topic-list').getByText('合成研究：收入变化归因',{exact:false}).first().waitFor();
  const pid=(await good(page,{type:'SNAPSHOT'})).state.projects[0].id;
  await page.evaluate(async()=>{const id='capture-ux-baseline';await ThreadLineCaptureDB.putRun({id,status:'done',title:'合成研究材料',conversationId:'synthetic-ux-baseline',url:'https://chatgpt.com/c/synthetic-ux-baseline',complete:false,mode:'dom',notice:'仅合成文本片段',pageCount:1,messageCount:2,createdAt:Date.now(),updatedAt:Date.now()});await ThreadLineCaptureDB.putPage({id,pageIndex:0,chunkIndex:0,messages:[{id:'user-sample',role:'user',content:'收入变化有哪些竞争解释？'},{id:'assistant-sample',role:'assistant',content:'候选结论：同期活动和复访行为可能同时影响收入，需要补充独立证据。下一步：核实对照窗口和样本口径。'}]});await chrome.storage.local.set({tl_last_capture_id:id});});
  await page.reload();await page.locator('#nav-research').click();await page.locator('#capture-report').waitFor();await measure('research-report-360',true);
  await page.getByRole('button',{name:'采纳此条为证据结论',exact:true}).first().click();
  await page.locator('.evidence-adoption-dialog').waitFor();await measure('adoption-dialog-360');await page.keyboard.press('Escape');
  await page.locator('#nav-evidence').click();
  const proto=await context.newPage();await proto.goto(base+'evidence-prototype.html');
  let first;
  for(let i=1;i<=200;i++){
   const x=await good(proto,{type:'EV_ADOPT',projectId:pid,text:`结论 ${String(i).padStart(3,'0')}：样本中收入变化与复访行为同时出现；该观察仍需排除同期活动影响，不能直接视作因果结论。`,conditions:'仅适用于合成样本，不构成真实经营判断',fragments:[{kind:'manual',selection:`合成证据 ${i}：示例统计与原始材料摘录。`,before:'背景',after:'统计口径',capturedAt:1}],operationId:'op_ux_audit_'+String(i).padStart(5,'0')});
   if(i===1)first=x.conclusionId;
   if([1,10,50,200].includes(i)){
    await page.locator('#nav-evidence').click();await page.locator('#evidence-refresh').click();await page.waitForFunction(n=>document.querySelectorAll('.evidence-item').length===n,i);
    await page.evaluate(()=>scrollTo(0,0));await measure('evidence-'+i+'-360',i===10);
   }
  }
  for(const width of [320,768,1280]){await page.setViewportSize({width,height:900});await measure('evidence-200-'+width);}
  await page.setViewportSize({width:360,height:900});await page.locator('.evidence-item button').filter({hasText:'修订'}).first().click();await measure('amend-dialog-360');await page.keyboard.press('Escape');
  await page.goto(base+'ff.html');await page.locator('#ff-enable').waitFor();await measure('fork-disabled-360');await page.locator('#ff-enable').check();await page.locator('#ff-local').waitFor();await measure('fork-create-360',true);
  await page.locator('#ff-w0').fill('这是一组完全虚构的研究材料。');await page.locator('#ff-p').fill('比较收入变化的竞争解释，列出需要核实的证据。');await page.locator('#ff-save').click();await page.locator('#ff-detail').waitFor();await measure('fork-frozen-360',true);
  if(errors.length)throw Error('Page errors: '+errors.join('; '));
  const after=fingerprint();if(after!==before)throw Error('Extension source changed during capture');
  fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify({...meta,browser:context.browser()?.version(),complete:true,extensionFingerprintAfter:after,results,errors},null,2));
  const reference=await checkReference();
  console.log(JSON.stringify({states:results.length,errors,referenceErrors:reference.pageErrors,files:fs.readdirSync(out).length}));
 }finally{await context.close();const resolved=path.resolve(profile);if(path.dirname(resolved)!==profiles||!path.basename(resolved).startsWith('threadline-ui-audit-'))throw Error('profile cleanup boundary');fs.rmSync(resolved,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
