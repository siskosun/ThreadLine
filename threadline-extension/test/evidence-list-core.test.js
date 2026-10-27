const test = require("node:test");
const assert = require("node:assert/strict");
const List = require("../evidence-list-core.js");

const data = Array.from({length:200}, (_,i)=>({
  conclusion:{id:"conclusion-"+i,status:i%5===0?"withdrawn":"active"},
  current:{text:i===151?"独特的核心判断":"本周研究结论 "+i,conditions:i===151?"特定范围":""}
}));

test("long evidence list renders only a bounded first page and loads more deterministically",()=>{
  const first=List.select(data);
  assert.equal(first.total,200);
  assert.equal(first.matched,200);
  assert.equal(first.rows.length,20);
  assert.equal(first.hasMore,true);
  assert.deepEqual(first.rows.map(r=>r.conclusion.id),data.slice(0,20).map(r=>r.conclusion.id));
  const more=List.select(data,{limit:40});
  assert.equal(more.rows.length,40);
  assert.deepEqual(more.rows.slice(0,20),first.rows);
  assert.equal(List.select(data,{limit:300}).hasMore,false);
});

test("query and status operate over all records including initially hidden rows",()=>{
  assert.deepEqual(List.select(data,{query:"核心判断"}).rows.map(r=>r.conclusion.id),["conclusion-151"]);
  assert.deepEqual(List.select(data,{query:"特定范围"}).rows.map(r=>r.conclusion.id),["conclusion-151"]);
  assert.equal(List.select(data,{status:"withdrawn",limit:300}).matched,40);
  assert.equal(List.select(data,{status:"active",limit:300}).matched,160);
  assert.equal(List.select(data,{status:"withdrawn",query:"核心判断"}).matched,0);
  assert.equal(List.select(data,{query:"not-found"}).total,200);
  assert.equal(List.select(data,{query:"not-found"}).matched,0);
});

test("preview truncation is explicitly marked and does not mutate complete source text",()=>{
  const row={conclusion:{id:"id"},current:{text:"甲乙丙丁戊己"}};
  assert.equal(List.preview(row,4),"甲乙丙丁…（展开查看全文）");
  assert.equal(row.current.text,"甲乙丙丁戊己");
  assert.equal(List.preview(row,10),"甲乙丙丁戊己");
  assert.equal(List.select(data,{limit:0}).rows.length,List.PAGE_SIZE);
});
