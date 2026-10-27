"""Render actual MV3 extension versions with identical synthetic data.
Never uses user profiles, actual ChatGPT credentials, or real messages.
"""
import argparse
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

CHAT = """<!doctype html><html lang="zh"><head><title>演示研究对话</title></head>
<body><main><div data-message-author-role="user">研究方法比较</div>
<div data-message-author-role="assistant">全部内容均为用于截图的虚构案例。</div>
<form><div id="prompt-textarea" contenteditable="true"></div></form></main></body></html>"""

ITEMS = [
 ("结论应始终保留可核查的原始依据", "适用于有来源记录的研究任务。"),
 ("交接材料应区分正式结论与候选线索", "适用于跨对话接续研究。"),
 ("阅读结论时应同时核对适用条件", "仅用于虚构的产品研究案例。"),
 ("来源对话与查看课题是不同的身份", "适用于跨课题查阅。"),
 ("长列表应提供查询和状态筛选", "适用于结论数量较多的资料库。"),
 ("历史版本的正文和来源必须可追溯", "适用于正式采纳后需要修订的结论。"),
 ("人工审核能纠正自动提要中的偏差", "适用于能够取得来源片段的情形。"),
 ("宽页更适合长文阅读与复杂检索", "用于本次对比截图。"),
 ("侧栏应提供当前任务的快捷入口", "用于本次对比截图。"),
 ("未知回执不能直接作为提交成功处理", "用于虚构的可靠性演示。"),
]

def run(stage, ext, out):
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="threadline-vis-"+stage+"-") as profile:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                profile, channel="chromium", headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage",
                    "--disable-extensions-except="+str(ext),
                    "--load-extension="+str(ext)])
            try:
                ctx.route("https://chatgpt.com/**",
                    lambda route: route.fulfill(status=200,
                        content_type="text/html;charset=utf-8", body=CHAT))
                worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event(
                    "serviceworker",timeout=15000)
                ext_id = worker.url.split("/")[2]
                source = ctx.new_page()
                source.goto("https://chatgpt.com/c/synthetic-comparison",
                    wait_until="domcontentloaded")
                panel=ctx.new_page()
                panel.set_viewport_size({"width":360,"height":920})
                panel.set_default_timeout(18000)
                errors=[]
                panel.on("pageerror",lambda error:errors.append(str(error)))
                panel.goto("chrome-extension://"+ext_id+"/panel.html",
                    wait_until="domcontentloaded")
                panel.wait_for_selector("#nav-evidence",state="visible")
                if stage=="after":
                    panel.wait_for_selector("#library-open",state="visible")

                def send(message):
                    response=panel.evaluate("msg=>chrome.runtime.sendMessage(msg)",message)
                    if not response or not response.get("ok"):
                        raise AssertionError(str(response)[:900])
                    return response["data"]

                names=["研究方法比较","产品信息架构","证据阅读体验"]
                projects=[]
                for name in names:
                    result=send({"type":"MUTATE","action":{"type":"createProject","name":name}})
                    projects.append(next(o["id"] for o in result["state"]["projects"]
                        if o["name"]==name))
                for index,(text,conditions) in enumerate(ITEMS):
                    send({"type":"EV_ADOPT","projectId":projects[0],"text":text,
                      "conditions":conditions,
                      "fragments":[{"kind":"manual",
                          "selection":"合成依据：仅用于界面对比，不来自实际聊天。",
                          "relation":"supports","completeness":"complete"}],
                      "operationId":"op_vis_"+stage+"_"+str(index).zfill(5)})
                for index in [1,2]:
                    send({"type":"EV_ADOPT","projectId":projects[index],
                      "text":"这是另一课题的演示结论",
                      "conditions":"仅用于隔离环境下的截图。",
                      "fragments":[{"kind":"manual","selection":"虚构来源片段",
                          "relation":"supports","completeness":"complete"}],
                      "operationId":"op_vis_"+stage+"_other_"+str(index)})
                evidence=send({"type":"EV_LIST","projectId":projects[0]})
                assert len(evidence["rows"])==10
                first=next(row for row in evidence["rows"]
                    if "保留可核查" in row["current"]["text"])
                send({"type":"EV_AMEND","conclusionId":first["conclusion"]["id"],
                    "text":"结论（修订版）：论点、来源及适用条件应相互关联",
                    "conditions":"仅用于虚构的研究对话场景。",
                    "changeImpact":"substantive",
                    "expectedVersionId":first["current"]["id"],
                    "operationId":"op_vis_"+stage+"_rev"})
                panel.reload(wait_until="domcontentloaded")
                panel.wait_for_selector("#nav-evidence",state="visible")
                if stage=="after": panel.wait_for_selector("#library-open",state="visible")

                panel.get_by_role("tab",name="对话切换").click()
                panel.locator("#manage-accordion").evaluate("(el)=>el.open=true")
                panel.wait_for_function(
                  "()=>document.querySelectorAll('#topic-list .topic-card').length>=3")
                panel.evaluate("()=>window.scrollTo(0,0)")
                panel.screenshot(path=str(out/(stage+"_sidebar_topics.png")),
                    full_page=False,animations="disabled")
                panel.screenshot(path=str(out/(stage+"_sidebar_topics_full.png")),
                    full_page=True,animations="disabled")
                panel.get_by_role("tab",name="证据与交接").click()
                panel.wait_for_function(
                  "()=>document.querySelector('#evidence-project').options.length>=3")
                panel.locator("#evidence-project").select_option(projects[0])
                panel.wait_for_function(
                  "()=>document.querySelector('#evidence-list-count').textContent.includes('10 / 10')")
                panel.evaluate("()=>window.scrollTo(0,0)")
                panel.screenshot(path=str(out/(stage+"_sidebar_evidence.png")),
                    full_page=False,animations="disabled")
                panel.screenshot(path=str(out/(stage+"_sidebar_evidence_full.png")),
                    full_page=True,animations="disabled")
                assert not errors,errors
                if stage=="after":
                    with ctx.expect_page() as opening:
                        panel.locator("#library-open").click()
                    library=opening.value
                    library.set_viewport_size({"width":1280,"height":920})
                    library.set_default_timeout(18000)
                    library.wait_for_function(
                        "()=>document.documentElement.dataset.surface==='library'")
                    library.wait_for_function(
                        "pid=>document.querySelector('#evidence-project').value===pid",
                        arg=projects[0])
                    library.wait_for_function(
                        "()=>document.querySelector('#evidence-list-count').textContent.includes('10 / 10')")
                    library.evaluate("()=>window.scrollTo(0,0)")
                    library.screenshot(path=str(out/"after_library_evidence.png"),
                        full_page=False,animations="disabled")
                    library.screenshot(path=str(out/"after_library_evidence_full.png"),
                        full_page=True,animations="disabled")
                    library.get_by_role("tab",name="课题与对话").click()
                    library.wait_for_function(
                      "()=>document.querySelectorAll('#topic-list .topic-card').length>=3")
                    library.evaluate("()=>window.scrollTo(0,0)")
                    library.screenshot(path=str(out/"after_library_topics.png"),
                        full_page=False,animations="disabled")
                    library.screenshot(path=str(out/"after_library_topics_full.png"),
                        full_page=True,animations="disabled")
                    assert library.locator("#library-header").is_visible()
                print("CAPTURE_OK",stage,len(list(out.glob("*.png"))),flush=True)
            finally:
                ctx.close()

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--stage",choices=["before","after"],required=True)
    ap.add_argument("--extension",type=Path,required=True)
    ap.add_argument("--out",type=Path,required=True)
    args=ap.parse_args()
    run(args.stage,args.extension.resolve(),args.out.resolve())
