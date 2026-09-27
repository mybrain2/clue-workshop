import { describe, expect, it } from "vitest";
import { quickEntryDefaults, syncQuickEntryKind } from "./QuickEntryPanel";

describe("QuickEntry 类型变化", () => {
  it("同机与个人团伙入口使用专属预设", () => {
    expect(quickEntryDefaults.device).toMatchObject({ kind: "qq", title: "添加同机QQ", relationLabel: "同机", spread: "同机扩散" });
    expect(quickEntryDefaults.organization).toMatchObject({ kind: "organization", title: "添加个人/团伙", relationLabel: "归属", spread: "人工关联" });
  });

  it("仍为旧默认文案时同步标题和副标题", () => {
    expect(syncQuickEntryKind({ kind: "qq", title: "添加QQ号", subtitle: "QQ号 · 账号链扩展" }, "phone")).toEqual({
      kind: "phone", title: "添加手机号", subtitle: "手机号 · 跨平台映射",
    });
  });

  it("保留自定义标题和副标题", () => {
    expect(syncQuickEntryKind({ kind: "qq", title: "我的入口", subtitle: "自定义说明" }, "phone")).toEqual({
      kind: "phone", title: "我的入口", subtitle: "自定义说明",
    });
  });
});
