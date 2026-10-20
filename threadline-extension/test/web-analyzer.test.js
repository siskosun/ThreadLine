const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function create(hostname='chatgpt.com'){
 let listener, clicks=0, posted='';
 const field={value:'',focus(){},dispatchEvent(){},getBoundingClientRect(){return{width:500,height:50}}};
 const assistant={innerText:'{"version":1,"objective":"研究目标"}',getBoundingClientRect(){return{width:500,height:100}}};
 const button={disabled:false,focus(){},getBoundingClientRect(){return{width:30,height:30}},click(){clicks++;posted=field.value;field.value='';}};
 const document={querySelector(s){if(s==='#prompt-textarea')return field;if(s==='[data-testid="send-button"]')return button;return null;},querySelectorAll(s){return s.includes('data-message-author-role')&&clicks?[assistant]:[];}};
 const ctx={document,location:{hostname},chrome:{runtime:{onMessage:{addListener(fn){listener=fn}}}},getComputedStyle:()=>({display:'block',visibility:'visible'}),InputEvent:class{constructor(){}},Date,Promise,setTimeout,clearTimeout,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','web-analyzer.js'),'utf8'),ctx);
 const send=m=>new Promise(resolve=>listener(m,{},resolve));
 return {send,get clicks(){return clicks},get posted(){return posted},field};
}
test('manual ChatGPT webpage adapter reads latest settled response',async()=>{
 const x=create(),result=await x.send({type:'TL_WEB_ASK',prompt:'请总结研究内容'});
 assert.equal(result.ok,true);assert.ok(result.text.includes('研究目标'));
 assert.equal(x.clicks,1);assert.equal(x.posted,'请总结研究内容');
});
test('never send when input already contains draft',async()=>{
 const x=create();x.field.value='用户已有草稿';const result=await x.send({type:'TL_WEB_ASK',prompt:'研究摘要'});
 assert.equal(result.ok,false);assert.match(result.error,/已有未发送的草稿/);assert.equal(x.clicks,0);
});
test('reject giant prompts and unsupported origins before sending',async()=>{
 const x=create(),y=create('elsewhere.invalid');
 assert.match((await x.send({type:'TL_WEB_ASK',prompt:'a'.repeat(35000)})).error,/单次输入过长/);
 assert.match((await y.send({type:'TL_WEB_ASK',prompt:'研究摘要'})).error,/不是 ChatGPT/);
 assert.equal(x.clicks,0);assert.equal(y.clicks,0);
});
