const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','capture-main.js'),'utf8');
function response(payload,status=200){return {ok:status<400,status,async json(){return payload}};}
async function simulate(api, options={}){
  const listeners=[],posted=[],requested=[],location={origin:'https://chatgpt.com',href:'https://chatgpt.com/g/g-p-123/c/abc-123',pathname:'/g/g-p-123/c/abc-123'};
  const window={location,addEventListener(type,cb){if(type==='message')listeners.push(cb);},postMessage(data,origin){posted.push(data);for(const cb of listeners)cb({source:window,origin,data});},async fetch(url,opts={}){requested.push({url:String(url),headers:new Headers(opts.headers||{})});return api(String(url),opts);}};
  vm.runInNewContext(source,{window,location,Headers,URL,URLSearchParams,AbortController,console,setTimeout,clearTimeout,structuredClone},{filename:'capture-main.js'});
  const id='cap-example';
  window.postMessage({channel:'threadline-capture-v2',direction:'extension-to-main',kind:'start',requestId:id,conversationId:'abc-123'},location.origin);
  const maxWait=Number(options.maxWaitMs)||600;
  let elapsed=0;while(!posted.some(x=>x.kind==='done'||x.kind==='error')&&elapsed<maxWait){await new Promise(r=>setTimeout(r,10));elapsed+=10;}
  return {posted,requested,window};
}
test('CGO-style pagination follows before cursor and assembles two pages without exposing credentials',async()=>{
  const raw=(id,role)=>({id,message:{id,author:{role},content:{parts:[`${id} content`]}}});
  const r=await simulate(async(url)=>{
    if(url.includes('/messages?')){assert.match(url,/before=u3/);return response({messages:[raw('u1','user'),raw('a1','assistant'),raw('u2','user'),raw('a2','assistant')],page_info:{has_previous_page:false,start_cursor:'u1'}});}
    return response({messages:[raw('u3','user'),raw('a3','assistant'),raw('u4','user'),raw('a4','assistant')],page_info:{has_previous_page:true,start_cursor:'u3'}});
  });
  assert.equal(r.posted.find(x=>x.kind==='done')?.complete,true);
  assert.equal(r.posted.find(x=>x.kind==='done')?.pageCount,2);
  assert.deepEqual(r.posted.filter(x=>x.kind==='page').map(x=>x.pageIndex),[0,1]);
  assert.ok(!JSON.stringify(r.posted).includes('authorization'));
});
test('paginated 404 falls back to legacy active-branch graph',async()=>{
  const r=await simulate(async(url)=>{
    if(url.includes('/conversations/'))return response({},404);
    return response({current_node:'a2',mapping:{u1:{parent:'',message:{id:'u1',author:{role:'user'},content:{parts:['first question']}}},a2:{parent:'u1',message:{id:'a2',author:{role:'assistant'},content:{parts:['first answer']}}}}});
  });
  assert.equal(r.posted.find(x=>x.kind==='done')?.mode,'legacy-active-path');
  assert.deepEqual(Array.from(r.posted.filter(x=>x.kind==='page')[0].messages,x=>x.id),['u1','a2']);
  assert.ok(r.posted.some(x=>x.kind==='reset'));
});
test('if both endpoints fail, reports failure rather than full success',async()=>{
  const r=await simulate(async()=>response({},401));
  assert.equal(r.posted.find(x=>x.kind==='done'),undefined);
  assert.match(r.posted.find(x=>x.kind==='error')?.message||'',/401/);
});
test('rate-limit and service-unavailable responses retry once then fail closed',async()=>{
  let requests=0;
  const r=await simulate(async()=>{requests++;return response({},requests%2?429:503);},{maxWaitMs:6000});
  assert.ok(requests>=4,'both pagination and legacy paths should each retry once');
  assert.equal(r.posted.find(x=>x.kind==='done'),undefined);
  assert.ok(r.posted.find(x=>x.kind==='error'));
});
test('current assistant hidden analysis messages are filtered from capture',async()=>{
  const r=await simulate(async()=>response({messages:[
    {id:'hidden',author:{role:'assistant'},channel:'analysis',content:{parts:['invisible private reasoning']}},
    {id:'visible',author:{role:'assistant'},content:{parts:['可见结论']}}
  ],page_info:{has_previous_page:false}}));
  const rows=r.posted.filter(x=>x.kind==='page').flatMap(x=>x.messages);
  assert.deepEqual(Array.from(rows,x=>x.id),['visible']);
  assert.equal(r.posted.find(x=>x.kind==='done')?.complete,true);
});

test('MAIN bridge cancellation aborts a hung private read without claiming completion',async()=>{
  const listeners=[],posted=[],location={
    origin:'https://chatgpt.com',href:'https://chatgpt.com/c/cancel-source',
    pathname:'/c/cancel-source'};
  let abortSeen=false;
  const window={location,addEventListener(type,cb){if(type==='message')listeners.push(cb);},
    postMessage(packet,origin){posted.push(packet);for(const fn of listeners)
      fn({source:window,origin,data:packet});},
    fetch(_url,opts={}){
      return new Promise((_resolve,reject)=>{
        if(opts.signal?.aborted){abortSeen=true;reject(new Error('aborted'));return;}
        opts.signal?.addEventListener('abort',()=>{
          abortSeen=true;reject(new Error('aborted'));
        },{once:true});
      });
    }};
  vm.runInNewContext(source,{window,location,Headers,URL,URLSearchParams,
    AbortController,console,setTimeout,clearTimeout,structuredClone},
    {filename:'capture-main.js'});
  const id='cap_cancelled_001';
  window.postMessage({channel:'threadline-capture-v2',direction:'extension-to-main',
    kind:'start',requestId:id,conversationId:'cancel-source'},location.origin);
  await new Promise(resolve=>setImmediate(resolve));
  window.postMessage({channel:'threadline-capture-v2',direction:'extension-to-main',
    kind:'cancel',requestId:id},location.origin);
  for(let i=0;i<20&&!abortSeen;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(abortSeen,true,'cancel must abort the in-flight fetch');
  assert.equal(posted.some(p=>p.kind==='done'),false,'aborted fetch is never a full capture');
  assert.equal(posted.some(p=>p.kind==='page'),false,'aborted request creates no page');
});
