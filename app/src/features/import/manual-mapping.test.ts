import { describe, expect, it } from "vitest";
import { buildManualMappedPlan, currentClueBridge, suggestManualMapping, withCurrentClueBridge } from "./smart-table";

const rows = [
  ["source", "target", "name"],
  ["710000001", "880000001", "对象一"],
  ["710000001", "880000002", "对象二"],
];

describe("轻量手工映射", () => {
  it("根据单值来源列和多值目标列给出建议", () => {
    expect(suggestManualMapping(rows, true)).toMatchObject({
      hasHeader: true,
      sourceIndex: 0,
      sourceKind: "qq",
      targetIndex: 1,
      targetKind: "qq",
    });
  });

  it("用户确认映射后生成可复核计划", () => {
    const plan = buildManualMappedPlan(rows, {
      hasHeader: true,
      sourceIndex: 0,
      sourceKind: "qq",
      targetIndex: 1,
      targetKind: "qq",
      displayNameIndex: 2,
      relationLabel: "关联账号",
    });
    expect(plan).toMatchObject({
      template: "custom",
      templateVersion: "manual-mapped-v1",
      templateMode: "manual-mapped",
      canSubmit: true,
      stats: { total: 2, valid: 2, error: 0, relations: 2 },
    });
    expect(plan.relations[0]).toMatchObject({ sourceKey: "710000001", targetKey: "880000001", label: "关联账号" });
    expect(plan.targetEntities[0]).toMatchObject({ displayName: "对象一" });
  });

  it("无表头映射使用稳定合成列名", () => {
    const plan = buildManualMappedPlan(rows.slice(1), {
      hasHeader: false,
      sourceIndex: 0,
      sourceKind: "qq",
      targetIndex: 1,
      targetKind: "qq",
      relationLabel: "关联账号",
    });
    expect(plan.canSubmit).toBe(true);
    expect(plan.rawTable[0]).toEqual(["第1列", "第2列", "第3列"]);
    expect(plan.endpointContract).toMatchObject({ sourceColumn: "第1列", targetColumn: "第2列" });
  });

  it("表头含“群”关键字时，纯数字群号列建议为group而非qq", () => {
    const groupRows = [
      ["查询QQ", "所在群号", "群名称"],
      ["710000001", "1121500883", "光头强78"],
      ["710000001", "1098545583", "光头强云寄售商户群"],
    ];
    expect(suggestManualMapping(groupRows, true)).toMatchObject({
      hasHeader: true,
      sourceIndex: 0,
      sourceKind: "qq",
      targetIndex: 1,
      targetKind: "group",
    });
  });

  it("来源不唯一、类型不符和自环均阻止提交", () => {
    const mapping = { hasHeader: true, sourceIndex: 0, sourceKind: "qq" as const, targetIndex: 1, targetKind: "qq" as const, relationLabel: "关联" };
    expect(buildManualMappedPlan([["s","t"],["710000001","880000001"],["710000002","880000002"]], mapping).canSubmit).toBe(false);
    expect(buildManualMappedPlan([["s","t"],["not-qq","880000001"]], mapping).canSubmit).toBe(false);
    expect(buildManualMappedPlan([["s","t"],["710000001","710000001"]], mapping).canSubmit).toBe(false);
  });
});


describe("通用表头与失败关闭", () => {
  it("自动识别普通文本表头并给出来源目标建议", () => {
    const input = [
      ["来源QQ", "目标QQ", "昵称"],
      ["710000001", "880000001", "对象一"],
      ["710000001", "880000002", "对象二"],
    ];
    expect(suggestManualMapping(input)).toMatchObject({ hasHeader: true, sourceIndex: 0, targetIndex: 1 });
  });

  it("显式无表头不会误删首条数据", () => {
    const input = [["710000001", "880000001"], ["710000001", "880000002"]];
    const plan = buildManualMappedPlan(input, { hasHeader: false, sourceIndex: 0, sourceKind: "qq", targetIndex: 1, targetKind: "qq", relationLabel: "关联" });
    expect(plan.stats.total).toBe(2);
    expect(plan.relations).toHaveLength(2);
  });

  it("映射错误属于明确校验失败而非模板全行误判", () => {
    const input = [["来源", "目标"], ["710000001", "bad"]];
    const plan = buildManualMappedPlan(input, { hasHeader: true, sourceIndex: 0, sourceKind: "qq", targetIndex: 1, targetKind: "qq", relationLabel: "关联" });
    expect(plan.canSubmit).toBe(false);
    expect(plan.stats.error).toBe(1);
    expect(plan.rows[0].error).toContain("目标格式不符");
  });
});

describe("手工映射接入合同", () => {
  const mapping = { hasHeader: true, sourceIndex: 0, sourceKind: "qq" as const, targetIndex: 1, targetKind: "qq" as const, relationLabel: "好友" };
  const input = [["查询账号", "好友"], ["467673818", "207795"], ["467673818", "21875"]];

  it("来源不存在且选中其他对象 → bridge-available，桥接为 选中→查询号码→起点", () => {
    const plan = buildManualMappedPlan(input, mapping, {
      currentSource: { kind: "group", value: "1004644827", displayName: "无畏小学生" },
      existingEntityKeys: new Set(["group\u00001004644827"]),
    });
    expect(plan.accessStatus).toBe("bridge-available");
    expect(plan.queryOrigin).toMatchObject({ kind: "qq", key: "467673818" });
    const bridge = currentClueBridge(plan, plan.currentSource);
    expect(bridge).toBeDefined();
    expect(bridge!.relation).toMatchObject({ sourceKind: "group", sourceKey: "1004644827", label: "查询号码", targetKind: "qq", targetKey: "467673818" });
    const merged = withCurrentClueBridge(plan, bridge);
    expect(merged.relations).toHaveLength(3);
    expect(merged.bridgeRelationCount).toBe(1);
  });

  it("来源已存在于案件 → reuse-existing，不生成桥接", () => {
    const plan = buildManualMappedPlan(input, mapping, {
      currentSource: { kind: "group", value: "1004644827", displayName: "无畏小学生" },
      existingEntityKeys: new Set(["group\u00001004644827", "qq\u0000467673818"]),
    });
    expect(plan.accessStatus).toBe("reuse-existing");
    expect(currentClueBridge(plan, plan.currentSource)).toBeUndefined();
  });

  it("当前选中就是查询起点 → query-origin，不生成桥接", () => {
    const plan = buildManualMappedPlan(input, mapping, {
      currentSource: { kind: "qq", value: "467673818" },
      existingEntityKeys: new Set(["qq\u0000467673818"]),
    });
    expect(plan.accessStatus).toBe("query-origin");
    expect(currentClueBridge(plan, plan.currentSource)).toBeUndefined();
  });

  it("未选中任何对象且起点不存在 → unavailable，提示将进入未连接区域", () => {
    const plan = buildManualMappedPlan(input, mapping, { existingEntityKeys: new Set() });
    expect(plan.accessStatus).toBe("unavailable");
    expect(plan.canSubmit).toBe(true);
    expect(currentClueBridge(plan, undefined)).toBeUndefined();
    // 产品合同（2026-09-23）：UI 在 review 步骤对 unavailable 且无桥接的计划阻止提交；
    // 计划层保持可构建，阻断逻辑在 ImportDialog（见 ImportDialog.unreachable-block.test.tsx）
  });

  it("不传选项时保持既有行为（无选中即 unavailable，计划本身不受影响）", () => {
    const plan = buildManualMappedPlan(input, mapping);
    expect(plan.canSubmit).toBe(true);
    expect(plan.accessStatus).toBe("unavailable");
    expect(plan.bridgeRelationCount).toBe(0);
    expect(plan.relations).toHaveLength(2);
  });
});
