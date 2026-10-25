"""One isolated UI pass: real extension pages, synthetic evidence, no external site."""
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import expect, sync_playwright

EXT=Path(os.environ.get('THREADLINE_EXTENSION_PATH',Path(__file__).resolve().parents[1]))

def good(page,payload):
    reply=page.evaluate('p=>chrome.runtime.sendMessage(p)',payload)
    assert reply and reply.get('ok'),reply
    return reply['data']

def run():
  with TemporaryDirectory(prefix='threadline-interactions-') as profile:
    with sync_playwright() as pw:
      context=pw.chromium.launch_persistent_context(profile,channel='chromium',headless=True,
          args=['--no-sandbox','--disable-dev-shm-usage',f'--disable-extensions-except={EXT}',f'--load-extension={EXT}'])
      try:
        worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        base='chrome-extension://'+worker.url.split('/')[2]+'/'
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(base+'panel.html');page.wait_for_selector('#research-workbench',state='attached')
        page.set_viewport_size({'width':360,'height':900})
        expect(page.locator('#workspace-switch')).to_be_visible()
        page.locator('#nav-switch').focus();page.keyboard.press('End')
        expect(page.locator('#nav-evidence')).to_be_focused()
        expect(page.locator('#workspace-evidence')).to_be_visible()
        expect(page.locator('#workspace-switch')).to_be_hidden()
        expect(page.locator('#evidence-handoff')).to_be_disabled()
        page.keyboard.press('ArrowRight');expect(page.locator('#nav-switch')).to_be_focused()
        page.keyboard.press('ArrowRight');expect(page.locator('#nav-research')).to_be_focused()
        expect(page.locator('#capture-start')).to_be_disabled()

        page.locator('#nav-switch').click();page.locator('#manage-accordion > summary').click()
        page.locator('#topic-name').fill('界面测试课题 A');page.locator('#create-form button[type=submit]').click()
        expect(page.locator('#topic-list')).to_contain_text('界面测试课题 A')
        first=good(page,{'type':'SNAPSHOT'})['state']['projects'][0]['id']
        page.locator('#nav-evidence').click()
        expect(page.locator('#evidence-project option')).to_have_text('界面测试课题 A')
        projects=good(page,{'type':'MUTATE','action':{'type':'createProject','name':'界面测试课题 B'}})['state']['projects']
        second=next(p['id'] for p in projects if p['id']!=first)
        proto=context.new_page();proto.goto(base+'evidence-prototype.html')
        def adopt(project,text,index):
            return good(proto,{'type':'EV_ADOPT','projectId':project,'text':text,'conditions':'仅适用本次合成样本',
              'fragments':[{'kind':'manual','selection':'合成原始证据 '+str(index),'before':'','after':'','capturedAt':1}],
              'operationId':'op_ui_polish_'+str(index).zfill(8)})['conclusionId']
        a=adopt(first,'上游结论 A',1);b=adopt(first,'下游结论 B',2);c=adopt(first,'备选结论 C',3)
        adopt(second,'另一课题的结论',4)
        page.reload();page.wait_for_selector('#research-workbench',state='attached');page.locator('#nav-evidence').click()
        page.locator('#evidence-project').select_option(first)
        expect(page.locator('#evidence-list')).to_contain_text('上游结论 A')
        expect(page.locator('#evidence-summary')).to_contain_text('已采纳 3 条')

        # Editing is one form; cancel and Escape clean up and return focus.
        edit_button=page.locator('.evidence-item').filter(has_text='上游结论 A').get_by_role('button',name='修订',exact=True)
        edit_button.click();dialog=page.locator('dialog.tl-dialog')
        expect(dialog.locator('#tl-field-conditions')).to_have_value('仅适用本次合成样本')
        dialog.locator('#tl-field-text').fill('上游结论 A 的完整修订正文')
        dialog.get_by_role('button',name='保存新版本').click();expect(dialog).to_be_hidden()
        expect(page.locator('#evidence-list')).to_contain_text('完整修订正文')

        # Register an actual dependency and preserve unsaved review text on refresh.
        page.locator('#research-workbench > summary').click()
        page.locator('#research-target').select_option(b)
        page.locator('#research-upstream').select_option(a)
        page.locator('#research-downstream').select_option(b)
        page.locator('#research-reason').fill('下游采用上游作为必要前提')
        page.locator('#research-add').click()
        expect(page.locator('#research-notice')).to_contain_text('关系已保存')
        page.locator('#research-review-panel > summary').click()
        # A delayed prepare/reference response must never populate another target's form.
        page.evaluate("""()=>{window.__originalSend=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=(p,cb)=>{if(p.type==='EV_REVIEW_PREPARE')return window.__originalSend(p,r=>window.__releasePrepare=()=>cb(r));return window.__originalSend(p,cb);}}""")
        page.locator('#research-question').fill('准备 B 的材料，随后切换目标')
        page.locator('#research-prepare').click();page.wait_for_function('()=>!!window.__releasePrepare')
        page.locator('#research-target').select_option(c);page.evaluate('()=>{window.__releasePrepare();chrome.runtime.sendMessage=window.__originalSend}')
        expect(page.locator('#research-review-id')).to_have_value('')
        page.locator('#research-question').fill('核对 C 的材料');page.locator('#research-prepare').click()
        page.wait_for_function("()=>document.querySelector('#research-review-id').value.length>0")
        page.evaluate("""()=>{window.__originalSend=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=(p,cb)=>{if(p.type==='EV_REVIEW_REFERENCE')return window.__originalSend(p,r=>window.__releaseReference=()=>cb(r));return window.__originalSend(p,cb);}}""")
        page.locator('#research-reference-btn').click();page.wait_for_function('()=>!!window.__releaseReference')
        page.locator('#research-target').select_option(b)
        page.evaluate('()=>{window.__releaseReference();chrome.runtime.sendMessage=window.__originalSend}')
        expect(page.locator('#research-reference')).to_have_value('')
        expect(page.locator('#research-revised-text')).to_have_value('')
        page.locator('#research-question').fill('上游变更后，下游是否仍成立？')
        page.locator('#research-prepare').click()
        page.wait_for_function("()=>document.querySelector('#research-review-id').value.length>0")
        expect(page.locator('#research-reference')).to_have_value('')
        page.locator('#research-analysis').fill('尚未提交的独立分析，不应被刷新覆盖')
        page.locator('#research-review-reason').fill('尚未提交的理由')
        current=good(page,{'type':'EV_RESEARCH_LIST','projectId':first})
        av=next(r['current']['id'] for r in current['rows'] if r['conclusion']['id']==a)
        good(proto,{'type':'EV_AMEND','conclusionId':a,'text':'另一窗口修订上游 A','expectedVersionId':av,'operationId':'op_ui_polish_remote'})
        expect(page.locator('#research-pending')).to_contain_text('待核对 1 项')
        expect(page.locator('#research-analysis')).to_have_value('尚未提交的独立分析，不应被刷新覆盖')
        expect(page.locator('#research-review-reason')).to_have_value('尚未提交的理由')
        expect(page.locator('#research-upstream')).to_have_value(a)
        page.locator('#research-complete').click()
        expect(page.locator('#research-notice')).to_contain_text('已过期')
        expect(page.locator('#research-complete')).to_be_disabled()
        page.locator('#research-prepare').click()
        page.wait_for_function("()=>document.querySelector('#research-review-id').value.length>0")
        page.locator('#research-reference-btn').click()
        expect(page.locator('#research-revised-conditions')).to_have_value('仅适用本次合成样本')
        page.locator('#research-analysis').fill('已按当前原始材料重新核对')
        page.locator('#research-review-reason').fill('当前范围内保留下游')
        page.locator('#research-complete').click()
        expect(page.locator('#research-notice')).to_contain_text('复核结果已记录')
        expect(page.locator('#research-pending')).to_contain_text('没有已登记关系产生的待核对通知')
        page.locator('#research-reviews button').last.click()
        expect(page.locator('#research-complete')).to_be_disabled()
        expect(page.locator('#research-analysis')).to_have_value('已按当前原始材料重新核对')

        # A body-only review revision preserves conditions even without revealing old text.
        page.locator('#research-target').select_option(c)
        page.locator('#research-question').fill('仅修订 C 正文，条件未改')
        page.locator('#research-prepare').click();page.wait_for_function("()=>document.querySelector('#research-review-id').value.length>0")
        page.locator('#research-outcome').select_option('revise')
        page.locator('#research-revised-text').fill('C 的正文修订，条件仍保留')
        page.locator('#research-review-reason').fill('仅更正正文表述')
        page.locator('#research-complete').click();expect(page.locator('#research-notice')).to_contain_text('复核结果已记录')
        row=next(r for r in good(page,{'type':'EV_LIST','projectId':first})['rows'] if r['conclusion']['id']==c)
        assert row['current']['conditions']=='仅适用本次合成样本'

        # AI candidates cannot survive another revision and remain clickable.
        page.locator('#research-ai-panel > summary').click()
        prompt=good(page,{'type':'EV_DEPENDENCY_PROMPT','projectId':first})
        page.locator('#research-suggestions').fill(json.dumps({'scopeHash':prompt['scopeHash'],'proposals':[{'upstreamConclusionId':b,'downstreamConclusionId':c,'reason':'用户仍需确认的候选'}]},ensure_ascii=False))
        page.locator('#research-preview').click();expect(page.locator('#research-proposals button')).to_have_count(1)
        current=good(page,{'type':'EV_RESEARCH_LIST','projectId':first})
        cv=next(r['current']['id'] for r in current['rows'] if r['conclusion']['id']==c)
        good(proto,{'type':'EV_AMEND','conclusionId':c,'text':'备选结论 C 改版','expectedVersionId':cv,'operationId':'op_ui_polish_third'})
        expect(page.locator('#research-proposals button')).to_have_count(0)
        assert len(good(page,{'type':'EV_RESEARCH_LIST','projectId':first})['edges'])==1

        # Cross-project and in-flight edits own their handoff drafts; late replies cannot replace them.
        page.locator('#evidence-project').select_option(second);expect(page.locator('#evidence-handoff')).to_be_enabled()
        page.locator('#evidence-handoff').click();expect(page.locator('#evidence-handoff-view')).to_be_visible()
        page.locator('#evidence-project').select_option(first);expect(page.locator('#evidence-handoff')).to_be_enabled()
        page.evaluate("""()=>{window.__originalSend=chrome.runtime.sendMessage.bind(chrome.runtime);window.__handoffCount=0;chrome.runtime.sendMessage=(p,cb)=>{if(p.type==='EV_HANDOFF_PREPARE'){window.__handoffCount++;return window.__originalSend(p,r=>window.__releaseHandoff=()=>cb(r));}return window.__originalSend(p,cb);}}""")
        page.locator('#evidence-handoff').click();page.wait_for_function('()=>!!window.__releaseHandoff')
        page.locator('#evidence-project').select_option(second)
        page.locator('#evidence-handoff-view').fill('UNSAVED B HUMAN DRAFT')
        page.evaluate('()=>{window.__releaseHandoff();chrome.runtime.sendMessage=window.__originalSend}')
        expect(page.locator('#evidence-handoff-view')).to_have_value('UNSAVED B HUMAN DRAFT')
        page.locator('#evidence-project').select_option(first);expect(page.locator('#evidence-handoff')).to_be_enabled()
        page.locator('#evidence-handoff').click();expect(page.locator('#evidence-handoff-view')).to_be_visible()
        page.evaluate("""()=>{window.__originalSend=chrome.runtime.sendMessage.bind(chrome.runtime);window.__handoffCount=0;window.__releaseHandoff=null;chrome.runtime.sendMessage=(p,cb)=>{if(p.type==='EV_HANDOFF_PREPARE'){window.__handoffCount++;return window.__originalSend(p,r=>window.__releaseHandoff=()=>cb(r));}return window.__originalSend(p,cb);}}""")
        page.locator('#evidence-handoff').click();page.wait_for_function('()=>!!window.__releaseHandoff')
        page.locator('#evidence-handoff').evaluate("e=>e.dispatchEvent(new MouseEvent('click',{bubbles:true}))")
        page.locator('#evidence-handoff-view').fill('UNSAVED A EDIT DURING PREPARE')
        page.evaluate('()=>{window.__releaseHandoff();chrome.runtime.sendMessage=window.__originalSend}')
        expect(page.locator('#evidence-handoff-view')).to_have_value('UNSAVED A EDIT DURING PREPARE')
        assert page.evaluate('()=>window.__handoffCount')==1
        page.locator('#evidence-project').select_option(second)
        expect(page.locator('#evidence-handoff-view')).to_have_value('UNSAVED B HUMAN DRAFT')
        page.locator('#evidence-project').select_option(first)

        # Human-read records the clicked material, even if another project's draft is shown later.
        clicked_material=page.locator('#evidence-handoff-view').input_value()
        page.evaluate("""projectId=>{window.__originalSend=chrome.runtime.sendMessage.bind(chrome.runtime);window.__heldRead=false;chrome.runtime.sendMessage=(p,cb)=>{if(p.type==='EV_LIST'&&p.projectId===projectId&&!window.__heldRead){window.__heldRead=true;return window.__originalSend(p,r=>window.__releaseRead=()=>cb(r));}return window.__originalSend(p,cb);}}""",first)
        page.locator('#evidence-handoff-read').click();page.wait_for_function('()=>!!window.__releaseRead')
        page.locator('#evidence-project').select_option(second)
        page.evaluate('()=>{window.__releaseRead();chrome.runtime.sendMessage=window.__originalSend}')
        page.wait_for_function("""async id=>{const r=await chrome.runtime.sendMessage({type:'EV_RESEARCH_LIST',projectId:id});return r.ok&&r.data.project.handoffs.some(h=>h.events.some(e=>e.event==='human-read'));}""",arg=first)
        handoffs=good(page,{'type':'EV_RESEARCH_LIST','projectId':first})['project']['handoffs']
        assert [e['text'] for h in handoffs for e in h['events'] if e['event']=='human-read'][-1]==clicked_material
        page.locator('#evidence-project').select_option(first)

        # Real backup download leaves a durable success message, including after refresh.
        maintenance=page.locator('#evidence-maintenance');maintenance.locator('summary').first.click()
        maintenance.locator('select').first.select_option(first)
        page.evaluate('()=>{window.confirm=()=>true}')
        with page.expect_download() as download:
            maintenance.get_by_role('button',name='导出证据备份',exact=True).click()
        assert download.value.suggested_filename.endswith('.json')
        page.evaluate("()=>window.dispatchEvent(new Event('threadline-evidence-changed'))")
        expect(maintenance.locator('[role=status]')).to_contain_text('已导出')

        # Out-of-order file reads: the newer selected backup owns the preview.
        backup_a=good(page,{'type':'EV_BACKUP','projectId':first});backup_b=good(page,{'type':'EV_BACKUP','projectId':second})
        page.evaluate("""()=>{const original=File.prototype.text;File.prototype.text=async function(){if(this.name==='slow.json')await new Promise(r=>setTimeout(r,350));return original.call(this)}}""")
        file=maintenance.locator('input[type=file]')
        file.set_input_files({'name':'slow.json','mimeType':'application/json','buffer':json.dumps(backup_a).encode()})
        file.set_input_files({'name':'latest.json','mimeType':'application/json','buffer':json.dumps(backup_b).encode()})
        expect(page.locator('#evidence-maintenance-replace')).to_be_visible()
        page.locator('#evidence-maintenance-replace').check()
        expect(maintenance.get_by_role('button',name='确认恢复',exact=True)).to_be_enabled()
        page.wait_for_timeout(400)
        expect(maintenance.locator('.evidence-restore-preview')).to_contain_text('界面测试课题 B')
        maintenance.get_by_role('button',name='取消',exact=True).click()

        # A dropped delete result exposes an explicit same-operation retry, no automatic retry.
        page.evaluate("""()=>{const original=chrome.runtime.sendMessage.bind(chrome.runtime);window.__deleteCalls=0;chrome.runtime.sendMessage=(p,callback)=>{if(p.type==='EV_DELETE_COMMIT'){window.__deleteCalls++;if(window.__deleteCalls===1)return original(p,()=>callback({ok:false,error:'SIMULATED_UNCERTAIN_RESULT'}));}return original(p,callback);}}""")
        maintenance.locator('select').first.select_option(first)
        maintenance.get_by_role('button',name='预览删除范围',exact=True).click()
        retry=maintenance.get_by_role('button',name='重试未完成的删除清理')
        expect(retry).to_be_visible();page.wait_for_timeout(200)
        assert page.evaluate('()=>window.__deleteCalls')==1
        retry.click();expect(retry).to_be_hidden()
        expect(maintenance.locator('[role=status]')).to_contain_text('已删除')
        assert page.evaluate('()=>window.__deleteCalls')==2

        # Adoption cancellation does not claim success; retry reuses one operation identity.
        page.evaluate("""()=>{window.__adoptTries=[];window.__adoptDone=false;window.__openAdopt=()=>ThreadLineEvidenceAdoption.open({text:'明确结论',sources:[{label:'来源一',content:'相同片段 与第一份材料'},{label:'来源二',content:'相同片段 与第二份材料'}],submit:async form=>{window.__adoptTries.push(form.operationId);if(window.__adoptTries.length===1)throw Error('SIMULATED_RETRY');return {conclusionId:'con_ui_saved123'};}}).then(r=>window.__adoptDone=r);void window.__openAdopt();}""")
        adoption=page.locator('dialog.evidence-adoption-dialog');expect(adoption).to_be_visible();page.keyboard.press('Escape');expect(adoption).to_have_count(0)
        assert page.evaluate('()=>window.__adoptDone') is None
        page.evaluate('()=>{void window.__openAdopt()}');expect(adoption).to_be_visible()
        original=adoption.locator('textarea[aria-label="原始消息全文"]')
        original.evaluate('e=>{e.focus();e.setSelectionRange(0,4)}')
        adoption.get_by_role('button',name='使用上方选中文本').click()
        adoption.locator('.evidence-adoption-source select').first.select_option('1')
        excerpt=adoption.locator('textarea[aria-label="依据片段"]');expect(excerpt).to_have_value('')
        excerpt.fill('相同片段');adoption.get_by_role('button',name='确认采纳').click()
        expect(adoption).to_contain_text('SIMULATED_RETRY')
        adoption.get_by_role('button',name='确认采纳').click();expect(adoption).to_be_hidden()
        tries=page.evaluate('()=>window.__adoptTries');assert len(tries)==2 and tries[0]==tries[1]

        # Capture/report/map/manual-AI/ordinary adoption using only persisted synthetic text.
        good(page,{'type':'MUTATE','action':{'type':'linkChat','projectId':second,'key':'chat:synthetic-ui-record','title':'合成采集材料','url':'https://chatgpt.com/c/synthetic-ui-record'}})
        page.evaluate("""async ()=>{
          const id='capture-ui-polish';await ThreadLineCaptureDB.putRun({id,status:'done',title:'合成采集材料',conversationId:'synthetic-ui-record',url:'https://chatgpt.com/c/synthetic-ui-record',complete:false,mode:'dom',notice:'仅合成文本片段',pageCount:1,messageCount:2,createdAt:Date.now(),updatedAt:Date.now()});
          await ThreadLineCaptureDB.putPage({id,pageIndex:0,chunkIndex:0,messages:[{id:'source-user',role:'user',content:'请核对这项研究结论。'},{id:'source-assistant',role:'assistant',content:'这是需要继续核对的原始材料，不能直接当作已证实结论。'}]});await chrome.storage.local.set({tl_last_capture_id:id});
        }""")
        page.reload();page.wait_for_selector('#capture-report',state='attached');page.locator('#nav-research').click()
        expect(page.locator('#capture-report')).to_be_visible()
        page.locator('#ai-provider').select_option('openai');expect(page.locator('#ai-api-key')).to_be_visible()
        page.locator('#ai-provider').select_option('manual');expect(page.locator('#ai-auto-config')).to_be_hidden()
        page.locator('.ai-import-details > summary').click()
        report={'version':1,'title':'合成分析','objective':'核对证据','findings':[{'text':'可手工复核的模型候选','sources':[2]}],'pending':[{'text':'仍需验证样本范围','sources':[1]}],'next':[],'completed':[],'superseded':[],'closure':{'recommendation':'closed','reason':'模型建议，待核对'}}
        page.locator('#ai-json').fill(json.dumps(report,ensure_ascii=False));page.locator('#ai-import-manual').click()
        expect(page.locator('#ai-status')).to_contain_text('导入成功')
        expect(page.locator('#report-ai-meta')).to_contain_text('尚不能判断')
        expect(page.locator('#report-groups')).to_contain_text('可手工复核的模型候选')
        before=page.locator('#map-canvas').get_attribute('style');page.locator('#map-plus').click()
        assert page.locator('#map-canvas').get_attribute('style')!=before
        group=page.locator('.map-node.group').first;prior=group.get_attribute('aria-expanded');group.click()
        assert page.locator('.map-node.group').first.get_attribute('aria-expanded')!=prior
        page.locator('#report-promote-state').click();expect(page.locator('dialog.evidence-adoption-dialog')).to_have_count(0)
        page.locator('#report-groups').get_by_role('button',name='采纳此条为证据结论').first.click()
        adoption=page.locator('dialog.evidence-adoption-dialog');expect(adoption).to_be_visible()
        original=adoption.locator('textarea[aria-label="原始消息全文"]');original.evaluate('e=>{e.focus();e.setSelectionRange(0,e.value.length)}')
        adoption.get_by_role('button',name='使用上方选中文本').click();adoption.get_by_role('button',name='确认采纳').click();expect(adoption).to_be_hidden()
        page.evaluate('()=>window.confirm=()=>true');page.locator('#report-delete').click();expect(page.locator('#capture-report')).to_be_hidden()
        kept=good(page,{'type':'EV_LIST','projectId':second})
        assert any(f.get('captureRunId')=='capture-ui-polish' for r in kept['rows'] for f in r['fragments']), 'source snapshots survive independent cache deletion'
        page.locator('#nav-evidence').click()
        # Narrow and desktop pages have no horizontal page overflow with all tools open.
        page.locator("#workspace-evidence details").evaluate_all("items=>items.forEach(e=>e.open=true)")
        for width in [320,360,768,1280]:
            page.set_viewport_size({'width':width,'height':900})
            assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth'),width
        ff=context.new_page();ff.on('pageerror',lambda e:errors.append(str(e)));ff.goto(base+'ff.html');ff.locator('#ff-enable').check()
        ff.locator('#ff-p').fill('合成三分支任务');ff.locator('#ff-branch-count').select_option('3');ff.locator('#ff-save').click()
        expect(ff.locator('#ff-launch')).to_have_text('发起 3 个分支标签')
        # Oversized import is rejected before file.text, with no allocation/read.
        ff.locator('#ff-import-file').evaluate("e=>{const f=new File(['{}'],'oversized.json',{type:'application/json'});Object.defineProperty(f,'size',{value:21*1024*1024});f.text=()=>{throw Error('MUST_NOT_READ')};const d=new DataTransfer();d.items.add(f);e.files=d.files;e.dispatchEvent(new Event('change'));}")
        expect(ff.locator('#ff-notice')).to_contain_text('未读取内容')
        for width in [320,360,768,1280]:
            ff.set_viewport_size({'width':width,'height':900});assert ff.evaluate('()=>document.documentElement.scrollWidth<=innerWidth'),width
        assert not errors,errors
      finally:context.close()
  print('PASS: UI navigation/creation, form editing, review scope/conditions/races, handoff drafts, stale proposals, backup races, explicit delete retry, adoption cancellation/retry, capture/manual-AI/maps, K=3 and responsive layouts')

if __name__=='__main__':run()
