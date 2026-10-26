/* Small accessible form/confirmation dialogs. Failed submissions stay open for review. */
(() => {
  "use strict";
  const element=(tag,attrs={},text="")=>{const n=document.createElement(tag);Object.assign(n,attrs);n.textContent=text;return n;};
  function form({title,description="",fields,submitLabel="保存",onSubmit}) {
    return new Promise(resolve=>{
      const opener=document.activeElement,dialog=element("dialog",{className:"tl-dialog"}),body=element("form",{noValidate:true}),content=element("div",{className:"tl-dialog-body",tabIndex:0,role:"region",ariaLabel:title+"内容"});
      const heading=element("h2",{id:"tl-dialog-title"},title),help=element("p",{className:"subtle"},description);
      dialog.setAttribute("aria-labelledby",heading.id);content.append(heading,help);body.append(content);
      const controls={};let busy=false,finished=false;
      for(const field of fields){
        const label=element("label",{className:"tl-field"},field.label),id="tl-field-"+field.name;
        const control=element(field.type==="select"?"select":field.type==="textarea"?"textarea":"input",{id,name:field.name});
        label.htmlFor=id;
        if(field.type==="select")for(const item of field.options)control.add(new Option(item.label,item.value));
        else if(field.type==="textarea")control.rows=field.rows||4;
        else control.type=field.type||"text";
        if(field.type==="checkbox")control.checked=!!field.value;else control.value=field.value??"";
        if(field.required){control.required=true;control.setAttribute("aria-required","true");}
        if(Number.isSafeInteger(field.maxLength)&&field.maxLength>0)control.maxLength=field.maxLength;
        if(field.readOnly)control.readOnly=true;
        label.append(control);
        if(field.hint)label.append(element("small",{className:"subtle"},field.hint));
        controls[field.name]=control;content.append(label);
      }
      const status=element("p",{className:"tl-form-status",role:"status"});status.setAttribute("aria-live","polite");
      const actions=element("div",{className:"tl-actions"}),cancel=element("button",{type:"button",className:"secondary"},"取消"),save=element("button",{type:"submit",className:"primary"},submitLabel);
      actions.append(cancel,save);body.append(status,actions);dialog.append(body);document.body.append(dialog);
      const close=value=>{if(finished)return;finished=true;dialog.close();dialog.remove();if(opener?.isConnected)opener.focus();resolve(value);};
      cancel.onclick=()=>{if(!busy)close(null);};
      dialog.addEventListener("cancel",event=>{event.preventDefault();if(!busy)close(null);});
      body.onsubmit=async event=>{
        event.preventDefault();if(busy)return;
        for(const field of fields){const control=controls[field.name];control.removeAttribute("aria-invalid");
          if(field.required&&!control.value.trim()){status.textContent="请填写"+field.label;control.setAttribute("aria-invalid","true");control.focus();return;}
          if(field.maxPoints&&Array.from(control.value).length>field.maxPoints){status.textContent=field.label+"超过 "+field.maxPoints+" 字符";control.setAttribute("aria-invalid","true");control.focus();return;}
        }
        const values=Object.fromEntries(fields.map(f=>[f.name,f.type==="checkbox"?controls[f.name].checked:controls[f.name].value]));
        busy=true;dialog.setAttribute("aria-busy","true");[...Object.values(controls),cancel,save].forEach(c=>c.disabled=true);status.textContent="正在保存，请稍候…";
        try{const result=await onSubmit(values);close(result??values);}
        catch(error){status.textContent="提交失败或结果未确认："+error.message;status.dataset.error="true";}
        finally{busy=false;if(!finished){dialog.removeAttribute("aria-busy");[...Object.values(controls),cancel,save].forEach(c=>c.disabled=false);}}
      };
      dialog.showModal();(Object.values(controls).find(c=>!c.readOnly)||cancel).focus();
    });
  }
  function confirm({title,description="",confirmLabel="确认",cancelLabel="取消",danger=false}) {
    return new Promise(resolve=>{
      const opener=document.activeElement,dialog=element("dialog",{className:"tl-dialog tl-confirm-dialog"});
      const heading=element("h2",{id:"tl-confirm-title"},title);
      const content=element("div",{className:"tl-dialog-body",tabIndex:0,role:"region",ariaLabel:title+"说明"});
      const help=element("p",{className:"subtle"},description);
      content.append(heading,help);
      dialog.setAttribute("aria-labelledby",heading.id);
      const actions=element("div",{className:"tl-actions"});
      const cancel=element("button",{type:"button",className:"secondary"},cancelLabel);
      const accept=element("button",{type:"button",className:danger?"primary tl-danger":"primary"},confirmLabel);
      actions.append(cancel,accept);dialog.append(content,actions);document.body.append(dialog);
      let finished=false;
      const close=value=>{
        if(finished)return;
        finished=true;dialog.close();dialog.remove();
        if(opener?.isConnected)opener.focus();
        resolve(value);
      };
      cancel.addEventListener("click",()=>close(false));
      accept.addEventListener("click",()=>close(true));
      dialog.addEventListener("cancel",event=>{event.preventDefault();close(false);});
      dialog.showModal();accept.focus();
    });
  }
  globalThis.ThreadLineDialogs={form,confirm};
})();
