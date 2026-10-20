const {test}=require('node:test'),assert=require('node:assert/strict');
const core=require('../organize-core.js');
test('auto title prefers real topic, handles ChatGPT suffix and noise',()=>{
 assert.equal(core.projectName({title:'收入预测模型对抗 - ChatGPT',aim:'需要预测明年收入'}),'收入预测模型对抗');
 assert.equal(core.projectName({title:'New chat',aim:'请 研究一下 休闲游戏减员方案。下一步制定指标'}),'休闲游戏减员方案');
 assert.ok(core.projectName({title:'x'.repeat(65)}).length<=33);
});
test('scope ChatGPT conversation id and project id in project-scoped URLs',()=>{
 assert.equal(core.chatId('https://chatgpt.com/g/g-p-aa3/c/a-123'),'a-123');
 assert.equal(core.projectId('https://chatgpt.com/g/g-p-aa3/c/a-123'),'g-p-aa3');
 assert.equal(core.chatId('https://chatgpt.com/g/g-p-aa3/project'),'');
 assert.equal(core.projectId('https://example.com/c/x'),'');
});
test('remote name length and origin are constrained',()=>{
 assert.equal(core.validProjectName('a'),false);
 assert.equal(core.validProjectName('收入预测'),true);
 assert.equal(core.validProjectName('x'.repeat(81)),false);
 assert.equal(core.allowedChatUrl('https://chatgpt.com/c/a'),true);
 assert.equal(core.allowedChatUrl('https://phishing.example/c/a'),false);
});
