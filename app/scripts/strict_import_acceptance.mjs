import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import XLSX from "xlsx";

const required = ["GROUP_FILE", "FRIEND_FILE", "DEVICE_FILE", "PHONE_FILE", "GOLDEN_DIR", "REPORT_DIR"];
for (const name of required) if (!process.env[name]) throw new Error(`缺少环境变量 ${name}`);
fs.mkdirSync(process.env.REPORT_DIR, { recursive: true });

const source = path.resolve("src/features/import/smart-table.ts");
const compiled = path.join(process.env.REPORT_DIR, ".smart-table.acceptance.mjs");
const output = ts.transpileModule(fs.readFileSync(source, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: source,
}).outputText;
fs.writeFileSync(compiled, output);
const { buildImportPlan, parseDelimited } = await import(`${pathToFileURL(compiled).href}?v=${Date.now()}`);

const cases = {
  group: { env: "GROUP_FILE", count: 496 },
  friend: { env: "FRIEND_FILE", count: 2255 },
  device: { env: "DEVICE_FILE", count: 74 },
  phone: { env: "PHONE_FILE", count: 8 },
};
const kindName = { qq: "QQ", group: "QQ群", phone: "手机号" };
const attrName = {
  query_role: "查询人角色", group_remark: "群备注", group_name: "群名称", avatar: "头像",
  announcement: "最新群公告", member_count: "群人数", last_message_at: "最后群消息时间",
  created_at: "群创建时间", description: "群简介", identifier: "标识id", friend_group: "分组",
  friend_remark: "好友备注", nickname: "昵称", registered_at: "注册时间", registration: "注册地",
  account_status: "账号状态", ban_count: "一年内被封次数", report_count: "一年内被举报次数",
  report_success_count: "一年内被举报成功次数", last_login_at: "最后一次登录时间",
  qq_credit: "QQ信用分", space_credit: "空间信用分", space_status: "空间状态",
  channel_status: "频道资格", device_signal: "关系", similarity: "相似度", phone_type: "手机号类型",
  set_at: "设置时间", modified_at: "修改时间", verified_at: "验证时间",
};
const stable = (value) => JSON.stringify(canonical(value));
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
};
const readCsv = (file) => {
  const text = fs.readFileSync(file, "utf8").replace(/^\ufeff/, "");
  const rows = XLSX.read(text, { type: "string", raw: false }).Sheets.Sheet1;
  return XLSX.utils.sheet_to_json(rows, { defval: "", raw: false });
};
const readRows = (file) => {
  if (!/\.xlsx$/i.test(file)) return parseDelimited(fs.readFileSync(file, "utf8").replace(/^\ufeff/, "")).rows;
  const book = XLSX.readFile(file, { raw: false, cellDates: false });
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: "", raw: false });
};
const attrsObject = (attrs, template) => Object.fromEntries(attrs.map((a) => [a.fieldKey === "avatar" && template === "group-list" ? "群头像" : attrName[a.fieldKey] ?? a.fieldKey, a.valueText]));
const compareMap = (actual, expected) => ({
  missing: [...expected.keys()].filter((key) => !actual.has(key)),
  extra: [...actual.keys()].filter((key) => !expected.has(key)),
  mismatch: [...expected.keys()].filter((key) => actual.has(key) && stable(canonical(actual.get(key))) !== stable(canonical(expected.get(key)))),
});
const evaluate = (plan, goldenEntities, goldenRelations, expectedRelations) => {
  const actualEntities = new Map([...plan.sourceEntities, ...plan.targetEntities].map((e) => [`${kindName[e.kind]}:${e.key}`, e.attributes.length ? [attrsObject(e.attributes, plan.template)] : []]));
  const groupedRows = new Map();
  for (const row of plan.rowDecisions) if (row.relationKey) {
    const relation = row.relations[0] ?? plan.relations.find((r) => `${r.sourceKind}\0${r.sourceKey}\0${r.label}\0${r.targetKind}\0${r.targetKey}` === row.relationKey);
    if (!relation) continue;
    const key = `${kindName[relation.sourceKind]}:${relation.sourceKey}|${relation.label}|${kindName[relation.targetKind]}:${relation.targetKey}`;
    const value = groupedRows.get(key) ?? { attributes: [], rawRecords: [] };
    value.attributes.push(attrsObject(row.relationAttributes, plan.template));
    value.rawRecords.push(row.rawRecord);
    groupedRows.set(key, value);
  }
  const entityDiff = compareMap(actualEntities, goldenEntities);
  const relationDiff = compareMap(groupedRows, goldenRelations);
  const cipherEndpoints = plan.relations.filter((r) => !/^\d+$/.test(r.sourceKey) || !/^\d+$/.test(r.targetKey)).length;
  const pass = plan.canSubmit && plan.relations.length === expectedRelations && cipherEndpoints === 0 &&
    Object.values(entityDiff).every((v) => v.length === 0) && Object.values(relationDiff).every((v) => v.length === 0);
  return { pass, template: plan.template, templateMode: plan.templateMode, canSubmit: plan.canSubmit, counts: { rows: plan.stats.total, entities: actualEntities.size, relations: plan.relations.length, expectedRelations }, cipherEndpoints, entityDiff, relationDiff, entityKeys: [...actualEntities.keys()].sort(), relationKeys: [...groupedRows.keys()].sort() };
};
const negativeResult = (rows) => {
  const plan = buildImportPlan(rows, { hasHeader: false });
  return { template: plan.template, templateMode: plan.templateMode, canSubmit: plan.canSubmit, error: plan.stats.error, pass: !plan.canSubmit && plan.stats.error === 0 };
};
const reports = {};
for (const [name, config] of Object.entries(cases)) {
  const file = process.env[config.env];
  const rows = readRows(file);
  const goldenRoot = path.join(process.env.GOLDEN_DIR, name);
  const goldenEntities = new Map(readCsv(path.join(goldenRoot, "entities.csv")).map((r) => [r.entity_key, JSON.parse(r.attributes_json)]));
  const goldenRelations = new Map(readCsv(path.join(goldenRoot, "relations.csv")).map((r) => [r.dedupe_key, { attributes: JSON.parse(r.attributes_json), rawRecords: JSON.parse(r.raw_records_json) }]));
  const headered = evaluate(buildImportPlan(rows, { hasHeader: true }), goldenEntities, goldenRelations, config.count);
  const dataRows = rows.slice(1);
  const headerless = evaluate(buildImportPlan(dataRows, { hasHeader: false }), goldenEntities, goldenRelations, config.count);
  const random = dataRows.map((row, i) => row.map((_, j) => `random-${name}-${i}-${j}`));
  const brokenAnchor = dataRows.map((row) => [...row]);
  const anchor = { group: 3, friend: 4, device: 2, phone: 3 }[name];
  brokenAnchor[0][anchor] = `broken-${name}-anchor`;
  const shifted = dataRows.map((row) => [...row.slice(1), row[0]]);
  const negatives = { random: negativeResult(random), brokenAnchor: negativeResult(brokenAnchor), shiftedOneColumn: negativeResult(shifted) };
  const sameSets = stable(headered.entityKeys) === stable(headerless.entityKeys) && stable(headered.relationKeys) === stable(headerless.relationKeys);
  delete headered.entityKeys; delete headered.relationKeys; delete headerless.entityKeys; delete headerless.relationKeys;
  reports[name] = { input: file, headered, headerless, sameSets, negatives, pass: headered.pass && headerless.pass && headered.templateMode === "strict-header" && headerless.templateMode === "strict-positional" && sameSets && Object.values(negatives).every((result) => result.pass) };
}
const report = { schemaVersion: "strict-cross-impl-v2-headerless", generatedAt: new Date().toISOString(), pass: Object.values(reports).every((r) => r.pass), implementations: { actual: "src/features/import/smart-table.ts via TypeScript transpile", golden: "Python strict-import-lab CSV results" }, cases: reports };
const reportPath = path.join(process.env.REPORT_DIR, "cross-impl-report.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.rmSync(compiled);
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
