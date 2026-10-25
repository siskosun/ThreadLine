const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"), path=require("node:path");
const Evidence=require("../evidence-core.js"),Research=require("../research-core.js"),Workflows=require("../evidence-workflows.js");
const ext=name=>fs.readFileSync(path.join(__dirname,"..",name),"utf8");
test("S2 extends S1 without exposing S3-S5 worker commands or UI",()=>{
 const background=ext("background.js"),workflows=ext("evidence-workflows.js"),html=ext("panel.html");
 assert.ok(background.includes('research-core.js'));
 assert.ok(workflows.includes("EV_RESEARCH_COMMAND"));
 assert.ok(!workflows.includes("EV_REVIEW_PREPARE"));
 assert.ok(!workflows.includes("EV_REVIEW_COMPLETE"));
 assert.ok(!html.includes('src="research-ui.js"'));
 assert.ok(!html.includes('src="argdown-ui.js"'));
 assert.ok(!html.includes('src="vendor/argdown-adapter.js"'));
});
test("S2 accepts /3 necessary dependency records, rejects S3/S4 history",async()=>{
 const blank={format:"threadline-evidence/3",projectId:"p1",project:{takeover:false,research:Research.base(),handoffs:[]},conclusions:[],versions:[],sources:[],links:[]};
 assert.equal(await Evidence.validateExportPackage(blank),true);
 await assert.rejects(()=>Evidence.validateExportPackage({...blank,project:{takeover:false,research:{schema:1}}}),/格式或上限/);
});
test("S2 workflow rejects S3-S5 commands before any storage access",async()=>{
 const api=Workflows.create({});
 for(const type of ["EV_REVIEW_PREPARE","EV_REVIEW_COMPLETE","EV_REVIEW_REFERENCE"])
  assert.equal(await api.handle({type}),undefined);
});
