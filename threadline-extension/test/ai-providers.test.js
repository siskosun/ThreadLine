const {test}=require('node:test');const assert=require('node:assert/strict');const P=require('../ai-providers.js');
test('requires explicit provider and model selection',()=>{assert.throws(()=>P.config('evil','a'),/支持/);assert.equal(P.config('ollama').model,'qwen2.5:7b');assert.throws(()=>P.config('openai','model'),/API Key/);});
test('OpenAI call sends JSON request with no persistent response storage',async()=>{
 let u='',init={};const result=await P.request({kind:'openai',model:'gpt-4.1-mini',token:'sk-test-123456',instructions:'system',prompt:'user',fetchImpl:async(url,body)=>{u=url;init=body;return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'{"version":1}'}]}]})};}});
 assert.equal(u,'https://api.openai.com/v1/responses');assert.equal(JSON.parse(init.body).store,false);assert.equal(JSON.parse(init.body).text.format.type,'json_schema');assert.equal(JSON.parse(init.body).text.format.strict,true);assert.equal(init.headers.Authorization,'Bearer sk-test-123456');assert.equal(result,'{"version":1}');
});
test('Ollama call stays on loopback and cannot proxy to arbitrary origin',async()=>{
 let url='',opts;await P.request({kind:'ollama',model:'qwen2.5:7b',instructions:'system',prompt:'prompt',fetchImpl:async(u,o)=>{url=u;opts=o;return {ok:true,json:async()=>({message:{content:'{"version":1}'}})};}});
 assert.equal(url,'http://127.0.0.1:11434/api/chat');assert.equal(JSON.parse(opts.body).stream,false);assert.equal(opts.headers.Authorization,undefined);
});
test('provider errors are actionable without echoing credentials',async()=>{
 await assert.rejects(()=>P.request({kind:'openai',token:'sk-supersecret-test',instructions:'x',prompt:'x',fetchImpl:async()=>({ok:false,status:401,text:async()=> 'secret echoed'})}),err=>/401/.test(err.message)&&!/supersecret/.test(err.message));
});
test('connection errors identify local origin configuration',async()=>{
 await assert.rejects(()=>P.request({kind:'ollama',instructions:'x',prompt:'y',fetchImpl:async()=>{throw new Error('CORS');}}),/Ollama/);
});
test('incomplete responses are not silently accepted',()=>{
 assert.throws(()=>P.extractOpenAI({status:'incomplete',output:[{content:[{type:'output_text',text:'partial'}]}]}),/不完整/);
});
