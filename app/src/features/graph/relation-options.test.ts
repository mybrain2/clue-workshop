import { describe, expect, it } from "vitest";
import { defaultsAfterKindChange, hasRelationKindConflict, relationLabelForKind, SPREAD_OPTIONS, withCurrentOption } from "./relation-options";

describe("旧关系数据兼容", () => {
  it("为空值提供未设置选项", () => {
    expect(withCurrentOption(["有效"], "")[0]).toEqual({ value: "", label: "未设置" });
  });

  it("保留历史自定义值", () => {
    expect(withCurrentOption(["有效"], "历史状态")[0]).toEqual({ value: "历史状态", label: "当前值：历史状态" });
  });

  it("扩散方式包含智能导入且拼写统一", () => {
    expect(SPREAD_OPTIONS).toContain("智能导入");
    expect(SPREAD_OPTIONS).toContain("同 IP 扩散");
    expect(SPREAD_OPTIONS).not.toContain("同IP扩散");
  });
});

describe("QuickAdd 类型变化", () => {
  it("关系名未手改时同步关系和扩散默认值", () => {
    expect(defaultsAfterKindChange("phone", "关联QQ号", false)).toEqual({ label: "关联手机号", spread: "跨平台映射" });
  });

  it("关系名手改后仅同步扩散方式", () => {
    expect(defaultsAfterKindChange("ip", "自定义关系", true)).toEqual({ label: "自定义关系", spread: "同 IP 扩散" });
  });

  it("识别明显关系类型冲突但不阻止保存", () => {
    expect(hasRelationKindConflict("绑定手机号", "ip")).toBe(true);
    expect(hasRelationKindConflict("绑定手机号", "phone")).toBe(false);
    expect(hasRelationKindConflict("同机", "qq")).toBe(false);
    expect(hasRelationKindConflict("同机", "device")).toBe(true);
  });

  it("个人团伙默认作为归属标注节点", () => {
    expect(relationLabelForKind("organization")).toBe("归属");
    expect(defaultsAfterKindChange("organization", "关联QQ号", false)).toEqual({ label: "归属", spread: "人工关联" });
  });
});
