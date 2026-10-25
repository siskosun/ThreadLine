const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','research-ui.js'),'utf8');
test('research UI is local, bounded and explicit',()=>{
  for(const type of ['EV_RESEARCH_LIST','EV_RESEARCH_COMMAND','EV_REVIEW_PREPARE','EV_REVIEW_REFERENCE','EV_REVIEW_COMPLETE','EV_DEPENDENCY_PROMPT','EV_SUGGESTIONS_PREVIEW'])assert.match(source,new RegExp(type));
  assert.match(source,/一跳关系/);assert.match(source,/确认此条关系/);
  assert.match(source,/不自动发送或改写结论/);assert.match(source,/确认此条关系/);
  assert.doesNotMatch(source,/fetch\s*\(/);
});
