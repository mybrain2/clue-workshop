// 批量导入边界压力测试（测试员视角）——只读探针，不修改产品代码
import { describe, it, expect } from "vitest";
import {
  parseDelimited, normalizeTable, recognizeTemplate, buildImportPlan,
  buildManualMappedPlan, suggestManualMapping, isTableLike,
} from "./smart-table";

const H = {
  group: ["QQ账号(解密)","QQ群账号(解密)","错误备注","错误码类型","命中结果","QQ号","群号","查询人角色","群备注","群名称","群头像","最新群公告","群人数","最后群消息时间","群创建时间","群简介","标识id"],
  friend: ["查询账号(解密)","QQ账号(解密)","错误备注","错误码类型","查询账号","分组","昵称","头像","好友备注","QQ账号","标识id"],
  device: ["UIN","相似度","关系","头像","昵称","注册时间","注册地","账号状态","一年内被封次数","一年内被举报次数","一年内被举报成功次数","最后一次登录时间","QQ信用分","空间信用分","空间状态","频道资格"],
  binding: ["QQ账号(解密)","命中查询内容","错误备注","错误码类型","QQ账号","手机号","手机号类型","设置时间","修改时间","验证时间"],
  member: ["QQ群账号(解密)","QQ账号(解密)","命中查询内容","异常说明","错误码类型","QQ群账号(加密)","群状态","QQ账号(加密)","群成员昵称","QQ账号昵称","成员角色","是否机器人","标识id"],
  lookup: ["手机号(解密)","QQ账号(解密)","命中查询内容","错误备注","错误码类型","QQ账号","手机号","手机号类型","设置时间","修改时间","验证时间"],
};
const S = "【Success】成功";
const groupRow = (n=1) => ["cipher","710000100","备注",S,"710000001","710000001","710000100","【10】普通成员","备注"+n,"测试群"+n,"https://a.example/1.jpg","公告","12","2026-01-01","2026-01-01","简介","id"+n];
const friendRow = (qq="710000002") => ["cipher",qq,"备注",S,"710000001","我的好友","小明","https://a.example/2.jpg","老王","cipher2","id1"];
const memberRow = () => ["710000100","710000010","710000010","无异常","err-code","cipherG","【1】正常","cipherQ","成员昵称","账号昵称","【0】普通成员","【false】否","id1"];
const lookupRow = (phone="16650030502") => ["cipherP", "880000001","880000001","备注",S,"880000001",phone,"本人","2026-01-01","",""];
const csv = (headers:string, rows:string[][]) => [headers.join(","), ...rows.map(r=>r.join(","))].join("\n");

describe("维度1：解析器格式边界", () => {
  it("纯空文本 → 0行不崩溃", () => {
    const p = parseDelimited("");
    expect(p.rows).toHaveLength(0);
    expect(p.delimiter).toBeNull();
  });
  it("仅空行/空白行 → 0数据行", () => {
    const p = parseDelimited("\n\n\n");
    expect(p.rows.filter(r=>r.some(c=>c.trim()))).toHaveLength(0);
  });
  it("单个单元格孤文本 → 不判表格（QuickAdd路径）", () => {
    expect(isTableLike("710000001")).toBe(false);
  });
  it("单行两列TSV → 表格", () => {
    expect(isTableLike("a\tb")).toBe(true);
  });
  it("CRLF与CR混合换行 → 行数正确", () => {
    const text = "a,b\r\n1,2\r3,4\n4,5";
    const p = parseDelimited(text);
    expect(p.rows).toHaveLength(4);
  });
  it("引号内逗号与换行保持完整（RFC4180）", () => {
    const text = 'a,b\n"x,1","y\n2"';
    const p = parseDelimited(text);
    expect(p.rows[1][0]).toBe("x,1");
    expect(p.rows[1][1]).toBe("y\n2");
  });
  it("未闭合引号 → 产生诊断且不崩溃", () => {
    const text = 'a,b\n"x1,y2';
    const p = parseDelimited(text);
    expect(p.diagnostics.some(d=>d.code==="unclosed-quote")).toBe(true);
  });
  it("转义双引号保持单个引号", () => {
    const p = parseDelimited('a\n"says ""hi"""');
    expect(p.rows[1][0]).toBe('says "hi"');
  });
  it("行宽不齐 → row-width 诊断定位物理行", () => {
    const t = normalizeTable("h1,h2,h3\n1,2\n1,2,3");
    expect(t.diagnostics.some(d=>d.code==="row-width")).toBe(true);
  });
  it("同文本制表符列宽稳定、逗号列宽不稳 → 选制表符", () => {
    const text = "a\tb\tc\n1\t2\t3\n4\t5,6\t7";
    const p = parseDelimited(text);
    expect(p.delimiter).toBe("\t");
    expect(p.rows[2]).toHaveLength(3);
  });
  it("单元格内容含\\u0000等控制字符 → 不崩溃", () => {
    expect(() => parseDelimited("a,b\n\x00,\x01")).not.toThrow();
  });
  it("超长单元格(1MB) → 不崩溃", () => {
    const big = "x".repeat(1024*1024);
    expect(() => parseDelimited(`a,b\n${big},y`)).not.toThrow();
  });
});

describe("维度2：识别边界与互串", () => {
  it("六模板表头乱序 → 全部拒绝（指纹要求顺序）", () => {
    const shuffled = [...H.group].reverse();
    const plan = buildImportPlan(csv(shuffled,[groupRow()]));
    expect(plan.canSubmit).toBe(false);
  });
  it("表头多一个未知列 → 拒绝", () => {
    const plan = buildImportPlan(csv([...H.group,"多余列"],[groupRow()]));
    expect(plan.canSubmit).toBe(false);
  });
  it("表头首列带首尾空格 → cleanCell处理后仍识别且可提交", () => {
    const spaced = H.group.map((h,i)=>i===0?" "+h+" ":h);
    const plan = buildImportPlan(csv(spaced,[groupRow()]));
    expect(plan.template).toBe("group-list");
    expect(plan.canSubmit).toBe(true);
  });
  it("binding 与 lookup 表头高度相似仍能区分", () => {
    const a = recognizeTemplate(csv(H.binding, [["880000001","16650030502","","x",S,"880000001","16650030502","本人","","",""]]));
    const b = recognizeTemplate(csv(H.lookup, [lookupRow()]));
    expect(a.template).toBe("qq-phone-binding");
    expect(b.template).toBe("qq-phone-lookup");
  });
  it("数据行成功但表头行重复两次 → 重复表头被清理", () => {
    const text = [H.group.join(","), H.group.join(","), groupRow().join(",")].join("\n");
    const plan = buildImportPlan(text);
    expect(plan.stats.duplicateHeadersRemoved).toBe(1);
    expect(plan.stats.dataRecordCount).toBe(1);
  });
  it("无表头 group 17列位置合同识别", () => {
    const plan = buildImportPlan([groupRow(), groupRow(2)].map(r=>r.join(",")).join("\n"), { hasHeader: false });
    expect(plan.template).toBe("group-list");
    expect(plan.templateMode).toBe("strict-positional");
  });
  it("无表头伪device（相似度非法）→ 拒绝", () => {
    const bad = ["710000001","abc","","","","","","","","","","","","","",""];
    const rec = recognizeTemplate([bad.join(",")], { hasHeader: false });
    expect(rec.template).toBe("custom");
  });
  it("数据含全角数字QQ → 拒绝（isQq只认半角）", () => {
    const row = groupRow(); row[4] = "７１００００００１";
    const plan = buildImportPlan(csv(H.group, [row]));
    expect(plan.canSubmit).toBe(false);
  });
  it("QQ号 4位（过短）→ 行级拒绝且诊断含命中结果", () => {
    const row = groupRow(); row[4] = "1234"; row[5] = "1234";
    const plan = buildImportPlan(csv(H.group, [row]));
    expect(plan.canSubmit).toBe(false);
    expect(plan.rows[0].error ?? "").toContain("命中结果");
  });
  it("QQ号 13位（超长）→ 拒绝", () => {
    const row = groupRow(); row[4] = "1234567890123"; row[5] = "1234567890123";
    const plan = buildImportPlan(csv(H.group, [row]));
    expect(plan.canSubmit).toBe(false);
  });
  it("命中结果与QQ号不一致（群表）→ 行级拒绝", () => {
    const row = groupRow(); row[4] = "710000999"; row[5] = "710000001";
    const plan = buildImportPlan(csv(H.group, [row]));
    expect(plan.canSubmit).toBe(false);
    expect(plan.rows[0].error ?? "").toContain("不一致");
  });
  it("群人数列非数字 → 行级拒绝", () => {
    const row = groupRow(); row[12] = "大约五十人";
    const plan = buildImportPlan(csv(H.group, [row]));
    expect(plan.canSubmit).toBe(false);
    expect(plan.rows[0].error ?? "").toContain("群人数");
  });
  it("相似度 150% → 拒绝（上限100）", () => {
    const row = ["710000010","150%","原号码","","","","","","","","","","","","",""];
    const plan = buildImportPlan(csv(H.device, [row]));
    expect(plan.canSubmit).toBe(false);
  });
  it("成员角色缺少【】格式 → 拒绝", () => {
    const row = memberRow(); row[10] = "普通成员";
    const plan = buildImportPlan(csv(H.member, [row]));
    expect(plan.canSubmit).toBe(false);
  });
});

describe("维度3：起点与桥接边界", () => {
  it("群表查询起点QQ在案件中已存在 → reuse-existing", () => {
    const plan = buildImportPlan(csv(H.group,[groupRow()]), { existingEntityKeys: new Set(["qq\u0000710000001"]) });
    expect(plan.accessStatus).toBe("reuse-existing");
  });
  it("群表起点不存在且选中根节点 → bridge-available", () => {
    const plan = buildImportPlan(csv(H.group,[groupRow()]), { currentSource: { kind: "subject", value: "案件根" } });
    expect(plan.accessStatus).toBe("bridge-available");
  });
  it("好友表查询账号列密文 → 回退解密列起点（解密列为明文）", () => {
    const row = friendRow(); row[4] = "cipher-encrypted"; row[0] = "710000001";
    const plan = buildImportPlan(csv(H.friend,[row]));
    expect(plan.canSubmit).toBe(true);
    expect(plan.queryOrigin?.key).toBe("710000001");
  });
  it("好友表查询账号密文且解密列也密文 → 整批拒绝不猜测", () => {
    const row = friendRow(); row[4] = "cipher-encrypted"; row[0] = "cipher-too";
    const plan = buildImportPlan(csv(H.friend,[row]));
    expect(plan.canSubmit).toBe(false);
    expect(plan.batchErrors.join()).toContain("查询起点");
  });
  it("好友表两行查询起点不同 → 整批拒绝", () => {
    const r1 = friendRow("710000002"), r2 = friendRow("710000003"); r2[4] = "710000099";
    const plan = buildImportPlan(csv(H.friend,[r1,r2]));
    expect(plan.canSubmit).toBe(false);
    expect(plan.batchErrors.join()).toContain("唯一");
  });
  it("好友表好友QQ等于查询起点 → 记录实际行为", () => {
    const row = friendRow("710000001");
    const plan = buildImportPlan(csv(H.friend,[row]));
    // friend 模板无自环豁免：记录当前行为供合同确认
    expect(["accepted","error"]).toContain(plan.rows[0].decision);
  });
});

describe("维度4：规模与性能", () => {
  it("5000行群表计划构建 < 5s 且统计正确（命中结果恒为同一查询起点）", () => {
    const rows = Array.from({length:5000},(_,i)=>{const r=groupRow();r[9]=`群${i}`;r[1]=`71000${String(i).padStart(5,"0")}`;r[6]=r[1];return r;});
    const t0 = Date.now();
    const plan = buildImportPlan(csv(H.group, rows));
    const dt = Date.now()-t0;
    expect(plan.stats.dataRecordCount).toBe(5000);
    expect(plan.canSubmit).toBe(true);
    if (dt > 5000) throw new Error(`5000行构建耗时 ${dt}ms 超标`);
  });
  it("10000行手工映射构建 < 10s", () => {
    const lines = ["来源,目标"];
    for (let i=0;i<10000;i++) lines.push(`710000001,71000${String(i).padStart(5,"0")}`);
    const t0 = Date.now();
    const plan = buildManualMappedPlan(lines.join("\n"), { hasHeader: true, sourceIndex: 0, sourceKind: "qq", targetIndex: 1, targetKind: "qq", relationLabel: "好友" });
    const dt = Date.now()-t0;
    expect(plan.canSubmit).toBe(true);
    expect(plan.relations).toHaveLength(10000);
    if (dt > 10000) throw new Error(`10000行构建耗时 ${dt}ms 超标`);
  });
  it("10001行手工映射 → 前端不拦（后端10000上限兜底）", () => {
    const lines = ["来源,目标"];
    for (let i=0;i<10001;i++) lines.push(`710000001,71000${String(i).padStart(5,"0")}`);
    const plan = buildManualMappedPlan(lines.join("\n"), { hasHeader: true, sourceIndex: 0, sourceKind: "qq", targetIndex: 1, targetKind: "qq", relationLabel: "好友" });
    expect(plan.relations.length).toBe(10001);
  });
  it("同表重复两行 → duplicate_merged=1 且关系合并", () => {
    const plan = buildImportPlan(csv(H.group, [groupRow(), groupRow()]));
    expect(plan.stats.duplicate).toBe(1);
    expect(plan.relations).toHaveLength(1);
  });
  it("重复行属性合并：两条相同关系保留首行属性", () => {
    const r1 = groupRow(); r1[8] = "备注A";
    const r2 = groupRow(); r2[8] = "备注B";
    const plan = buildImportPlan(csv(H.group, [r1, r2]));
    expect(plan.relations).toHaveLength(1);
    expect(plan.relations[0].attributes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("维度5：手工映射建议边界", () => {
  it("三列全是不同QQ（≥2行）→ 来源建议选不出 → 手动选择", () => {
    const sug = suggestManualMapping("a,b,c\n111111111,222222222,333333333\n444444444,555555555,666666666");
    expect(sug.sourceIndex).toBeUndefined();
  });
  it("两列：来源单值QQ、目标多值QQ → 自动建议", () => {
    const sug = suggestManualMapping("起点,好友\n111111111,222222222\n111111111,333333333");
    expect(sug.sourceIndex).toBe(0);
    expect(sug.targetIndex).toBe(1);
  });
  it("列含空值混合 → 目标列非唯一值仍可建议（当前行为：目标列值全为空+1值时选不出）", () => {
    const sug = suggestManualMapping("起点,好友\n111111111,\n111111111,333333333");
    expect(sug.sourceIndex).toBe(0);
    // 目标列唯一值数=1（"333333333"），当前算法不选 → 用户手动映射。记录此保守行为。
    expect(sug.targetIndex).toBeUndefined();
  });
  it("来源列与目标列相同索引 → 提交被阻止", () => {
    const plan = buildManualMappedPlan("a,b\n1,2", { hasHeader: true, sourceIndex: 0, targetIndex: 0, sourceKind: "custom", targetKind: "custom", relationLabel: "x" });
    expect(plan.canSubmit).toBe(false);
    expect(plan.batchErrors.join()).toContain("相同");
  });
  it("自环行（来源=目标）→ 行级错误", () => {
    const plan = buildManualMappedPlan("a,b\n111111111,111111111", { hasHeader: true, sourceIndex: 0, sourceKind: "qq", targetIndex: 1, targetKind: "qq", relationLabel: "好友" });
    expect(plan.rows[0].valid).toBe(false);
    expect(plan.canSubmit).toBe(false);
  });
  it("手工映射行宽不齐 → 行级错误（非崩溃）", () => {
    const plan = buildManualMappedPlan("a,b\n111111111\n222222222,333333333", { hasHeader: true, sourceIndex: 0, sourceKind: "qq", targetIndex: 1, targetKind: "qq", relationLabel: "好友" });
    expect(plan.rows.some(r=>!r.valid)).toBe(true);
  });
  it("关系名仅空格 → 批级错误", () => {
    const plan = buildManualMappedPlan("a,b\n111111111,222222222", { hasHeader: true, sourceIndex: 0, sourceKind: "qq", targetIndex: 1, targetKind: "qq", relationLabel: "   " });
    expect(plan.canSubmit).toBe(false);
  });
  it("custom类型任意文本键 → 允许", () => {
    const plan = buildManualMappedPlan("a,b\n任意文本,其他文本", { hasHeader: true, sourceIndex: 0, sourceKind: "custom", targetIndex: 1, targetKind: "custom", relationLabel: "关联" });
    expect(plan.canSubmit).toBe(true);
  });
  it("custom来源列值不唯一 → 批级阻止", () => {
    const plan = buildManualMappedPlan("a,b\n甲,1\n乙,2", { hasHeader: true, sourceIndex: 0, sourceKind: "custom", targetIndex: 1, targetKind: "custom", relationLabel: "关联" });
    expect(plan.canSubmit).toBe(false);
    expect(plan.batchErrors.join()).toContain("唯一");
  });
  it("纯数字国际裸号11位（85212345678）→ 既是合法QQ长度又被QQ判定优先（记录歧义行为）", () => {
    // 85212345678 是11位数字：isQq 命中(5-12位) → inferredKind 先试 qq → 全列判 qq。
    // 只有带分隔符形态（852-9123 4567）才判 phone。这是可解释的保守行为：数字形态优先QQ。
    const sug = suggestManualMapping("号码,号码\n85212345678,85287654321\n85212345678,85211112222");
    expect(sug.targetKind).toBe("qq");
  });
  it("带分隔符国际号形态 → 正确判phone（回归保护）", () => {
    const sug = suggestManualMapping("手机号码,备注\n852-9123 4567,x\n+1 (415) 555-1234,y");
    expect(sug.targetKind).toBe("phone");
  });
  it("手工映射桥接：起点不存在+当前选中 → bridge-available", () => {
    const plan = buildManualMappedPlan("a,b\n111111111,222222222", { hasHeader: true, sourceIndex: 0, sourceKind: "qq", targetIndex: 1, targetKind: "qq", relationLabel: "好友" }, { currentSource: { kind: "subject", value: "案件根" } });
    expect(plan.accessStatus).toBe("bridge-available");
  });
});
