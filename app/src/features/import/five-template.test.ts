import { describe, it, expect } from "vitest";
import { buildImportPlan, buildManualMappedPlan, recognizeTemplate, parseDelimited } from "./smart-table";

// 真实密文样本格式（截断版结构等价）
const CIPHER = "AVFRAkVDQgN1aW4tLS0tLS0tLS0tLS0tLS0tLS0tLS0kTESTCIPHER==";

function csv(rows: string[][]): string { return rows.map(r => r.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n"); }

describe("修复①：好友列表密文查询起点回退解密列", () => {
  const friendHeader = ["查询账号(解密)", "QQ账号(解密)", "错误备注", "错误码类型", "查询账号", "分组", "昵称", "头像", "好友备注", "QQ账号", "标识id"];
  const mk = (rows: string[][]) => csv([friendHeader, ...rows]);

  it("查询账号列全密文 → 回退到查询账号(解密)明文起点", () => {
    const text = mk([
      ["2128667131", "687958", "", "", CIPHER, "我的好友", "小明", "https://q.qlogo.cn/1", "备注A", CIPHER, CIPHER],
      ["2128667131", "1890702", "", "", CIPHER, "我的好友", "神话。", "https://q.qlogo.cn/2", "", CIPHER, CIPHER],
    ]);
    const plan = buildImportPlan(text, {});
    expect(plan.template).toBe("friend-list");
    expect(plan.canSubmit).toBe(true);
    expect(plan.queryOrigin).toEqual({ kind: "qq", key: "2128667131" });
    expect(plan.relations).toHaveLength(2);
    expect(plan.relations[0]).toMatchObject({ sourceKind: "qq", sourceKey: "2128667131", label: "好友", targetKind: "qq", targetKey: "687958" });
  });

  it("查询账号列明文 → 不回退，直接使用（回归保护）", () => {
    const text = mk([
      ["2128667131", "687958", "", "", "2128667131", "我的好友", "小明", "https://q.qlogo.cn/1", "", CIPHER, CIPHER],
      ["2128667131", "1890702", "", "", "2128667131", "我的好友", "神话。", "https://q.qlogo.cn/2", "", CIPHER, CIPHER],
    ]);
    const plan = buildImportPlan(text, {});
    expect(plan.canSubmit).toBe(true);
    expect(plan.queryOrigin!.key).toBe("2128667131");
  });

  it("解密列也不唯一 → 明确报错不猜测", () => {
    const text = mk([
      ["2128667131", "687958", "", "", CIPHER, "我的好友", "小明", "", "", CIPHER, CIPHER],
      ["999888777", "1890702", "", "", CIPHER, "我的好友", "神话。", "", "", CIPHER, CIPHER],
    ]);
    const plan = buildImportPlan(text, {});
    expect(plan.canSubmit).toBe(false);
    expect(plan.batchErrors.join()).toContain("查询起点必须唯一");
  });
});

describe("修复②：手机号 86- 前缀规范化", () => {
  const lookupHeader = ["手机号(解密)", "QQ账号(解密)", "命中查询内容", "错误备注", "错误码类型", "QQ账号", "手机号", "手机号类型", "设置时间", "修改时间", "验证时间"];
  const mk = (rows: string[][]) => csv([lookupHeader, ...rows]);

  it("86-16650030502 规范化为 16650030502 入库", () => {
    const text = mk([
      ["86-16650030502", "2128667131", "2128667131", "", "【Success】成功", CIPHER, CIPHER, "【1】密保手机", "2016/01/26 10:09:48", "2026/05/06 17:35:59", "2026/09/15 23:18:53"],
    ]);
    const plan = buildImportPlan(text, {});
    expect(plan.template).toBe("qq-phone-lookup");
    expect(plan.canSubmit).toBe(true);
    expect(plan.relations[0]).toMatchObject({ sourceKind: "qq", sourceKey: "2128667131", label: "绑定手机号", targetKind: "phone", targetKey: "16650030502" });
  });

  it("裸11位手机号回归保护（不误伤）", () => {
    const text = mk([
      ["16650030502", "2128667131", "2128667131", "", "【Success】成功", CIPHER, CIPHER, "【1】密保手机", "2016/01/26 10:09:48", "", ""],
    ]);
    const plan = buildImportPlan(text, {});
    expect(plan.canSubmit).toBe(true);
    expect(plan.relations[0].targetKey).toBe("16650030502");
  });
});

describe("新模板③：群成员表 group-member", () => {
  const header = ["QQ群账号(解密)", "QQ账号(解密)", "命中查询内容", "异常说明", "错误码类型", "QQ群账号(加密)", "群状态", "QQ账号(加密)", "群成员昵称", "QQ账号昵称", "成员角色", "是否机器人", "标识id"];
  const mk = (rows: string[][]) => csv([header, ...rows]);

  it("识别群成员表并携带属性", () => {
    const text = mk([
      ["548360752", "703049615", "548360752", "", "Success", CIPHER, "【0】正常", CIPHER, "", "🫥", "【0】普通成员", "【false】否", CIPHER],
      ["548360752", "123456789", "548360752", "", "Success", CIPHER, "【0】正常", CIPHER, "老王", "北极星", "【30】管理员", "【true】是", CIPHER],
    ]);
    const plan = buildImportPlan(text, {});
    expect(plan.template).toBe("group-member");
    expect(plan.canSubmit).toBe(true);
    expect(plan.queryOrigin).toEqual({ kind: "group", key: "548360752" });
    expect(plan.relations).toHaveLength(2);
    expect(plan.relations[0]).toMatchObject({ sourceKind: "group", sourceKey: "548360752", label: "群成员", targetKind: "qq", targetKey: "703049615" });
    // 属性：昵称 + 角色
    const nicknames = plan.entityAttributes.filter(a => a.fieldKey === "nickname").map(a => a.valueText);
    expect(nicknames).toContain("🫥");
    const roles = plan.relationAttributes.filter(a => a.fieldKey === "member_role").map(a => a.valueText);
    expect(roles).toContain("【30】管理员");
  });

  it("错误码非Success拒绝", () => {
    const text = mk([
      ["548360752", "703049615", "548360752", "", "Fail", CIPHER, "【0】正常", CIPHER, "", "🫥", "【0】普通成员", "【false】否", CIPHER],
    ]);
    const plan = buildImportPlan(text, {});
    expect(plan.canSubmit).toBe(false);
  });
});

describe("新模板④：QQ查手机号表 qq-phone-lookup 与绑定表区分", () => {
  const lookupHeader = ["手机号(解密)", "QQ账号(解密)", "命中查询内容", "错误备注", "错误码类型", "QQ账号", "手机号", "手机号类型", "设置时间", "修改时间", "验证时间"];
  const bindingHeader = ["QQ账号(解密)", "命中查询内容", "错误备注", "错误码类型", "QQ账号", "手机号", "手机号类型", "设置时间", "修改时间", "验证时间"];

  it("两模板表头不同 → 各自识别不混淆", () => {
    const lookup = csv([lookupHeader, ["16650030502", "2128667131", "2128667131", "", "【Success】成功", CIPHER, CIPHER, "【1】密保手机", "", "", ""]]);
    const binding = csv([bindingHeader, ["166864075", "16650030502", "", "【Success】成功", CIPHER, CIPHER, "【1】密保手机", "", "", ""]]);
    expect(recognizeTemplate(lookup).template).toBe("qq-phone-lookup");
    expect(recognizeTemplate(binding).template).toBe("qq-phone-binding");
    // 方向合同 v2：全部模板统一"查询起点 → 结果"。lookup 起点 QQ → 手机号；binding 起点手机号 → QQ
    const lp = buildImportPlan(lookup, {}), bp = buildImportPlan(binding, {});
    expect(lp.relations[0]).toMatchObject({ sourceKind: "qq", sourceKey: "2128667131", targetKind: "phone", targetKey: "16650030502" });
    expect(bp.relations[0]).toMatchObject({ sourceKind: "phone", sourceKey: "16650030502", targetKind: "qq", targetKey: "166864075" });
    // 起点不同：lookup起点是QQ，binding起点是手机号
    expect(lp.queryOrigin).toEqual({ kind: "qq", key: "2128667131" });
    expect(bp.queryOrigin).toEqual({ kind: "phone", key: "16650030502" });
  });
});

describe("诊断与手工映射优化", () => {
  const friendHeader = ["查询账号(解密)", "QQ账号(解密)", "错误备注", "错误码类型", "查询账号", "分组", "昵称", "头像", "好友备注", "QQ账号", "标识id"];
  const mk = (rows: string[][]) => csv([friendHeader, ...rows]);

  it("行校验失败时错误信息包含具体列名与期望", () => {
    // 头像列放非URL内容 → 诊断应点名「头像」列
    const text = mk([
      ["2128667131", "687958", "", "", "2128667131", "我的好友", "小明", "不是网址", "", CIPHER, CIPHER],
    ]);
    const plan = buildImportPlan(text, {});
    expect(plan.canSubmit).toBe(false);
    const err = plan.rows.find(r => !r.valid)!.error!;
    expect(err).toContain("头像");
    expect(err).toContain("不是网址");
  });

  it("手工映射手机号兼容86-前缀并规范化入库", () => {
    const text = csv([
      ["QQ", "手机"],
      ["2128667131", "86-16650030502"],
    ]);
    const plan = buildManualMappedPlan(text, {
      hasHeader: true, sourceIndex: 0, sourceKind: "qq", targetIndex: 1, targetKind: "phone",
      relationLabel: "绑定",
    }, {});
    expect(plan.canSubmit).toBe(true);
    expect(plan.relations[0].targetKey).toBe("16650030502");
  });
});

describe("模板总数与既有合同回归", () => {
  it("旧四模板无表头位置合同仍然有效", () => {
    const noHeaderGroup = [["", "332621944", "", "【Success】成功", "2128667131", "2128667131", "", "【10】普通成员", "", "迈", "https://p.qlogo.cn/1", "", "15", "2022/10/07 14:27:12", "2018/03/31 10:17:23", "专为篮球", CIPHER]];
    const rec = recognizeTemplate(noHeaderGroup, { hasHeader: false });
    expect(rec.template).toBe("group-list");
  });

  it("无表头群成员位置合同可识别", () => {
    const noHeaderMember = [["548360752", "703049615", "548360752", "", "Success", CIPHER, "【0】正常", CIPHER, "", "🫥", "【0】普通成员", "【false】否", CIPHER]];
    const rec = recognizeTemplate(noHeaderMember, { hasHeader: false });
    expect(rec.template).toBe("group-member");
  });
});
