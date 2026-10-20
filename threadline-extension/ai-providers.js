/* Optional provider adapters. Never store tokens or send them to unrelated origins. */
const ThreadLineProviders=(()=>{
  const bases={openai:"https://api.openai.com/v1/responses",ollama:"http://127.0.0.1:11434/api/chat"};
  const defaults={openai:"gpt-4.1-mini",ollama:"qwen2.5:7b"};
  const item={type:"object",properties:{text:{type:"string"},sources:{type:"array",items:{type:"integer"}}},required:["text","sources"],additionalProperties:false};
  const analysisSchema={type:"object",properties:{
    version:{type:"integer",enum:[1]},title:{type:"string"},objective:{type:"string"},
    findings:{type:"array",items:item},completed:{type:"array",items:item},pending:{type:"array",items:item},
    next:{type:"array",items:item},superseded:{type:"array",items:item},
    closure:{type:"object",properties:{recommendation:{type:"string",enum:["closed","active","unknown"]},reason:{type:"string"}},required:["recommendation","reason"],additionalProperties:false}
  },required:["version","title","objective","findings","completed","pending","next","superseded","closure"],additionalProperties:false};
  function readableError(status,text){
    if(status===401)return "未授权（401）：请检查当前输入的 API Key";
    if(status===403)return "访问被拒绝（403）：请检查模型权限";
    if(status===429)return "请求频率或账户额度已达限制（429）";
    return `请求失败 (${status})：${String(text||"").slice(0,200)}`;
  }
  function extractOpenAI(body){
    if(body?.status==="failed"||body?.error)throw new Error("模型报告失败："+String(body.error?.message||"未知错误"));
    if(body?.status==="incomplete")throw new Error("模型返回不完整，请缩短输入或调整模型");
    const arr=[];
    for(const message of body?.output||[])for(const c of message.content||[])if(c.type==="output_text"&&typeof c.text==="string")arr.push(c.text);
    return arr.join("\n")||body?.output_text||"";
  }
  function config(kind,model,token){
    if(!Object.hasOwn(bases,kind))throw new Error("请选择受支持的模型提供方");
    const safeModel=String(model||defaults[kind]).trim();
    if(!safeModel||safeModel.length>100||/[\r\n]/.test(safeModel))throw new Error("模型名称无效");
    const key=String(token||"").trim();
    if(kind==="openai"&&(!/^sk-/.test(key)||key.length<12))throw new Error("OpenAI 模式需要有效 API Key。本功能不使用 ChatGPT 订阅额度。");
    return {kind,model:safeModel,key};
  }
  async function request({kind,model,token,instructions,prompt,signal,fetchImpl=fetch}){
    const c=config(kind,model,token);
    const init=c.kind==="openai"?{
      method:"POST",headers:{Authorization:`Bearer ${c.key}`,"Content-Type":"application/json"},
      body:JSON.stringify({model:c.model,store:false,input:[{role:"system",content:instructions},{role:"user",content:prompt}],text:{format:{type:"json_schema",name:"threadline_research_report",strict:true,schema:analysisSchema}}}),signal
    }:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:c.model,stream:false,format:"json",messages:[{role:"system",content:instructions},{role:"user",content:prompt}],options:{temperature:0}}),signal};
    let resp;
    try{resp=await fetchImpl(bases[c.kind],init);}catch(e){
      if(signal?.aborted)throw new Error("分析已取消");
      if(c.kind==="ollama")throw new Error("无法连接本机 Ollama。请确认服务已启动，并允许此扩展来源访问 127.0.0.1:11434。"+(e?.message||""));
      throw new Error("无法连接 OpenAI API："+(e?.message||"网络错误"));
    }
    if(!resp.ok)throw new Error(readableError(resp.status,await resp.text().catch(()=>"")));
    const payload=await resp.json();
    const result=c.kind==="openai"?extractOpenAI(payload):payload?.message?.content;
    if(typeof result!=="string"||!result.trim())throw new Error("模型返回为空或没有可用文本");
    return result;
  }
  return {bases,defaults,analysisSchema,request,config,extractOpenAI};
})();
if(typeof globalThis!=="undefined")globalThis.ThreadLineProviders=ThreadLineProviders;
if(typeof module!=="undefined")module.exports=ThreadLineProviders;
