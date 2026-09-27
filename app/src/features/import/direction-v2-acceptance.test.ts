import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { buildImportPlan } from "./smart-table";

// 方向合同 v2 六模板真实验收：全部模板统一"查询起点 → 结果"顺流方向
const DIR = "/Users/chrishong/Desktop/涉诈和大鱼线索/clueprobe大鱼线索";

function read(path: string): string { return readFileSync(path, "utf-8"); }

describe("方向合同v2：六真实文件识别+方向+接入圈", () => {
  it("群列表 ai群.csv：查询QQ→加入群→群（顺流）", () => {
    const plan = buildImportPlan(read(`${DIR}/情久大哥/ai群.csv`), {});
    expect(plan.template).toBe("group-list");
    expect(plan.canSubmit).toBe(true);
    expect(plan.queryOrigin).toMatchObject({ kind: "qq" });
    for (const r of plan.relations) expect(r).toMatchObject({ sourceKind: "qq", targetKind: "group", label: "加入群" });
    expect(plan.endpointContract?.direction).toBe("qq→group");
  });

  it("好友列表 ai友.csv：查询账号→好友→好友QQ（顺流）", () => {
    const plan = buildImportPlan(read(`${DIR}/情久大哥/ai友.csv`), {});
    expect(plan.template).toBe("friend-list");
    expect(plan.canSubmit).toBe(true);
    expect(plan.queryOrigin).toMatchObject({ kind: "qq" });
    for (const r of plan.relations) expect(r).toMatchObject({ sourceKind: "qq", targetKind: "qq", label: "好友" });
    expect(plan.endpointContract?.direction).toBe("qq→qq");
  });

  it("手机号查绑定QQ：手机号→绑定→QQ（本次翻转的核心）", () => {
    const plan = buildImportPlan(read(`${DIR}/张士豪/PCG_手机号查绑定QQ.csv`), {});
    expect(plan.template).toBe("qq-phone-binding");
    expect(plan.canSubmit).toBe(true);
    expect(plan.queryOrigin).toMatchObject({ kind: "phone", key: "16650030502" });
    expect(plan.relations).toHaveLength(5);
    for (const r of plan.relations) expect(r).toMatchObject({ sourceKind: "phone", sourceKey: "16650030502", targetKind: "qq", label: "绑定手机号" });
    expect(plan.endpointContract?.direction).toBe("phone→qq");
  });

  it("QQ查手机号：QQ→手机号→手机（互补模板方向不变）", () => {
    const plan = buildImportPlan(read(`${DIR}/张士豪/PCG_QQ查手机号-2.csv`), {});
    expect(plan.template).toBe("qq-phone-lookup");
    expect(plan.canSubmit).toBe(true);
    expect(plan.queryOrigin).toMatchObject({ kind: "qq" });
    for (const r of plan.relations) expect(r).toMatchObject({ sourceKind: "qq", targetKind: "phone", label: "绑定手机号" });
    expect(plan.endpointContract?.direction).toBe("qq→phone");
  });

  it("群成员 PCG_群成员-2.csv：群→成员→QQ（顺流）", () => {
    const plan = buildImportPlan(read(`${DIR}/张士豪/PCG_群成员-2.csv`), {});
    expect(plan.template).toBe("group-member");
    expect(plan.canSubmit).toBe(true);
    expect(plan.queryOrigin).toMatchObject({ kind: "group" });
    for (const r of plan.relations) expect(r).toMatchObject({ sourceKind: "group", targetKind: "qq", label: "群成员" });
    expect(plan.endpointContract?.direction).toBe("group→qq");
  });

  it("加群列表 PCG_加群列表.csv：查询QQ→加入群→群（顺流）", () => {
    const plan = buildImportPlan(read(`${DIR}/张士豪/PCG_加群列表.csv`), {});
    expect(plan.template).toBe("group-list");
    expect(plan.canSubmit).toBe(true);
    expect(plan.queryOrigin).toMatchObject({ kind: "qq" });
    for (const r of plan.relations) expect(r).toMatchObject({ sourceKind: "qq", targetKind: "group", label: "加入群" });
  });

  it("逻辑圈：全部六文件计划零密文端点、零错误行、起点唯一", () => {
    const files = [
      `${DIR}/情久大哥/ai群.csv`, `${DIR}/情久大哥/ai友.csv`,
      `${DIR}/张士豪/PCG_手机号查绑定QQ.csv`, `${DIR}/张士豪/PCG_QQ查手机号-2.csv`,
      `${DIR}/张士豪/PCG_群成员-2.csv`, `${DIR}/张士豪/PCG_加群列表.csv`,
    ];
    for (const f of files) {
      const plan = buildImportPlan(read(f), {});
      expect(plan.canSubmit, f).toBe(true);
      expect(plan.stats.error, f).toBe(0);
      expect(plan.batchErrors, f).toEqual([]);
      // 密文列不得成为端点（实体的key与关系的两端；属性值允许携带密文原文如identifier）
      for (const e of [...plan.sourceEntities, ...plan.targetEntities]) expect(e.key.startsWith("AVFRA"), f).toBe(false);
      for (const r of plan.relations) expect(r.sourceKey.startsWith("AVFRA") || r.targetKey.startsWith("AVFRA"), f).toBe(false);
      expect(new Set(plan.relations.map(r => `${r.sourceKind}:${r.sourceKey}`)).size, f).toBe(1); // 起点唯一
    }
  });
});
