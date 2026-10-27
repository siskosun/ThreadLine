/* S0a adoption prototype page logic. Pages only send commands; the service
 * worker is the single evidence writer. These clocks measure synthetic
 * write acknowledgements, NOT review-to-commit human task time. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const send = payload => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response || !response.ok) return reject(new Error((response && response.error) || "后台无返回"));
      resolve(response.data);
    });
  });
  const notice = (message, error = false) => {
    $("ev-notice").textContent = message;
    $("ev-notice").dataset.error = String(error);
  };
  const PROJECTS = ["proto-p1", "proto-p2"];
  const FIXTURES = Array.from({ length: 12 }, (_, i) => ({
    text: "样例结论 " + (i + 1) + "：线路B转化率高于线路A，且复购结构更稳。",
    conditions: i % 3 === 0 ? "仅限本期投放数据" : "",
    fragments: [{
      selection: "线路B转化率 4.1%，线路A 3.2%；线路C复购率 18%。",
      before: "线上实测K4材料：",
      after: "线路D客单价260元。",
      relation: "supports", completeness: "complete"
    }]
  }));
  window.__timings = [];

  for (const id of PROJECTS) {
    const option = document.createElement("option");
    option.value = id; option.textContent = id;
    $("ev-project").appendChild(option);
  }

  function fragmentBox(f = {}) {
    const box = document.createElement("div");
    box.className = "frag";
    const mk = (label, value, rows) => {
      const area = document.createElement("textarea");
      area.rows = rows; area.value = value || ""; area.dataset.part = label;
      box.appendChild(area);
      return area;
    };
    mk("before", f.before, 1).placeholder = "前文上下文（≤500 cp）";
    mk("selection", f.selection, 2).placeholder = "选区原文（必填）";
    mk("after", f.after, 1).placeholder = "后文上下文（≤500 cp）";
    const row = document.createElement("div");
    row.className = "row";
    const rel = document.createElement("select");
    for (const r of ["cites", "supports", "opposes", "background"]) {
      const o = document.createElement("option");
      o.value = r; o.textContent = r; if ((f.relation || "cites") === r) o.selected = true;
      rel.appendChild(o);
    }
    rel.dataset.part = "relation";
    const comp = document.createElement("select");
    for (const c of ["complete", "partial", "unknown"]) {
      const o = document.createElement("option");
      o.value = c; o.textContent = c; if ((f.completeness || "unknown") === c) o.selected = true;
      comp.appendChild(o);
    }
    comp.dataset.part = "completeness";
    const del = document.createElement("button");
    del.type = "button"; del.className = "secondary"; del.textContent = "移除";
    del.addEventListener("click", () => box.remove());
    row.appendChild(rel); row.appendChild(comp); row.appendChild(del);
    box.appendChild(row);
    $("ev-fragments").appendChild(box);
  }
  fragmentBox();

  $("ev-add-fragment").addEventListener("click", () => fragmentBox());
  $("ev-load-fixture").addEventListener("click", () => loadFixture(currentFixtureIndex()));

  function currentFixtureIndex() {
    return Math.min(window.__timings.length, FIXTURES.length - 1);
  }
  function loadFixture(i) {
    const f = FIXTURES[i];
    $("ev-text").value = f.text;
    $("ev-conditions").value = f.conditions;
    $("ev-fragments").replaceChildren();
    for (const frag of f.fragments) fragmentBox(frag);
    notice("已载入样例 " + (i + 1) + "，可点击采纳。");
  }

  function collectFragments() {
    return [...document.querySelectorAll("#ev-fragments .frag")].map(box => {
      const part = name => box.querySelector('[data-part="' + name + '"]').value;
      return {
        before: part("before"), selection: part("selection"), after: part("after"),
        relation: part("relation"), completeness: part("completeness"),
        // Commit time is assigned by the authority, not a new source identity per click.
        kind: "manual"
      };
    });
  }

  function record(kind, ms, ok, extra) {
    window.__timings.push({mode:"synthetic_write_latency",kind,ms:Math.round(ms),ok,...(extra||{})});
    renderTimings();
  }
  function renderTimings() {
    const tbody = $("ev-timing-table").querySelector("tbody");
    tbody.replaceChildren();
    for (const t of window.__timings) {
      const tr = document.createElement("tr");
      for (const cell of [String(window.__timings.indexOf(t) + 1), t.kind,
        String(t.ms), t.ok ? "完成" : "失败：" + (t.error || "")]) {
        const td = document.createElement("td");
        td.textContent = cell;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  async function timedAdopt() {
    const t0 = performance.now();
    const operationId = "op_proto_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    try {
      const result = await send({
        type: "EV_ADOPT", projectId: $("ev-project").value,
        text: $("ev-text").value, conditions: $("ev-conditions").value,
        fragments: collectFragments(), operationId
      });
      const ms = performance.now() - t0;
      record("adopt", ms, true, { operationId, revision: result.revision });
      notice("已保存（修订 " + result.revision + "，" + Math.round(ms) + " ms）。");
      await refresh();
      return { ok: true, ms };
    } catch (e) {
      record("adopt", performance.now() - t0, false, { operationId, error: e.message });
      notice(e.message, true);
      return { ok: false, ms: performance.now() - t0 };
    }
  }
  $("ev-adopt").addEventListener("click", timedAdopt);

  async function refresh() {
    const data = await send({ type: "EV_LIST", projectId: $("ev-project").value });
    const holder = $("ev-list");
    holder.replaceChildren();
    if (!data.rows.length) {
      const empty = document.createElement("p");
      empty.className = "subtle"; empty.textContent = "尚无采纳结论。";
      holder.appendChild(empty);
    }
    for (const row of data.rows) {
      const item = document.createElement("div");
      item.className = "item";
      const head = document.createElement("p");
      head.className = "mono";
      head.textContent = (row.conclusion.status === "withdrawn" ? "[已撤回] " : "") +
        row.conclusion.id + " · 修订 " + (data.project ? data.project.evidenceRevision : "?") +
        (row.current ? " · " + row.current.text.slice(0, 80) : "");
      item.appendChild(head);
      for (const frag of row.fragments) {
        const box = document.createElement("div");
        box.className = "frag";
        const pre = document.createElement("pre");
        pre.style.whiteSpace = "pre-wrap";
        pre.textContent = (frag.before || "") + "【" + frag.selection + "】" + (frag.after || "");
        const meta = document.createElement("p");
        meta.className = "subtle";
        meta.textContent = "关系 " + frag.relation + " · 完整性 " + (frag.completeness || "unknown") +
          " · 哈希 " + String(frag.textHash || "").slice(0, 16) + "…";
        box.appendChild(pre); box.appendChild(meta);
        item.appendChild(box);
      }
      if (row.conclusion.status !== "withdrawn") {
        const withdraw = document.createElement("button");
        withdraw.type = "button"; withdraw.className = "secondary";
        withdraw.textContent = "撤回（保留历史）";
        withdraw.addEventListener("click", async () => {
          const t0 = performance.now();
          try {
            await send({ type: "EV_WITHDRAW", conclusionId: row.conclusion.id,
              reason: "原型协议撤回", expectedVersionId: row.current.id, operationId: "op_wd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12) });
            record("withdraw", performance.now() - t0, true, {});
            notice("已撤回（历史保留）。");
            await refresh();
          } catch (e) { record("withdraw", performance.now() - t0, false, { error: e.message }); notice(e.message, true); }
        });
        item.appendChild(withdraw);
      }
      holder.appendChild(item);
    }
    const summary = await send({ type: "EV_SUMMARY", projectId: $("ev-project").value });
    $("ev-summary").textContent = summary.summary;
  }
  $("ev-refresh").addEventListener("click", () => refresh().catch(e => notice(e.message, true)));
  $("ev-project").addEventListener("change", () => refresh().catch(e => notice(e.message, true)));

  /* Synthetic 12-operation storage performance diagnostic, not manual UX acceptance. */
  $("ev-run-protocol").addEventListener("click", async () => {
    $("ev-run-protocol").disabled = true;
    window.__timings = [];
    try {
      await send({ type: "EV_ENSURE", projectId: $("ev-project").value });
      for (let i = 0; i < 12; i++) {
        loadFixture(i);
        await new Promise(r => setTimeout(r, 50));
        await timedAdopt();
      }
      notice("合成写入成功 " + window.__timings.filter(t=>t.ok).length + "/12；仅供性能诊断，不计入人工任务验收。");
    } finally { $("ev-run-protocol").disabled = false; }
  });
  $("ev-copy-timings").addEventListener("click", async () => {
    const stats = timings();
    const payload = {protocol:"threadline-s0a-synthetic-write-latency/1",
      humanAcceptanceEligible:false,trials:window.__timings,...stats,at:new Date().toISOString()};
    try{
      await navigator.clipboard.writeText(JSON.stringify(payload,null,1));
      notice("合成写入数据已复制；中位 "+stats.medianMs+" ms，P90 "+stats.p90Ms+" ms，不计入人工验收。");
    }catch(error){notice("合成写入日志复制失败："+error.message,true);}

  });

  function timings() {
    const ok = window.__timings.filter(t => t.ok).map(t => t.ms).sort((a, b) => a - b);
    if (!ok.length) return { valid: 0, medianMs: null, p90Ms: null };
    const median = ok[Math.floor(ok.length / 2)];
    const p90 = ok[Math.min(ok.length - 1, Math.ceil(ok.length * 0.9) - 1)];
    return { valid: ok.length, medianMs: median, p90Ms: p90 };
  }
  window.__timingsStats = timings;

  (async function init() {
    try {
      for (const id of PROJECTS) await send({ type: "EV_ENSURE", projectId: id });
      const quota = await send({ type: "EV_QUOTA" });
      $("ev-quota").textContent = "storage.estimate: " + JSON.stringify(quota.estimate) +
        "\npersisted: " + quota.persisted;
      await refresh();
    } catch (e) { notice(e.message, true); }
  })();
})();
