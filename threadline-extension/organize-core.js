/* ThreadLine v0.4: pure helpers for user-confirmed ChatGPT web organization.
   No private endpoints. No code copied from repositories without a LICENSE. */
const ThreadLineOrganizeCore = (() => {
  function chatId(url) {
    try {if(!allowedChatUrl(url))return '';return new URL(url, 'https://chatgpt.com/').pathname.match(/(?:^|\/)c\/([a-zA-Z0-9_-]+)/)?.[1] || '';}catch{return '';}
  }
  function projectId(url) {
    try{if(!allowedChatUrl(url))return '';return new URL(url, 'https://chatgpt.com/').pathname.match(/(?:^|\/)g\/(g-p-[a-zA-Z0-9_-]+)/)?.[1] || '';}catch{return '';}
  }
  function cleanText(raw, max = 70) {
    return String(raw ?? '').replace(/<[^>]*>/g, ' ').replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ')
      .replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  function projectName(brief) {
    const title = cleanText(brief?.mode === 'ai' ? brief?.title : brief?.title, 65).replace(/\s*[-–|]\s*ChatGPT$/i, '');
    const objective = cleanText(brief?.aim || '', 85)
      .replace(/^(?:(?:请|需要|我想|帮助我|帮我|如何|研究一下|研究|分析一下|分析|继续讨论|讨论|任务是|目标是)[：:，,\s]*)+/i, '')
      .replace(/[。！？!?;；:].*$/, '');
    const titleUsable = title && !/^(新对话|未命名|chatgpt|untitled|new chat)$/i.test(title);
    let name = titleUsable ? title : (objective || '未命名研究');
    if (name.length > 33) name = name.slice(0, 33).replace(/[，,、\s]+$/, '');
    return cleanText(name, 60) || '未命名研究';
  }
  function validProjectName(s){return typeof s === 'string' && cleanText(s,81).length >= 2 && cleanText(s,81).length <= 80 && !/[\x00-\x1f]/.test(s);}
  function equalText(a,b){return cleanText(a,240).toLocaleLowerCase().replace(/\s+/g,' ') === cleanText(b,240).toLocaleLowerCase().replace(/\s+/g,' ');}
  function allowedChatUrl(raw){try{const url=new URL(raw);return url.protocol==='https:'&&['chatgpt.com','chat.openai.com'].includes(url.hostname);}catch{return false;}}
  return {chatId,projectId,cleanText,projectName,validProjectName,equalText,allowedChatUrl};
})();
if(typeof globalThis!=='undefined')globalThis.ThreadLineOrganizeCore=ThreadLineOrganizeCore;
if(typeof module!=='undefined')module.exports=ThreadLineOrganizeCore;
