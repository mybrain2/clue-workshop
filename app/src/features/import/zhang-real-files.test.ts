// 识别层全面测试：张士豪五真实文件 × 多形态（原始/去BOM/无表头/选中起点/未选中）
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildImportPlan, recognizeTemplate } from "./smart-table";

const DIR = "/Users/chrishong/Desktop/涉诈和大鱼线索/clueprobe大鱼线索/张士豪";
const FILES = {
  friend: `${DIR}/PCG_好友列表.csv`,
  group: `${DIR}/PCG_加群列表.csv`,
  member: `${DIR}/PCG_群成员-2.csv`,
  binding: `${DIR}/PCG_手机号查绑定QQ.csv`,
  lookup: `${DIR}/PCG_QQ查手机号-2.csv`,
};
const read = (p: string) => readFileSync(p, "utf-8");
const stripBom = (s: string) => s.replace(/^\uFEFF/, "");

describe("张士豪五文件识别层（2026-09-23）", () => {
  it("好友列表：原始BOM文本 → friend-list，密文起点回退解密列，起点 2128667131", () => {
    const text = read(FILES.friend);
    const rec = recognizeTemplate(text, { hasHeader: true });
    expect(rec.template).toBe("friend-list");
    const plan = buildImportPlan(text, {});
    expect(plan.batchErrors).toHaveLength(0);
    expect(plan.queryOrigin).toMatchObject({ kind: "qq", key: "2128667131" });
    expect(plan.stats.relations).toBe(500); // 501行-1表头
    // 方向：查询账号→好友→好友QQ
    expect(plan.relations[0]).toMatchObject({ sourceKind: "qq", sourceKey: "2128667131", targetKind: "qq", label: "好友" });
  });

  it("好友列表：无表头11列 → strict-positional 同样识别", () => {
    const lines = stripBom(read(FILES.friend)).split(/\r?\n/).filter(Boolean);
    const noHeader = lines.slice(1).join("\n");
    const rec = recognizeTemplate(noHeader, { hasHeader: false });
    expect(rec.template).toBe("friend-list");
    const plan = buildImportPlan(noHeader, { hasHeader: false });
    expect(plan.batchErrors).toHaveLength(0);
    expect(plan.queryOrigin?.key).toBe("2128667131");
  });

  it("加群列表：密文QQ号列（group-list密文变体） → group-list 通过", () => {
    const text = read(FILES.group);
    const rec = recognizeTemplate(text, { hasHeader: true });
    expect(rec.template).toBe("group-list");
    const plan = buildImportPlan(text, {});
    expect(plan.batchErrors).toHaveLength(0);
    expect(plan.queryOrigin).toMatchObject({ kind: "qq", key: "2128667131" });
    expect(plan.stats.relations).toBe(36);
    expect(plan.stats.duplicate).toBe(0);
    expect(plan.relations[0]).toMatchObject({ sourceKind: "qq", targetKind: "group", label: "加入群" });
  });

  it("群成员：Success明文错误码 → group-member 通过，群548360752→成员", () => {
    const text = read(FILES.member);
    const rec = recognizeTemplate(text, { hasHeader: true });
    expect(rec.template).toBe("group-member");
    const plan = buildImportPlan(text, {});
    expect(plan.batchErrors).toHaveLength(0);
    expect(plan.queryOrigin).toMatchObject({ kind: "group", key: "548360752" });
    expect(plan.stats.relations).toBe(100);
    expect(plan.relations[0]).toMatchObject({ sourceKind: "group", sourceKey: "548360752", targetKind: "qq", label: "群成员" });
  });

  it("绑定表（方向合同v2）：手机号→绑定→QQ，起点 16650030502", () => {
    const text = read(FILES.binding);
    const rec = recognizeTemplate(text, { hasHeader: true });
    expect(rec.template).toBe("qq-phone-binding");
    const plan = buildImportPlan(text, {});
    expect(plan.batchErrors).toHaveLength(0);
    expect(plan.queryOrigin).toMatchObject({ kind: "phone", key: "16650030502" });
    expect(plan.stats.relations).toBe(5);
    for (const r of plan.relations) {
      expect(r).toMatchObject({ sourceKind: "phone", sourceKey: "16650030502", targetKind: "qq", label: "绑定手机号" });
    }
  });

  it("QQ查手机号：86-前缀起点规范化为裸号，qq→phone 方向", () => {
    const text = read(FILES.lookup);
    const rec = recognizeTemplate(text, { hasHeader: true });
    expect(rec.template).toBe("qq-phone-lookup");
    const plan = buildImportPlan(text, {});
    expect(plan.batchErrors).toHaveLength(0);
    expect(plan.queryOrigin).toMatchObject({ kind: "qq", key: "2128667131" });
    expect(plan.relations[0]).toMatchObject({ sourceKind: "qq", sourceKey: "2128667131", targetKind: "phone", targetKey: "16650030502" });
  });

  it("未选中对象时：五文件全部 unavailable 且计划可构建（UI阻断在提交层）", () => {
    for (const path of Object.values(FILES)) {
      const plan = buildImportPlan(read(path), {});
      expect(plan.accessStatus).toBe("unavailable");
      expect(plan.canSubmit).toBe(true);
    }
  });

  it("选中案件已有2128667131时：好友/加群/查手机号 reuse-existing，绑定/群成员 bridge-available", () => {
    const existing = new Set(["qq\u00002128667131"]);
    const cur = { kind: "qq" as const, value: "2128667131" };
    expect(buildImportPlan(read(FILES.friend), { currentSource: cur, existingEntityKeys: existing }).accessStatus).toBe("query-origin");
    expect(buildImportPlan(read(FILES.group), { currentSource: cur, existingEntityKeys: existing }).accessStatus).toBe("query-origin");
    expect(buildImportPlan(read(FILES.lookup), { currentSource: cur, existingEntityKeys: existing }).accessStatus).toBe("query-origin");
    expect(buildImportPlan(read(FILES.binding), { currentSource: cur, existingEntityKeys: existing }).accessStatus).toBe("bridge-available");
    expect(buildImportPlan(read(FILES.member), { currentSource: cur, existingEntityKeys: existing }).accessStatus).toBe("bridge-available");
  });
});
