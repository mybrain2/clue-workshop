import { describe, expect, it } from "vitest";
import type { AttributeRecord, EntityKind, EntityRecord } from "./types";
import { entityDisplay } from "./entity-presentation";

const entity = (kind: EntityKind, label: string, displayName = ""): EntityRecord => ({ id: "entity", caseId: "case", kind, label, displayName, status: "", role: "", note: "", accent: "", pinned: false });
const attribute = (fieldKey: string, valueText: string): AttributeRecord => ({ id: fieldKey, caseId: "case", subjectId: "entity", fieldKey, valueType: "text", valueText, sortOrder: 0, createdAt: "", updatedAt: "" });

describe("实体节点展示预算", () => {
  it.each([
    ["qq", "123456", "办案昵称", "nickname", "资料昵称"],
    ["wechat", "wx_case", "", "nickname", "微信昵称"],
    ["platform", "douyin_01", "", "nickname", "平台昵称"],
    ["group", "987654", "", "group_name", "研判群"],
  ] as const)("%s 有显示名时底部仍显示原始账号或群号", (kind, label, displayName, key, name) => {
    const presentation = entityDisplay(entity(kind, label, displayName), [attribute(key, name), attribute("account_status", "正常")]);
    expect(presentation.title).toBe(displayName || name);
    expect(presentation.secondary.split(" · ")[0]).toBe(label);
  });
});
