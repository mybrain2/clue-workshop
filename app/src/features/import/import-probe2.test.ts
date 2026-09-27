// 维度6：同机专测 + 维度7：手机号方向 + 维度8：群成员 + 维度9：桥接合同
import { describe, it, expect } from "vitest";
import { buildImportPlan, currentClueBridge, withCurrentClueBridge, recognizeTemplate } from "./smart-table";

const H = {
  group: ["QQ账号(解密)","QQ群账号(解密)","错误备注","错误码类型","命中结果","QQ号","群号","查询人角色","群备注","群名称","群头像","最新群公告","群人数","最后群消息时间","群创建时间","群简介","标识id"],
  friend: ["查询账号(解密)","QQ账号(解密)","错误备注","错误码类型","查询账号","分组","昵称","头像","好友备注","QQ账号","标识id"],
  device: ["UIN","相似度","关系","头像","昵称","注册时间","注册地","账号状态","一年内被封次数","一年内被举报次数","一年内被举报成功次数","最后一次登录时间","QQ信用分","空间信用分","空间状态","频道资格"],
  binding: ["QQ账号(解密)","命中查询内容","错误备注","错误码类型","QQ账号","手机号","手机号类型","设置时间","修改时间","验证时间"],
  member: ["QQ群账号(解密)","QQ账号(解密)","命中查询内容","异常说明","错误码类型","QQ群账号(加密)","群状态","QQ账号(加密)","群成员昵称","QQ账号昵称","成员角色","是否机器人","标识id"],
  lookup: ["手机号(解密)","QQ账号(解密)","命中查询内容","错误备注","错误码类型","QQ账号","手机号","手机号类型","设置时间","修改时间","验证时间"],
};
const S = "【Success】成功";
const csv = (headers:string, rows:string[][]) => [headers.join(","), ...rows.map(r=>r.join(","))].join("\n");

describe("维度6：同机（qq-device）专测", () => {
  // UIN列是"同机结果QQ"；查询起点来自当前选中或"原号码"行；起点不出现在目标列
  const row = (uin:string, sim="0.9", rel="同设备IMEI:abc") => [uin,sim,rel,"","","","","","","","","","","","",""];
  it("未选中QQ且唯一原号码 → file-origin 起点接管，原号码行也是结果", () => {
    const rows = [row("710000002","1","原号码"), row("710000003")];
    const plan = buildImportPlan(csv(H.device, rows));
    expect(plan.queryOrigin?.key).toBe("710000002");
    expect(plan.parentSelectionReason).toBe("file-origin");
    expect(plan.relations).toHaveLength(1);
  });
  it("选中QQ → fallback-current-selection，原号码行也是结果", () => {
    const rows = [row("710000002","1","原号码"), row("710000003")];
    const plan = buildImportPlan(csv(H.device, rows), { currentSource: "710000001" });
    expect(plan.queryOrigin?.key).toBe("710000001");
    expect(plan.parentSelectionReason).toBe("fallback-current-selection");
    expect(plan.relations).toHaveLength(2);
    expect(plan.relations.map(r=>r.targetKey)).toEqual(["710000002","710000003"]);
  });
  it("UIN等于查询起点 → source_only 不自环，整批无关系时不可提交", () => {
    const rows = [row("710000001")];
    const plan = buildImportPlan(csv(H.device, rows), { currentSource: "710000001" });
    expect(plan.rows[0].decision).toBe("source_only");
    expect(plan.relations).toHaveLength(0);
    expect(plan.canSubmit).toBe(false);
  });
  it("多个原号码且未选中 → 整批拒绝要求选择", () => {
    const rows = [row("710000002","1","原号码"), row("710000003","1","原号码")];
    const plan = buildImportPlan(csv(H.device, rows));
    expect(plan.canSubmit).toBe(false);
    expect(plan.batchErrors.join()).toContain("多个原号码");
  });
  it("唯一外部重合QQ接管整批父节点", () => {
    const rows = [row("710000002"), row("710000009")];
    const plan = buildImportPlan(csv(H.device, rows), { currentSource: "710000001", existingEntityKeys: new Set([["qq","710000009"].join("\u0000")]) });
    expect(plan.queryOrigin?.key).toBe("710000009");
    expect(plan.parentSelectionReason).toBe("unique-existing-overlap");
    expect(plan.relations).toHaveLength(1);
  });
  it("多个外部重合未显式选择 → 拒绝并列出候选", () => {
    const rows = [row("710000008","1","原号码"), row("710000009"), row("710000010")];
    const plan = buildImportPlan(csv(H.device, rows), { currentSource: "123123", existingEntityKeys: new Set([["qq","710000008"].join("\u0000"),["qq","710000009"].join("\u0000")]) });
    expect(plan.canSubmit).toBe(false);
    expect(plan.overlapCandidates).toEqual(["710000008","710000009"]);
  });
  it("多个外部重合显式选择其一 → 通过", () => {
    const rows = [row("710000008","1","原号码"), row("710000009"), row("710000010")];
    const plan = buildImportPlan(csv(H.device, rows), { currentSource: "123123", existingEntityKeys: new Set([["qq","710000008"].join("\u0000"),["qq","710000009"].join("\u0000")]), explicitParentKey: "710000009" });
    expect(plan.canSubmit).toBe(true);
    expect(plan.parentSelectionReason).toBe("explicit-existing-overlap");
  });
  it("选中值非法QQ（手机号）→ 不作为起点，回退原号码", () => {
    const rows = [row("710000002","1","原号码"), row("710000003")];
    const plan = buildImportPlan(csv(H.device, rows), { currentSource: { kind: "phone", value: "13800138000" } });
    expect(plan.queryOrigin?.key).toBe("710000002");
    expect(plan.parentSelectionReason).toBe("file-origin");
  });
});

describe("维度7：手机号绑定/查询方向专测", () => {
  it("binding方向：手机号→QQ（方向合同v2，起点顺流向结果）", () => {
    const rows = [["880000001","16600000001","",S,"cipher","cipherP","本人","2026-01-01","",""]];
    const plan = buildImportPlan(csv(H.binding, rows));
    expect(plan.relations[0]).toMatchObject({ sourceKind:"phone", sourceKey:"16600000001", targetKind:"qq", targetKey:"880000001", label:"绑定手机号" });
    expect(plan.queryOrigin).toMatchObject({ kind:"phone", key:"16600000001" });
  });
  it("lookup方向：QQ→手机号（同向不翻转）", () => {
    const rows = [["16600000001","880000001","880000001","",S,"cipherQ","cipherP","本人","2026-01-01","",""]];
    const plan = buildImportPlan(csv(H.lookup, rows));
    expect(plan.relations[0]).toMatchObject({ sourceKind:"qq", sourceKey:"880000001", targetKind:"phone", targetKey:"16600000001" });
    expect(plan.queryOrigin).toMatchObject({ kind:"qq", key:"880000001" });
  });
  it("同一手机号绑多个QQ → 全部入库（不强制唯一）", () => {
    const rows = [
      ["880000001","16600000001","",S,"cipher","cipherP","本人","","",""],
      ["880000002","16600000001","",S,"cipher","cipherP","本人","","",""],
    ];
    const plan = buildImportPlan(csv(H.binding, rows));
    expect(plan.canSubmit).toBe(true);
    expect(plan.relations).toHaveLength(2);
    expect([...plan.sourceEntities, ...plan.targetEntities].filter(e=>e.kind==="qq")).toHaveLength(2);
  });
  it("binding 手机号列密文 → 起点回退主起点列（命中查询内容）", () => {
    const rows = [["880000001","16600000001","",S,"cipher","cipherEnc","本人","","",""]];
    const plan = buildImportPlan(csv(H.binding, rows));
    expect(plan.canSubmit).toBe(true);
    expect(plan.queryOrigin).toMatchObject({ kind:"phone", key:"16600000001" });
  });
});

describe("维度8：群成员与群列表交叉", () => {
  const memberRow = (qq="710000010") => ["710000100",qq,qq,"无异常","Success","cipherG","【1】正常","cipherQ","成员昵称","账号昵称","【0】普通成员","【false】否","id1"];
  it("群成员表：群→成员方向", () => {
    const plan = buildImportPlan(csv(H.member, [memberRow()]));
    expect(plan.relations[0]).toMatchObject({ sourceKind:"group", sourceKey:"710000100", targetKind:"qq", targetKey:"710000010", label:"群成员" });
  });
  it("群成员表：同一群多成员 → 群实体去重", () => {
    const plan = buildImportPlan(csv(H.member, [memberRow("710000010"), memberRow("710000011")]));
    const groups = [...plan.sourceEntities, ...plan.targetEntities].filter(e=>e.kind==="group");
    expect(groups).toHaveLength(1);
    expect(plan.relations).toHaveLength(2);
  });
  it("群列表与群成员表同一群号 → 键相同可复用", () => {
    const groupRow = ["cipher","710000100","备注",S,"710000001","710000001","710000100","【10】普通成员","备注","测试群","https://a.example/1.jpg","公告","12","2026-01-01","2026-01-01","简介","id1"];
    const p1 = buildImportPlan(csv(H.group, [groupRow]));
    const p2 = buildImportPlan(csv(H.member, [memberRow()]));
    expect(p1.relations[0].targetKey).toBe("710000100");
    expect(p2.relations[0].sourceKey).toBe("710000100");
    const allGroups = [...p1.targetEntities, ...p2.sourceEntities].filter(e=>e.kind==="group");
    expect(new Set(allGroups.map(g=>g.key)).size).toBe(1);
  });
  it("群成员表错误码 Success 明文（无【】）→ explicit-or-plain 兼容", () => {
    const row = memberRow(); row[4] = "【Success】成功";
    const plan = buildImportPlan(csv(H.member, [row]));
    expect(plan.canSubmit).toBe(true);
  });
  it("群成员表错误码空 → 兼容（explicit-or-plain 不含空？记录行为）", () => {
    const row = memberRow(); row[4] = "";
    const plan = buildImportPlan(csv(H.member, [row]));
    // success 合同: explicit-or-plain 只认 Success/【Success】成功，空值应拒绝
    expect(plan.canSubmit).toBe(false);
  });
});

describe("维度9：桥接合同专测", () => {
  const groupRow = (n=1) => ["cipher","710000100","备注",S,"710000001","710000001","710000100","【10】普通成员","备注"+n,"测试群"+n,"https://a.example/1.jpg","公告","12","2026-01-01","2026-01-01","简介","id"+n];
  it("bridge-available时桥接方向：当前对象→查询起点，标签为查询号码", () => {
    const plan = buildImportPlan(csv(H.group,[groupRow()]), { currentSource: { kind: "subject", value: "案件根" } });
    const bridge = currentClueBridge(plan, plan.currentSource);
    expect(bridge?.relation).toMatchObject({ sourceKind:"subject", sourceKey:"案件根", targetKind:"qq", targetKey:"710000001", label:"查询号码" });
    const merged = withCurrentClueBridge(plan, bridge);
    expect(merged.relations).toHaveLength(2);
    expect(merged.bridgeRelationCount).toBe(1);
  });
  it("reuse-existing时不生成桥接", () => {
    const plan = buildImportPlan(csv(H.group,[groupRow()]), { currentSource: { kind: "subject", value: "案件根" }, existingEntityKeys: new Set([["qq","710000001"].join("\u0000")]) });
    expect(currentClueBridge(plan, plan.currentSource)).toBeUndefined();
  });
  it("当前选中就是查询起点 → 无桥接", () => {
    const plan = buildImportPlan(csv(H.group,[groupRow()]), { currentSource: { kind: "qq", value: "710000001" } });
    expect(plan.accessStatus).toBe("query-origin");
    expect(currentClueBridge(plan, plan.currentSource)).toBeUndefined();
  });
  it("未选中且起点不存在 → unavailable 提示未连接", () => {
    const plan = buildImportPlan(csv(H.group,[groupRow()]));
    expect(plan.accessStatus).toBe("unavailable");
    expect(currentClueBridge(plan, undefined)).toBeUndefined();
  });
  it("桥接实体已在本批结果中 → 不重复追加实体，仅追加关系（2026-09-23 复用合同）", () => {
    // 场景：绑定表查出的QQ恰好包含当前选中QQ（真实案例（合成号复现）：7112345678 既是选中对象又是表内结果QQ）
    const bindingHeaders = ["QQ账号(解密)","命中查询内容","错误备注","错误码类型","QQ账号","手机号","手机号类型","设置时间","修改时间","验证时间"];
    const row = (qq: string) => [qq,"16600000001","",S,"cipher","cipher","【1】密保手机","2017/07/26 23:46:41","2026/07/18 13:21:26","2026/08/03 13:27:35"];
    const cur = { kind: "qq" as const, value: "7112345678" };
    const plan = buildImportPlan(csv(bindingHeaders, [row("7112345678"), row("710300001")]), { currentSource: cur });
    expect(plan.accessStatus).toBe("bridge-available");
    const bridge = currentClueBridge(plan, plan.currentSource);
    expect(bridge).toBeDefined();
    const merged = withCurrentClueBridge(plan, bridge);
    // 实体不重复：合并后实体集合与原计划一致（7112345678 已在 targetEntities 中）
    const keys = merged.sourceEntities.concat(merged.targetEntities).map(e => `${e.kind}\u0000${e.key}`);
    expect(new Set(keys).size).toBe(keys.length);
    // 关系仍然 +1（桥接关系）
    expect(merged.relations).toHaveLength(plan.relations.length + 1);
    expect(merged.bridgeRelationCount).toBe(1);
  });
});
