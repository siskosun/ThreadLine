/* Shared, read-only mind-map renderer for the captured brief.
 * HTML only via textContent. No browser tabs, messages, network or writes. */
(function(root){
  "use strict";
  function groupsFor(brief){
    return brief?.mode==="ai"
      ? ThreadLineAI.mapGroups(brief)
      : ThreadLineCaptureCore.mapModel(brief);
  }
  function draw({canvas,brief,collapsed,zoom=1,onToggle}){
    if(!canvas||!brief)throw new Error("导图容器或来源提要缺失");
    const groups=groupsFor(brief),hidden=collapsed||new Set();
    const rows=groups.map(g=>({...g,expanded:!hidden.has(g.id),
      children:hidden.has(g.id)?0:Math.min(4,g.items.length)}));
    const padding=30,leafGap=70;
    let y=padding;
    for(const row of rows){
      const height=Math.max(78,row.children*leafGap+12);
      row.top=y;row.mid=y+height/2;y+=height+22;
    }
    const H=Math.max(310,y+20),W=820;
    canvas.replaceChildren();
    canvas.style.width=W+"px";canvas.style.height=H+"px";
    canvas.style.zoom=String(Math.max(.5,Math.min(1.5,Number(zoom)||1)));
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.classList.add("map-lines");
    svg.setAttribute("width",String(W));svg.setAttribute("height",String(H));
    svg.setAttribute("viewBox",`0 0 ${W} ${H}`);canvas.appendChild(svg);
    const node=(tag,classes,x,top,w,h,value,opts={})=>{
      const el=document.createElement(tag);
      el.className="map-node "+classes;
      Object.assign(el.style,{left:x+"px",top:top+"px",width:w+"px",height:h+"px"});
      el.textContent=String(value??"");
      if(opts.groupId!==undefined){
        el.type="button";
        el.setAttribute("aria-expanded",String(opts.expanded));
        el.setAttribute("aria-label",`${opts.expanded?"收起":"展开"} ${opts.label}`);
        el.addEventListener("click",()=>onToggle?.(opts.groupId));
      }
      canvas.appendChild(el);return el;
    };
    const curve=(x1,y1,x2,y2)=>{
      const path=document.createElementNS("http://www.w3.org/2000/svg","path");
      const mid=Math.round((x2-x1)*.55);
      path.setAttribute("d",`M ${x1} ${y1} C ${x1+mid} ${y1},${x2-mid} ${y2},${x2} ${y2}`);
      svg.appendChild(path);
    };
    node("div","root",12,H/2-35,160,70,brief.title);
    for(const group of rows){
      curve(172,H/2,238,group.mid);
      node("button","group",238,group.mid-25,150,50,`${group.expanded?"−":"＋"} ${group.label}`,
        {groupId:group.id,expanded:group.expanded,label:group.label});
      if(group.expanded){
        for(let i=0;i<group.children;i++){
          const top=group.top+6+i*leafGap;
          curve(388,group.mid,445,top+25);
          node("div","leaf",445,top,350,52,group.items[i]);
        }
      }
    }
    return {width:W,height:H,groups:rows.length};
  }
  const api=Object.freeze({groupsFor,draw});
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.ThreadLineResearchMap=api;
})(typeof globalThis!=="undefined"?globalThis:null);
