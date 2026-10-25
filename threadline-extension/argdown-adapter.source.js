/* Argdown interoperability adapter. The parser/model are bundled from the
 * official @argdown/core package; this wrapper only converts its model to the
 * small, reviewable ThreadLine preview format. */
// Deep package entry points avoid @argdown/core's optional graph exporters.
const { ArgdownApplication } = require("./node_modules/@argdown/core/dist/ArgdownApplication.js");
const { ParserPlugin } = require("./node_modules/@argdown/core/dist/plugins/ParserPlugin.js");
const { ModelPlugin } = require("./node_modules/@argdown/core/dist/plugins/ModelPlugin.js");

const MAX_BYTES = 200 * 1024;
const encoder = new TextEncoder();

function withinLimit(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Argdown 文本不能为空");
  if (encoder.encode(value).byteLength > MAX_BYTES) throw new Error("Argdown 文本超过 200 KiB");
}

function canonicalText(statement) {
  const member = [...(statement.members || [])].reverse().find(x => !x.isReference);
  return member?.text || "";
}

function parserWarnings(response) {
  const errors = [...(response.lexerErrors || []), ...(response.parserErrors || [])];
  if (errors.length) throw new Error("Argdown 语法无效：" + errors.slice(0, 3).map(x => x.message || x.name || "parse error").join("；"));
  return (response.exceptions || []).map(x => x.message || String(x));
}

function parse(text) {
  withinLimit(text);
  // Import only the official parser and model plugins. The package's convenience
  // `argdown` export also pulls in graphviz/SVG exporters, which are not used.
  const application = new ArgdownApplication();
  application.addPlugin(new ParserPlugin(), "parse-input");
  application.addPlugin(new ModelPlugin(), "build-model");
  const response = application.run({
    input: text,
    process: ["parse-input", "build-model"],
    parser: { throwExceptions: false },
    model: { mode: "loose" },
    logLevel: "error"
  });
  const warnings = parserWarnings(response);
  const statements = Object.values(response.statements || {}).map(statement => ({
    id: statement.title,
    label: statement.title,
    text: canonicalText(statement)
  })).filter(row => row.id && row.text);
  const relations = (response.relations || []).map(relation => ({
    fromLabel: relation.from?.title || null,
    toLabel: relation.to?.title || null,
    type: relation.relationType || "unknown"
  })).filter(row => row.fromLabel && row.toLabel);
  return { statements, relations, warnings };
}

function safeText(text) {
  // Keep newlines inside the same Argdown statement and escape syntax tokens.
  return String(text || "").replace(/\\/g, "\\\\").replace(/[\[\]@#*_<>{};]/g, "\\$&").replace(/\r?\n/g, "\n  ");
}

function labelFor(row) {
  const id = String(row.conclusion?.id || row.id || "");
  if (!/^con_[a-z0-9_-]{8,128}$/i.test(id)) throw new Error("只能导出带稳定结论 ID 的记录");
  return id;
}

function exportEvidence({ rows, edges }) {
  if (!Array.isArray(rows) || !Array.isArray(edges)) throw new Error("Argdown 导出数据无效");
  const labels = new Set();
  const definitions = rows.map(row => {
    const label = labelFor(row), text = row.current?.text ?? row.text;
    if (!String(text || "").trim()) throw new Error("结论正文不能为空");
    if (labels.has(label)) throw new Error("结论 ID 重复");
    labels.add(label);
    return `[${label}]: ${safeText(text)}`;
  });
  const outgoing = new Map();
  for (const edge of edges) {
    if (edge.active === false) continue;
    const from = edge.upstreamConclusionId, to = edge.downstreamConclusionId;
    if (!labels.has(from) || !labels.has(to)) continue;
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from).push(to);
  }
  const relations = [...outgoing.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([from, tos]) =>
    `[${from}]\n` + [...new Set(tos)].sort().map(to => `  +> [${to}]`).join("\n"));
  const output = [...definitions, ...relations].join("\n\n") + "\n";
  withinLimit(output);
  // Parse our own export with the official model before returning it.
  parse(output);
  return output;
}

module.exports = { parse, exportEvidence, MAX_BYTES };
