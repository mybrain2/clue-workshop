import { describe, expect, it } from "vitest";
import { phoneContract } from "./smart-table";
import fixtures from "./phone-fixtures.json";

// 前后端共享黄金夹具（Rust case_core.rs phone_contract_tests 读同一份 JSON）：
// 任何分叉 = bug。新格式族出现 → 只加夹具，两端同时生效。
describe("手机号规范化 v2 黄金夹具（与 Rust 同构）", () => {
  it("夹具规模守卫", () => {
    expect(fixtures.cases.length).toBeGreaterThanOrEqual(70);
  });

  for (const { input, expected, valid, tag } of fixtures.cases) {
    it(`normalize ${JSON.stringify(input)} → ${JSON.stringify(expected)}${tag ? `（${tag}）` : ""}`, () => {
      const actual = phoneContract.normalizePhone(input);
      expect(actual).toBe(expected);
      expect(phoneContract.isPhoneCanonical(actual)).toBe(valid);
    });
  }

  it("规范化幂等：normalize(normalize(x)) === normalize(x)", () => {
    for (const { input } of fixtures.cases) {
      const once = phoneContract.normalizePhone(input);
      expect(phoneContract.normalizePhone(once)).toBe(once);
    }
  });
});

describe("国际手机号批量导入场景", () => {
  const lookupHeader = ["手机号(解密)", "QQ账号(解密)", "命中查询内容", "错误备注", "错误码类型", "QQ账号", "手机号", "手机号类型", "设置时间", "修改时间", "验证时间"];

  it("严格 lookup 模板接受 +852 国际号码并保持 + 规范形", async () => {
    const { buildImportPlan } = await import("./smart-table");
    const text = [
      lookupHeader.join(","),
      ["+852 0000 0001", "7112345678", "7112345678", "", "【Success】成功", "c1", "c2", "【1】密保手机", "", "", ""].join(","),
    ].join("\n");
    const plan = buildImportPlan(text, {});
    expect(plan.template).toBe("qq-phone-lookup");
    expect(plan.canSubmit).toBe(true);
    expect(plan.relations[0]).toMatchObject({ sourceKind: "qq", sourceKey: "7112345678", targetKind: "phone", targetKey: "+85200000001" });
  });

  it("手工映射 852 裸号国际列：校验+规范化全通", async () => {
    const { buildManualMappedPlan } = await import("./smart-table");
    const text = "QQ,手机\n7112345678,852-0000 0001\n7112345678,+1 (415) 555-0100";
    const plan = buildManualMappedPlan(text, { hasHeader: true, sourceIndex: 0, sourceKind: "qq", targetIndex: 1, targetKind: "phone", relationLabel: "持有" }, {});
    expect(plan.canSubmit).toBe(true);
    expect(plan.relations.map((r) => r.targetKey)).toEqual(["+85200000001", "+14155550100"]);
  });

  it("手工映射自动建议识别国际手机号列为 phone", async () => {
    const { suggestManualMapping } = await import("./smart-table");
    const text = "手机号码,备注\n852-0000 0001,x\n+1 (415) 555-0100,y";
    const sug = suggestManualMapping(text);
    expect(sug.targetKind).toBe("phone");
  });

  it("建案弹窗识别 +852 为 phone 类型", async () => {
    const { phoneContract: contract } = await import("./smart-table");
    expect(contract.isPhoneLoose("+852 0000 0001")).toBe(true);
    expect(contract.isPhoneLoose("13800138000")).toBe(true);
    expect(contract.isPhoneLoose("9999999999")).toBe(false);
  });

  it("大陆裸号回归保护：既有八格式矩阵全部保持裸 11 位", async () => {
    const { buildImportPlan } = await import("./smart-table");
    const FORMATS = ["86-16600000001", "+86-16600000001", "+8616600000001", "8616600000001", "166 0000 0001", "166-0000-0001", "(86)16600000001", "16600000001"];
    for (const value of FORMATS) {
      const text = [
        lookupHeader.join(","),
        [value, "7112345678", "7112345678", "", "【Success】成功", "c1", "c2", "【1】密保手机", "", "", ""].join(","),
      ].join("\n");
      const plan = buildImportPlan(text, {});
      expect(plan.canSubmit, `格式 ${value} 应通过`).toBe(true);
      expect(plan.relations[0].targetKey, `格式 ${value}`).toBe("16600000001");
    }
  });
});
