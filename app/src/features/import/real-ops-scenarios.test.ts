import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { recognizeTemplate, buildImportPlan, buildManualMappedPlan, suggestManualMapping, normalizeTable } from "./smart-table";

const DIR = "/Users/chrishong/Desktop/涉诈和大鱼线索/clueprobe大鱼线索/张士豪";
const read = (f: string) => readFileSync(`${DIR}/${f}`, "utf8");

describe("场景A：五文件严格识别全链路（含属性明细核对）", () => {
  it("A1 好友列表500行：关系方向、属性内容、起点回退三重核对", () => {
    const plan = buildImportPlan(read("PCG_好友列表.csv"), {});
    expect(recognizeTemplate(read("PCG_好友列表.csv")).template).toBe("friend-list");
    expect(plan.canSubmit).toBe(true);
    // 起点=解密列明文
    expect(plan.queryOrigin).toEqual({ kind: "qq", key: "2128667131" });
    // 方向：查询QQ → 好友 → 好友QQ
    expect(plan.relations[0]).toMatchObject({ sourceKey: "2128667131", label: "好友", targetKey: "687958" });
    // 属性内容真实存在（昵称/头像/标识id）且数量=500行的有效值
    const nicknames = plan.entityAttributes.filter(a => a.fieldKey === "nickname");
    expect(nicknames.length).toBeGreaterThan(400); // 495个非空昵称
    const groups = plan.relationAttributes.filter(a => a.fieldKey === "friend_group");
    expect(groups.length).toBe(500); // 分组列全非空
    expect(plan.stats.error).toBe(0);
  });

  it("A2 加群列表36行：群属性与角色属性核对", () => {
    const plan = buildImportPlan(read("PCG_加群列表.csv"), {});
    expect(plan.canSubmit).toBe(true);
    expect(plan.relations).toHaveLength(36);
    expect(plan.relations[0]).toMatchObject({ sourceKind: "qq", targetKind: "group", label: "加入群" });
    const names = plan.entityAttributes.filter(a => a.fieldKey === "group_name");
    expect(names.length).toBe(36);
    const roles = plan.relationAttributes.filter(a => a.fieldKey === "query_role");
    expect(roles.length).toBe(36);
  });

  it("A3 群成员100行：成员昵称/角色/机器人属性核对", () => {
    const plan = buildImportPlan(read("PCG_群成员-2.csv"), {});
    expect(plan.canSubmit).toBe(true);
    expect(plan.relations).toHaveLength(100);
    expect(plan.relations[0]).toMatchObject({ sourceKind: "group", targetKind: "qq", label: "群成员" });
    const roles = plan.relationAttributes.filter(a => a.fieldKey === "member_role");
    expect(roles).toHaveLength(100);
    const robots = plan.relationAttributes.filter(a => a.fieldKey === "robot").length;
    // 机器人列不在合同里，应为0（合同明确不导入该列）
    expect(robots).toBe(0);
  });

  it("A4 手机号查绑定QQ 5行：方向为手机号→QQ（查询起点顺流）", () => {
    const plan = buildImportPlan(read("PCG_手机号查绑定QQ.csv"), {});
    expect(plan.canSubmit).toBe(true);
    expect(plan.relations).toHaveLength(5);
    expect(plan.relations[0]).toMatchObject({ sourceKind: "phone", sourceKey: "16650030502", targetKind: "qq", label: "绑定手机号" });
    expect(plan.queryOrigin!.kind).toBe("phone");
  });

  it("A5 QQ查手机号1行：86-前缀规范化核对", () => {
    const plan = buildImportPlan(read("PCG_QQ查手机号-2.csv"), {});
    expect(plan.canSubmit).toBe(true);
    expect(plan.relations[0]).toMatchObject({ sourceKind: "qq", sourceKey: "2128667131", targetKind: "phone", targetKey: "16650030502" });
    expect(plan.queryOrigin).toEqual({ kind: "qq", key: "2128667131" });
  });
});

describe("场景B：手机号格式全兼容矩阵", () => {
  const header = ["手机号(解密)", "QQ账号(解密)", "命中查询内容", "错误备注", "错误码类型", "QQ账号", "手机号", "手机号类型", "设置时间", "修改时间", "验证时间"];
  const FORMATS: Array<[string, string]> = [
    ["86-16650030502", "86-前缀"],
    ["+86-16650030502", "+86-前缀"],
    ["+8616650030502", "+86无分隔"],
    ["8616650030502", "86无分隔"],
    ["166 5003 0502", "空格分段"],
    ["166-5003-0502", "连字符分段"],
    ["(86)16650030502", "括号国家码"],
    ["16650030502", "裸11位"],
  ];
  for (const [value, name] of FORMATS) {
    it(`B ${name}: ${value} → 16650030502`, () => {
      const text = [header.join(","), [value, "2128667131", "2128667131", "", "【Success】成功", "c1", "c2", "【1】密保手机", "", "", ""].join(",")].join("\n");
      const plan = buildImportPlan(text, {});
      expect(plan.template).toBe("qq-phone-lookup");
      expect(plan.canSubmit).toBe(true);
      expect(plan.relations[0].targetKey).toBe("16650030502");
    });
  }
  it("B 非法手机号仍被拒（不多兼容一步）", () => {
    const text = [header.join(","), ["12345", "2128667131", "2128667131", "", "【Success】成功", "c1", "c2", "", "", "", ""].join(",")].join("\n");
    expect(buildImportPlan(text, {}).canSubmit).toBe(false);
  });
});

describe("场景C：降级与手工映射实测", () => {
  it("C1 表头残缺自动降级：给出列建议而非空猜测", () => {
    // 模拟用户手抄的两列表（无完整表头）
    const text = "查询QQ,好友\n2128667131,687958\n2128667131,1890702";
    const rec = recognizeTemplate(text);
    expect(rec.template).toBe("custom");
    const sug = suggestManualMapping(text);
    expect(sug.sourceIndex).toBe(0);
    expect(sug.sourceKind).toBe("qq");
    expect(sug.targetIndex).toBe(1);
    expect(sug.targetKind).toBe("qq");
  });

  it("C2 手工映射含86-手机号：校验+入库规范化全通", () => {
    const text = "QQ,手机\n2128667131,+86 166-5003-0502";
    const plan = buildManualMappedPlan(text, { hasHeader: true, sourceIndex: 0, sourceKind: "qq", targetIndex: 1, targetKind: "phone", relationLabel: "绑定" }, {});
    expect(plan.canSubmit).toBe(true);
    expect(plan.relations[0].targetKey).toBe("16650030502");
  });

  it("C3 手工映射自动建议识别86-手机号列为phone", () => {
    const text = "手机号码,备注\n86-16650030502,x\n86-16650030502,y";
    const sug = suggestManualMapping(text);
    expect(sug.sourceKind).toBe("phone");
    expect(sug.sourceIndex).toBe(0);
  });
});

describe("场景D：边缘情况", () => {
  it("D1 文件含空行与列宽不齐：行宽诊断触发，不崩溃", () => {
    const header = ["QQ群账号(解密)", "QQ账号(解密)", "命中查询内容", "异常说明", "错误码类型", "QQ群账号(加密)", "群状态", "QQ账号(加密)", "群成员昵称", "QQ账号昵称", "成员角色", "是否机器人", "标识id"];
    const text = header.join(",") + "\n" + "548360752,703049615,548360752,,Success,c1,【0】正常,c2,,测试,【0】普通成员,【false】否,c3" + "\n" + "\n" + "548360752,703049616,548360752,少列";
    const plan = buildImportPlan(text, {});
    // 列宽不齐 → 明确报错不猜测
    expect(plan.canSubmit).toBe(false);
    expect(plan.batchErrors.join()).toContain("列数");
  });

  it("D2 重复表头行被清理：数据行不含表头", () => {
    const header = ["QQ群账号(解密)", "QQ账号(解密)", "命中查询内容", "异常说明", "错误码类型", "QQ群账号(加密)", "群状态", "QQ账号(加密)", "群成员昵称", "QQ账号昵称", "成员角色", "是否机器人", "标识id"];
    const row1 = "548360752,703049615,548360752,,Success,c1,【0】正常,c2,,甲,【0】普通成员,【false】否,c3";
    const text = header.join(",") + "\n" + row1 + "\n" + header.join(",");
    const t = normalizeTable(text);
    expect(t.duplicateHeadersRemoved).toBe(1);
    expect(t.dataRows).toHaveLength(1);
  });

  it("D3 好友表全部行错误码失败：整批拒绝且逐行有诊断", () => {
    const friendHeader = ["查询账号(解密)", "QQ账号(解密)", "错误备注", "错误码类型", "查询账号", "分组", "昵称", "头像", "好友备注", "QQ账号", "标识id"];
    const text = friendHeader.join(",") + "\n2128667131,687958,,【10000】账号异常,CIPHER,分组,小明,,,c1,c2";
    const plan = buildImportPlan(text, {});
    expect(plan.canSubmit).toBe(false);
    expect(plan.rows.find(r => !r.valid)!.error).toContain("错误码");
  });
});

describe("场景E：五文件互串识别（防模板混淆）", () => {
  const FILES: Array<[string, string]> = [
    ["PCG_好友列表.csv", "friend-list"],
    ["PCG_加群列表.csv", "group-list"],
    ["PCG_群成员-2.csv", "group-member"],
    ["PCG_手机号查绑定QQ.csv", "qq-phone-binding"],
    ["PCG_QQ查手机号-2.csv", "qq-phone-lookup"],
  ];
  it("E1 每个文件只命中自己的模板（顺序无关）", () => {
    for (const [f, expected] of FILES.slice().reverse()) {
      expect(recognizeTemplate(read(f)).template).toBe(expected);
    }
  });
  it("E2 六模板表头两两互不相同（合同无重叠）", () => {
    const templates = FILES.map(([, t]) => t);
    const fingerprints = new Set(
      FILES.map(([f]) => normalizeTable(read(f)).headers.join("\u0001"))
    );
    expect(fingerprints.size).toBe(FILES.length);
  });
});
