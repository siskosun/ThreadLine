const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../core.js');
const run=(state,action,now=1000)=>Core.apply(state,action,now);
function sample(){
 const first=run(Core.emptyState(),{type:'createProject',name:'预测研究',chat:{key:'chat:a',title:'回测',url:'https://chatgpt.com/c/a'}});
 const projectId=first.result.projectId;
 const linked=run(first.state,{type:'linkChat',projectId,key:'chat:b',title:'独立审核',url:'https://chatgpt.com/c/b'});
 return {state:linked.state,projectId};
}
test('explicit substantive update makes only other branch stale, not the author',()=>{
 let {state,projectId}=sample();
 state=run(state,{type:'updateProject',projectId,sourceKey:'chat:a',patch:{decision:'模型 D 优于 E'}},2000).state;
 const p=Core.getProject(state,projectId);
 assert.equal(p.knowledgeVersion,1);
 assert.equal(p.lastChange.sourceKey,'chat:a');
 assert.equal(state.chats['chat:a'].seenVersion,1);
 assert.equal(state.chats['chat:b'].seenVersion,0);
 assert.equal(Core.isOutdated(state,state.chats['chat:a']),false);
 assert.equal(Core.isOutdated(state,state.chats['chat:b']),true);
});
test('viewing and relinking a branch does not falsely mark it as reviewed',()=>{
 let {state,projectId}=sample();
 state=run(state,{type:'updateProject',projectId,patch:{decision:'已验证'}}).state;
 state=run(state,{type:'observeChat',key:'chat:b',title:'独立审核（已加载）',url:'https://chatgpt.com/c/b'}).state;
 state=run(state,{type:'linkChat',key:'chat:b',projectId,title:'独立审核（再次关联）',url:'https://chatgpt.com/c/b'}).state;
 assert.equal(Core.isOutdated(state,state.chats['chat:b']),true);
 state=run(state,{type:'acknowledgeProject',key:'chat:b'}).state;
 assert.equal(Core.isOutdated(state,state.chats['chat:b']),false);
});
test('renaming project or saving unchanged details does not create fake new decisions',()=>{
 let {state,projectId}=sample();
 state=run(state,{type:'updateProject',projectId,sourceKey:'chat:a',patch:{name:'预测研究（2026）'}}).state;
 assert.equal(state.projects[0].knowledgeVersion,0);
 state=run(state,{type:'updateProject',projectId,patch:{goal:'',decision:'',stage:'active'}}).state;
 assert.equal(state.projects[0].knowledgeVersion,0);
});
test('closing and reopening updates versions and preserves closure date',()=>{
 let {state,projectId}=sample();
 state=run(state,{type:'updateProject',projectId,patch:{stage:'closed'}},2000).state;
 assert.equal(state.projects[0].knowledgeVersion,1);
 assert.equal(state.projects[0].closedAt,2000);
 state=run(state,{type:'updateProject',projectId,patch:{stage:'closed'}},2500).state;
 assert.equal(state.projects[0].knowledgeVersion,1);
 assert.equal(state.projects[0].closedAt,2000);
 state=run(state,{type:'updateProject',projectId,sourceKey:'chat:a',patch:{stage:'active'}},3000).state;
 assert.equal(state.projects[0].knowledgeVersion,2);
 assert.equal(state.projects[0].closedAt,null);
 assert.equal(state.chats['chat:a'].seenVersion,2);
 assert.equal(state.chats['chat:b'].seenVersion,0);
});
test('newly linked branch starts at current version; switching projects resets its read version',()=>{
 let {state,projectId}=sample();
 state=run(state,{type:'updateProject',projectId,patch:{decision:'先验结论'}}).state;
 state=run(state,{type:'linkChat',key:'chat:c',projectId,title:'新窗口',url:'https://chatgpt.com/c/c'}).state;
 assert.equal(state.chats['chat:c'].seenVersion,1);
 const newp=run(state,{type:'createProject',name:'其他课题'});
 state=run(newp.state,{type:'linkChat',key:'chat:b',projectId:newp.result.projectId,title:'B',url:'https://chatgpt.com/c/b'}).state;
 assert.equal(state.chats['chat:b'].seenVersion,0);
 assert.equal(Core.isOutdated(state,state.chats['chat:b']),false);
});
test('v0.4.1 state migration keeps original project and does not invent stale status',()=>{
 const {state}=sample();
 const legacy=structuredClone(state);
 legacy.projects[0].knowledgeVersion=undefined;
 delete legacy.projects[0].lastChange;
 delete legacy.chats['chat:a'].seenVersion;
 delete legacy.chats['chat:b'].seenVersion;
 const upgraded=Core.normalizedState(legacy);
 assert.equal(upgraded.schema,1);
 assert.equal(upgraded.projects[0].knowledgeVersion,0);
 assert.equal(upgraded.chats['chat:a'].seenVersion,0);
 assert.equal(Core.isOutdated(upgraded,upgraded.chats['chat:b']),false);
});
test('author cannot acknowledge another project by supplying unrelated sourceKey',()=>{
 let {state,projectId}=sample();
 const other=run(state,{type:'createProject',name:'另一个',chat:{key:'chat:x',title:'X',url:'https://chatgpt.com/c/x'}});
 state=run(other.state,{type:'updateProject',projectId,sourceKey:'chat:x',patch:{decision:'真实变化'}}).state;
 assert.equal(state.projects.find(p=>p.id===projectId).knowledgeVersion,1);
 assert.equal(state.chats['chat:x'].seenVersion,0);
 assert.equal(state.chats['chat:a'].seenVersion,0);
});
