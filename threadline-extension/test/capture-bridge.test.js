const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'..','capture-main.js'),'utf8');
const isolated=fs.readFileSync(path.join(__dirname,'..','capture-page.js'),'utf8');
function res(data,status=200){return{ok:status<400,status,async json(){return data}};}
async function scenario(fail, options={}){
  const listeners=[],actions=[],tabListeners=[],location={origin:'https://chatgpt.com',pathname:'/c/t1-123',href:'https://chatgpt.com/c/t1-123'};
  const window={location,addEventListener(type,fn){if(type==='message')listeners.push(fn)},postMessage(data,origin){for(const fn of listeners)fn({source:window,origin,data})},fetch:async()=>fail?res({},401):res({messages:[{id:'m1',author:{role:'user'},content:{parts:['a question']}}],page_info:{has_previous_page:false}})};
  const rows=options.noRole?[]:[{getAttribute(name){return name==='data-message-author-role'?'user':'dom1'},innerText:'visible question'}];
  const document={querySelector(){return null},querySelectorAll(){return rows}};
  const chrome={runtime:{id:'ext',lastError:null,sendMessage(payload,cb){actions.push(payload);Promise.resolve().then(()=>cb({ok:true,data:{}}))},onMessage:{addListener(fn){tabListeners.push(fn)}}}};
  vm.runInNewContext(main,{window,location,Headers,URL,URLSearchParams,AbortController,setTimeout,console},{filename:'main.js'});
  vm.runInNewContext(isolated,{window,location,document,chrome,console,Promise,setTimeout,clearTimeout},{filename:'page.js'});
  const ack=await new Promise(resolve=>tabListeners[0]({type:'TL_CAPTURE_START',id:'cap_123',conversationId:'t1-123'},null,resolve));
  assert.equal(ack.ok,true);
  let n=0;while(!actions.some(m=>m.type==='CAPTURE_END')&&n++<120){await new Promise(r=>setTimeout(r,10));}
  return actions;
}
test('page-main and isolated-world bridges relay all captured pages before finalizing',async()=>{
  const actions=await scenario(false);
  assert.deepEqual(actions.map(m=>m.type),['CAPTURE_PAGE','CAPTURE_PROGRESS','CAPTURE_END']);
  assert.equal(actions.at(-1).complete,true);
});
test('if API access fails, bridge uses visibly incomplete DOM fallback and resets partial pages',async()=>{
  const actions=await scenario(true);
  assert.ok(actions.some(m=>m.type==='CAPTURE_RESET'));
  assert.equal(actions.at(-1).complete,false);
  assert.equal(actions.at(-1).mode,'visible-dom');
  assert.match(actions.at(-1).notice,/不能当作完整/);
});
test('welcome text without a role marker never becomes a captured message',async()=>{
  // The synthetic page may contain a welcome bubble in
  // `div.whitespace-pre-wrap`; capture-page only trusts role-marked nodes.
  const actions=await scenario(true,{noRole:true});
  assert.equal(actions.some(m=>m.type==='CAPTURE_PAGE'),false);
  const end=actions.at(-1);
  assert.equal(end.type,'CAPTURE_END');
  assert.equal(end.complete,false);
  assert.equal(end.count,0);
  assert.equal(end.mode,'visible-dom');
  assert.match(end.notice,/不能当作完整/);
});
