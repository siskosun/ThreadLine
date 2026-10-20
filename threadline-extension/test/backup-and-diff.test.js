const test=require('node:test');const assert=require('node:assert/strict');
const Core=require('../core.js');const Backup=require('../backup-core.js');
function make(){let s=Core.emptyState();let x=Core.apply(s,{type:'createProject',name:'收入预测'});s=x.state;
  const pid=x.result.projectId;s=Core.apply(s,{type:'linkChat',key:'chat:a',projectId:pid,title:'A',url:'https://chatgpt.com/c/a'}).state;
  s=Core.apply(s,{type:'linkChat',key:'chat:b',projectId:pid,title:'B',url:'https://chatgpt.com/g/g-p-123/c/b'}).state;
  return {state:s,pid};}
test('explicit schema v1 -> v2 migration is idempotent and preserves associations',()=>{
  const {state}=make();const old=structuredClone(state);old.schema=1;delete old.projects[0].history;
  delete old.chats['chat:b'].seenVersion;
  const migrated=Core.migrate(old),round2=Core.migrate(migrated);
  assert.equal(migrated.schema,2);assert.deepEqual(migrated,round2);
  assert.equal(migrated.chats['chat:b'].projectId,migrated.projects[0].id);
  assert.equal(migrated.chats['chat:b'].seenVersion,0);
});
test('future schema refuses mutation without erasing current data',()=>{
  const {state}=make();state.schema=999;assert.throws(()=>Core.apply(state,{type:'clearClosed'}),/更新版本/);
});
test('minor formatting does not bump, numeric evidence changes do',()=>{
  let {state,pid}=make();const update=value=>{const x=Core.apply(state,{type:'updateProject',projectId:pid,sourceKey:'chat:a',patch:{decision:value}});state=x.state;return x.result;};
  assert.equal(update('结论：收入为 1.25 亿。').knowledgeVersion,1);
  assert.equal(update('结论: 收入为 1.25 亿!').changed,false);
  assert.equal(update('结论：收入为 1.35 亿。').knowledgeVersion,2);
  assert.equal(Core.isOutdated(state,state.chats['chat:b']),true);
  const diffs=Core.changesSince(state.projects[0],0);
  assert.equal(diffs.items.length,2);
  assert.equal(diffs.items[1].before,'结论: 收入为 1.25 亿!');
  assert.equal(diffs.items[1].after,'结论：收入为 1.35 亿。');
});
test('project-goal and stage diff include the original value',()=>{
  let {state,pid}=make();state=Core.apply(state,{type:'updateProject',projectId:pid,patch:{goal:'旧目标',stage:'closed'}}).state;
  const items=Core.changesSince(state.projects[0],0).items;
  assert.deepEqual(items.map(x=>x.field),['goal','stage']);
  assert.equal(items[0].after,'旧目标');assert.equal(items[1].after,'closed');
});
test('history rolls and flags when early diffs are no longer available',()=>{
 let {state,pid}=make();for(let i=0;i<35;i++)state=Core.apply(state,{type:'updateProject',projectId:pid,patch:{decision:'实质性变化 '+i}}).state;
 assert.equal(state.projects[0].history.length,30);
 assert.equal(Core.changesSince(state.projects[0],0).truncated,true);
});
test('successful backup/restore contains state but no model secrets',()=>{
 const {state}=make();const data=Backup.create(state);const raw=JSON.stringify(data);const parsed=Backup.parse(raw);
 assert.equal(data.format,'threadline-state-backup-v1');assert.equal(parsed.projects.length,1);
 assert.ok(!raw.includes('apiKey'));
});
test('malformed, oversized and newer backups are rejected',()=>{
 assert.throws(()=>Backup.parse('{bad'),/JSON/);
 assert.throws(()=>Backup.parse('a'.repeat(2_000_001)),/2MB/);
 const {state}=make();assert.throws(()=>Backup.parse(JSON.stringify({format:Backup.FORMAT,schema:999,state})),/更新版本/);
});
test('import refuses data poisoning and mismatched conversation links',()=>{
 const {state}=make();const base=Backup.create(state);
 base.state.chats['chat:b'].url='javascript:alert(1)';assert.throws(()=>Backup.parse(JSON.stringify(base)),/链接/);
 base.state.chats['chat:b'].url='https://chatgpt.com/g/g-p-123/c/b';
 base.state.chats['chat:b'].key='chat:someone-else';assert.throws(()=>Backup.parse(JSON.stringify(base)),/标识/);
});
test('conversation UUID works before and after move into project',()=>{
 assert.equal(Core.getChatKey('https://chatgpt.com/c/1234-abcd'),'chat:1234-abcd');
 assert.equal(Core.getChatKey('https://chatgpt.com/g/g-p-example/c/1234-abcd'),'chat:1234-abcd');
});
