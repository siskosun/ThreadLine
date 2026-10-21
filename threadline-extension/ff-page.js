chrome.runtime.sendMessage({type:"FF_STATUS"},response=>{
 const node=document.getElementById("ff-status");
 node.textContent=response?.ok&&response.data?.enabled===false
   ?"功能未启用。当前没有任何自动网页操作。"
   :"无法核实状态；所有操作保持禁用。";
});