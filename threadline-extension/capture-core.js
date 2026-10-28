/* ThreadLine capture and digest model: no external dependencies, no network requests. */
const ThreadLineCaptureCore = (() => {
  const CATEGORIES = ["研究目标", "已记录结论", "未解决问题", "可继续的工作"];
  const normalize = value => String(value ?? "").replace(/\u00a0/g, " ").replace(/\r/g, "").trim();
  function conversationId(href) {
    try {const u = new URL(href);if (!["chatgpt.com", "chat.openai.com"].includes(u.hostname)) return "";return u.pathname.match(/(?:^|\/)c\/([a-z0-9-]+)(?:\/|$)/i)?.[1]?.toLowerCase() || "";} catch {return "";}
  }
  function normalizePage(raw, index = 0) {
    if (!Array.isArray(raw)) return [];
    return raw.map((row,i) => ({
      id:normalize(row?.id || `page-${index}-${i}`),
      role:row?.role === "assistant" ? "assistant" : row?.role === "user" ? "user" : "other",
      content:normalize(row?.content),
      timestamp:Number(row?.timestamp) || null,
      hasNonText:!!row?.hasNonText,
      finished:row?.finished === true
    })).filter(x => (x.role === "assistant" || x.role === "user") && (x.content || x.hasNonText));
  }
  // Source pagination arrives newest page first; each page itself is oldest -> newest.
  function assemble(pages) {
    const sorted = [...(pages||[])].sort((a,b)=> b.pageIndex-a.pageIndex || a.chunkIndex-b.chunkIndex);
    const result = [], seen = new Set();
    for(const page of sorted) for(const item of normalizePage(page.messages,page.pageIndex)) {
      const id = item.id.startsWith("page-") ? `${page.pageIndex}:${item.id}` : item.id;
      if (seen.has(id)) continue;
      seen.add(id);result.push({...item,id});
    }
    return result;
  }
  const trim = (s,max=170) => normalize(s).replace(/\s+/g," ").replace(/^[-*•\d.)\s]+/,"").slice(0,max);
  const generic = /^(继续|接着|下一步|好|可以|同意|是|不对|为什么|再来|开始|确认|继续研究|继续测试|继续优化|继续进行|go on)[。！!？?\s]*$/i;
  function statements(text, maxlength=210) {
    return normalize(text).split(/\n+|(?<=[。！？!?])\s*/u).map(x=>trim(x,maxlength)).filter(x=>x.length>=14 && !generic.test(x) && !/^```|^\|[-: ]+\||^https?:\/\//.test(x));
  }
  function distinct(list,limit) {
    const ids=new Set(),out=[];
    for(const row of list){const s=trim(row.text,210);const key=s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu,"").slice(0,90);if(!key || ids.has(key))continue;ids.add(key);out.push({text:s,source:row.source});if(out.length>=limit)break;}
    return out;
  }
  function digest(messages,metadata={}) {
    const title=trim(metadata.title||"未命名研究",110),textMessages=(messages||[]).filter(m=>m.role==="user"||m.role==="assistant");
    const users=textMessages.map((m,i)=>({...m,pos:i})).filter(m=>m.role==="user" && trim(m.content).length>=18 && !generic.test(trim(m.content)));
    const first=users[0], last=users[users.length-1];
    const aim = first ? trim(first.content,215) : "尚未从对话中识别出明确研究目标";
    const latestQuestion=last && last!==first ? trim(last.content,195) : "";
    const assts=textMessages.map((m,i)=>({...m,pos:i})).filter(m=>m.role==="assistant");
    const decisionRE=/(结论|结果|发现|确认|已完成|验证|回测|测试|有效|证据|因此|判断|支持|显示|证明|收口|实现|通过)/;
    const unresolvedRE=/(尚未|仍需|待验证|待检查|不足|无法确认|有待|未知|未解决|缺少|存疑|限制|但.*(?:风险|问题)|不能证明)/;
    const nextRE=/(下一步|接下来|建议|需要继续|优先|可进行|应当|计划|继续验证|进一步|值得检查|待办)/;
    const collect = (pattern,max) => {
      const rows=[];
      // Most recent evidence first. Keep source indices for verification.
      for(let i=assts.length-1;i>=0;i--){const m=assts[i];for(const s of statements(m.content).reverse()){if(pattern.test(s))rows.push({text:s,source:m.pos+1});if(rows.length>=max*5)break;}if(rows.length>=max*5)break;}
      return distinct(rows,max);
    };
    const conclusions=collect(decisionRE,6),pending=collect(unresolvedRE,5),next=collect(nextRE,5);
    if(!conclusions.length && assts.length) {
      const lastA=assts[assts.length-1];conclusions.push(...distinct(statements(lastA.content).slice(0,2).map(text=>({text,source:lastA.pos+1})),2));
    }
    return {
      title, aim, latestQuestion, conclusions, pending, next,
      count:textMessages.length, mode:"rules", captureComplete:!!metadata.complete,
      warning:metadata.complete?"":"采集未覆盖全部历史；以下提要可能遗漏早期信息。",
      sourceUrl:metadata.url||"", sourceTabId:metadata.tabId||null,
      projectName:metadata.projectName||"",projectStage:metadata.projectStage||"",projectDecision:metadata.projectDecision||"",projectId:metadata.projectId||"",
      categories:CATEGORIES
    };
  }
  function mapModel(brief) {
    return [
      {id:"goal", label:CATEGORIES[0], items:[brief.aim,brief.latestQuestion].filter(Boolean)},
      {id:"conclusion",label:CATEGORIES[1],items:brief.conclusions.map(x=>x.text).slice(0,4)},
      {id:"pending",label:CATEGORIES[2],items:brief.pending.map(x=>x.text).slice(0,4)},
      {id:"next",label:CATEGORIES[3],items:brief.next.map(x=>x.text).slice(0,4)}
    ].map(group=>({...group,items:group.items.length?group.items:["对话中未识别到明确条目"]}));
  }
  function handoff(brief) {
    const section = (heading,rows) => `【${heading}】\n`+(rows.length?rows.map((row,i)=>`${i+1}. ${typeof row==="string"?row:row.text}`).join("\n"):"暂无明确记录");
    const aiDetails=brief.mode==="ai"?`\n${section("已完成的工作",brief.completed||[])}\n${section("已否定或被取代",brief.superseded||[])}\n模型收口建议：${brief.closureAdvice?.recommendation||"unknown"}，不改变权威状态\n`:"";
    return `我要接续一项已有研究。以下内容${brief.mode==="ai"?"来自 AI 归纳，仍需回源核查":"由本地规则从 ChatGPT 对话中提取，并非已核实的最终结论"}。请先辨别哪些只是历史提议或未经检验的推断，不要重复已明确收口的工作。\n\n来源：${brief.title}\n${brief.sourceUrl}\n${brief.projectName?`关联课题：${brief.projectName} / ${brief.projectStage==="closed"?"已收口":"进行中"}\n当前有效结论：${brief.projectDecision||"未填写"}\n`:""}采集：${brief.captureComplete?"全部已返回的文本页":"不完整，部分历史可能缺失"}\n\n${section("原研究目标",[brief.aim])}\n${section("最近提出的问题",brief.latestQuestion?[brief.latestQuestion]:[])}\n${section("历史回答中出现的结论候选（需核实）",brief.conclusions)}\n${aiDetails}${section("尚待核实的问题",brief.pending)}\n${section("下一步候选",brief.next)}\n\n请先对这些条目做去重和证据级别校对，指出真正未完成的任务，再提供最小可执行的下一步。`;
  }
  function analysisMaterial(messages,brief,maxChars=48000){
    const selected=[];
    const rows=messages.map((m,i)=>`[第${i+1}条 ${m.role==="user"?"用户":"助手"}]\n${normalize(m.content)}`).filter(x=>x.length>15);
    const budget=Math.max(5000,Math.min(150000,Number(maxChars)||48000));
    let total=0, i=rows.length-1;
    for(;i>=0;i--){const chunk=rows[i].slice(0,9000);if(total+chunk.length>budget*.78)break;selected.unshift(chunk);total+=chunk.length;}
    const start=[];
    for(let j=0;j<Math.min(8,i+1);j++){const s=rows[j].slice(0,3600);if(total+s.length>budget)break;start.push(s);total+=s.length;}
    const omitted=Math.max(0,rows.length-start.length-selected.length);
    return {
      text:`来源：${brief.title}\n原对话消息共 ${rows.length} 条；下面是${omitted?`部分抽样，遗漏中间 ${omitted} 条，不得声称通读全文`:"完整选取的文本消息"}。\n\n${start.join("\n\n")}\n${omitted?`\n[中间 ${omitted} 条消息未送入 AI，无法据此判断其结论]\n`:""}\n${selected.join("\n\n")}`,
      omitted,included:start.length+selected.length
    };
  }
  function analysisPrompt(messages,brief,maxChars=48000){
    const sample=analysisMaterial(messages,brief,maxChars);
    return {...sample,text:`请分析下面这项 ChatGPT 研究的对话记录，输出准确、简洁的中文摘要。严禁杜撰结论。明确区分已验证事实、未经验证的推断及已经放弃或被替代的方案。重点列出：①研究目标；②最关键的有效结论及可回溯的消息序号；③尚待验证的问题；④下一步最值得执行的具体行动；⑤Mermaid mindmap 思维导图（只使用简洁节点名）。如果课题已明确收口，第一行写“已收口，不建议重复研究”。\n\n${sample.text}`};
  }
  return {conversationId,normalizePage,assemble,digest,mapModel,handoff,analysisMaterial,analysisPrompt};
})();
if(typeof globalThis!=="undefined") globalThis.ThreadLineCaptureCore=ThreadLineCaptureCore;
if(typeof module!=="undefined")module.exports=ThreadLineCaptureCore;
