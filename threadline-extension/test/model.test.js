const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
function perform(state, action, now=1000) { return Core.apply(state,action,now); }
function seed(){
  const out=perform(Core.emptyState(),{type:'createProject',name:'收入预测',chat:{key:'chat:alpha-1',title:'A',url:'https://chatgpt.com/c/alpha-1'}});
  return {state:out.state,id:out.result.projectId};
}
test('ChatGPT conversation id is stable across tab duplication, including project path',()=>{
 assert.equal(Core.getChatKey('https://chatgpt.com/c/ABC-123',11),'chat:abc-123');
 assert.equal(Core.getChatKey('https://chatgpt.com/g/g-p-abc/c/9f-99?x=1',19),'chat:9f-99');
 assert.equal(Core.getChatKey('https://chatgpt.com/',12),'tab:12');
 assert.equal(Core.getChatKey('https://chatgpt.com/share/secret',12),null);
 assert.equal(Core.getChatKey('https://evil.com/c/alpha',12),null);
});
test('creates a topic and links first chat',()=>{
 const {state,id}=seed();
 assert.equal(state.projects[0].name,'收入预测');
 assert.equal(state.chats['chat:alpha-1'].projectId,id);
 assert.equal(state.revision,1);
});
test('links multiple branches to one project and close propagates',()=>{
 const {state:s,id}=seed();
 const n=perform(s,{type:'linkChat',projectId:id,key:'chat:beta',title:'B',url:'https://chatgpt.com/c/beta'}).state;
 const closed=perform(n,{type:'updateProject',projectId:id,patch:{stage:'closed',decision:'完成回测，终止研究'}},2000).state;
 assert.equal(Core.getContext(closed,'chat:alpha-1').project.stage,'closed');
 assert.equal(Core.getContext(closed,'chat:beta').project.stage,'closed');
 assert.equal(Core.getContext(closed,'chat:beta').project.decision,'完成回测，终止研究');
 assert.equal(closed.projects[0].closedAt,2000);
 assert.equal(s.projects[0].stage,'active','old state remains immutable');
});
test('branch done cannot silently close entire project',()=>{
 const {state,id}=seed();
 const changed=perform(state,{type:'updateChat',key:'chat:alpha-1',patch:{stage:'done'}}).state;
 assert.equal(Core.getContext(changed,'chat:alpha-1').project.stage,'active');
 assert.equal(Core.getContext(changed,'chat:alpha-1').chat.stage,'done');
});
test('moving a chat to another project requires explicit link, resets stale branch status',()=>{
 let {state,id}=seed();
 state=perform(state,{type:'updateChat',key:'chat:alpha-1',patch:{stage:'done',label:'对照研究'}}).state;
 const second=perform(state,{type:'createProject',name:'成本研究'});
 state=perform(second.state,{type:'linkChat',key:'chat:alpha-1',projectId:second.result.projectId,title:'重新开始',url:'https://chatgpt.com/c/alpha-1'}).state;
 assert.notEqual(state.chats['chat:alpha-1'].projectId,id);
 assert.equal(state.chats['chat:alpha-1'].stage,'active');
 assert.equal(state.chats['chat:alpha-1'].label,'');
});
test('same project relink preserves completed branch and alias',()=>{
 let {state,id}=seed();
 state=perform(state,{type:'updateChat',key:'chat:alpha-1',patch:{stage:'done',label:'研究A'}}).state;
 state=perform(state,{type:'linkChat',key:'chat:alpha-1',projectId:id,title:'新标题',url:'https://chatgpt.com/c/alpha-1'}).state;
 assert.equal(state.chats['chat:alpha-1'].stage,'done');
 assert.equal(state.chats['chat:alpha-1'].label,'研究A');
});
test('new-chat pending id migrates without losing project state',()=>{
 const initial=perform(Core.emptyState(),{type:'createProject',name:'测试',chat:{key:'tab:7',title:'新对话',url:'https://chatgpt.com/'}});
 const s=perform(initial.state,{type:'remapPending',from:'tab:7',to:'chat:real-1',url:'https://chatgpt.com/c/real-1'}).state;
 assert.equal(s.chats['tab:7'],undefined);
 assert.equal(s.chats['chat:real-1'].projectId,initial.result.projectId);
});
test('pending migration collision never overwrites another established chat assignment',()=>{
 let {state,id}=seed();
 const second=perform(state,{type:'createProject',name:'B',chat:{key:'tab:7',title:'new',url:'https://chatgpt.com/'}});
 const s=perform(second.state,{type:'remapPending',from:'tab:7',to:'chat:alpha-1'}).state;
 assert.equal(s.chats['chat:alpha-1'].projectId,id);
 assert.equal(s.chats['tab:7'],undefined);
});
test('observe cannot revive closed project or reset done branch',()=>{
 let {state,id}=seed();
 state=perform(state,{type:'updateChat',key:'chat:alpha-1',patch:{stage:'done'}}).state;
 state=perform(state,{type:'updateProject',projectId:id,patch:{stage:'closed'}}).state;
 state=perform(state,{type:'observeChat',key:'chat:alpha-1',title:'ChatGPT 完成了任务',url:'https://chatgpt.com/c/alpha-1'}).state;
 assert.equal(state.chats['chat:alpha-1'].stage,'done');
 assert.equal(state.projects[0].stage,'closed');
});
test('reopen clears close timestamp but preserves conclusion',()=>{
 let {state,id}=seed();
 state=perform(state,{type:'updateProject',projectId:id,patch:{stage:'closed',decision:'已完成'}},2000).state;
 state=perform(state,{type:'updateProject',projectId:id,patch:{stage:'active'}},3000).state;
 assert.equal(state.projects[0].closedAt,null);
 assert.equal(state.projects[0].decision,'已完成');
});
test('clearClosed only removes closed projects and links',()=>{
 let {state,id}=seed();
 const another=perform(state,{type:'createProject',name:'B',chat:{key:'chat:b',title:'B',url:'https://chatgpt.com/c/b'}});
 state=perform(another.state,{type:'updateProject',projectId:id,patch:{stage:'closed'}}).state;
 const result=perform(state,{type:'clearClosed'});
 assert.equal(result.result.cleared,1);
 assert.equal(result.state.projects.length,1);
 assert.equal(result.state.chats['chat:alpha-1'],undefined);
 assert.equal(result.state.chats['chat:b'].projectId,another.result.projectId);
});
test('reject empty or huge malformed instructions',()=>{
 const {state,id}=seed();
 assert.throws(()=>perform(state,{type:'updateChat',key:'chat:alpha-1',patch:{stage:'invalid'}}),/无效分支状态/);
 assert.throws(()=>perform(state,{type:'updateProject',projectId:id,patch:{name:''}}),/不能为空/);
 assert.throws(()=>perform(state,{type:'linkChat',key:'not-a-key',projectId:id,url:'x'}),/无法识别/);
 assert.equal(state.projects[0].name,'收入预测');
});
test('invalid URL never enters chat binding',()=>{
 const {state,id}=seed();
 const next=perform(state,{type:'linkChat',key:'chat:test',projectId:id,title:'x',url:'https://not-chatgpt.com/hijack'}).state;
 assert.equal(next.chats['chat:test'].url,'');
});
test('local title similarity only suggests, never automatically links',()=>{
 const {state,id}=seed();
 const p=state.projects[0];
 p.name='收入预测模型对抗';
 assert.equal(Core.suggestProject('2027年收入预测效果',state.projects).id,id);
 assert.equal(Core.suggestProject('公司员工激励机制设计',state.projects),null);
 p.stage='closed';
 assert.equal(Core.suggestProject('收入预测模型效果',state.projects),null);
});
