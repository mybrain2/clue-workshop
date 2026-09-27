import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { read, utils } from "xlsx";
import { buildImportPlan, recognizeTemplate, type TabularInput, type TemplateType } from "./smart-table";

const fixtures = new URL("./fixtures/", import.meta.url);
const templates = [
  ["group", "group-list"],
  ["friend", "friend-list"],
  ["device", "qq-device"],
  ["phone", "qq-phone-binding"],
] as const satisfies ReadonlyArray<readonly [string, Exclude<TemplateType, "custom">]>;

const csv = (name: string) => readFileSync(new URL(`${name}.csv`, fixtures), "utf8");
const xlsx = (name: string): unknown[][] => {
  const workbook = read(readFileSync(new URL(`${name}.xlsx`, fixtures)));
  return utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: false, defval: "" });
};
const expectedRelations = (template: TemplateType) => template === "qq-device" ? 5 : 6;

describe("原模板 28 份真实结构变体矩阵", () => {
  it.each(templates)("%s header CSV 自动识别并生成有效关系", (fixture, template) => {
    const input = csv(`${fixture}-header`);
    expect(recognizeTemplate(input)).toMatchObject({ template });
    const plan = buildImportPlan(input);
    expect(plan.canSubmit).toBe(true);
    expect(plan.stats).toMatchObject({ valid: expectedRelations(template), error: 0, relations: expectedRelations(template) });
  });

  it.each(templates)("%s header XLSX 二维数组自动识别并生成有效关系", (fixture, template) => {
    const input = xlsx(`${fixture}-header`);
    expect(recognizeTemplate(input)).toMatchObject({ template });
    const plan = buildImportPlan(input);
    expect(plan.canSubmit).toBe(true);
    expect(plan.stats).toMatchObject({ valid: expectedRelations(template), error: 0, relations: expectedRelations(template) });
  });

  it.each(templates)("%s no-header 可自动识别或手选后导入", (fixture, template) => {
    const input = csv(`${fixture}-no-header`);
    const recognition = recognizeTemplate(input, { hasHeader: false });
    if (recognition.confidence !== "low") expect(recognition.template).toBe(template);
    const plan = buildImportPlan(input, { template, hasHeader: false });
    expect(plan.canSubmit).toBe(true);
    expect(plan.stats).toMatchObject({ valid: expectedRelations(template), error: 0, relations: expectedRelations(template) });
  });

  it.each(templates)("%s missing-optional 可提交且不伪造缺失属性", (fixture, template) => {
    const plan = buildImportPlan(csv(`${fixture}-missing-optional`), { template });
    expect(plan.canSubmit).toBe(true);
    expect(plan.stats).toMatchObject({ valid: expectedRelations(template), error: 0, relations: expectedRelations(template) });
    const forbidden = template === "group-list" ? ["description", "announcement"]
      : template === "friend-list" ? ["friend_remark", "avatar"]
      : template === "qq-phone-binding" ? ["modified_at", "verified_at"] : ["avatar"];
    expect([...plan.entityAttributes, ...plan.relationAttributes].some(({ fieldKey }) => forbidden.includes(fieldKey))).toBe(false);
  });

  it.each(templates)("%s missing-key 阻止提交且有效行为零", (fixture, template) => {
    const plan = buildImportPlan(csv(`${fixture}-missing-key`), { template });
    expect(plan.canSubmit).toBe(false);
    expect(plan.stats.valid).toBe(0);
    expect(plan.stats.relations).toBe(0);
  });

  it.each(templates)("%s reordered 依照表头正确映射", (fixture, template) => {
    const plan = buildImportPlan(csv(`${fixture}-reordered`));
    expect(plan).toMatchObject({ template, canSubmit: true });
    expect(plan.stats).toMatchObject({ valid: expectedRelations(template), error: 0, relations: expectedRelations(template) });
  });

  it.each(templates)("%s dirty 忽略全空行并按唯一关系去重统计", (fixture, template) => {
    const plan = buildImportPlan(csv(`${fixture}-dirty`), { template });
    expect(plan.canSubmit).toBe(true);
    expect(plan.stats).toMatchObject({ valid: template === "qq-device" ? 5 : 7, error: 0, emptyRowsRemoved: 1, relations: expectedRelations(template) });
  });

  it("解密列优先于普通 QQ/群号噪声", () => {
    const group = buildImportPlan(csv("group-header"), { template: "group-list" });
    expect(group.sourceEntity?.key).toBe("710000001");
    expect(group.targetEntities.map(({ key }) => key)).toEqual(["891000001", "891000002", "891000003", "891000004", "891000005", "891000006"]);
    const friend = buildImportPlan(csv("friend-header"), { template: "friend-list" });
    expect(friend.sourceEntity?.key).toBe("710000001");
    expect(friend.targetEntities[0].key).toBe("892000001");
  });

  it.each(["header", "no-header", "missing-optional", "reordered", "dirty"])("同机 %s 原号码仅确定 source，不创建 self relation", (variant) => {
    const plan = buildImportPlan(csv(`device-${variant}`), { template: "qq-device", hasHeader: variant === "no-header" ? false : undefined });
    expect(plan.sourceEntity?.key).toBe("710000001");
    expect(plan.relations.some(({ sourceKey, targetKey }) => sourceKey === targetKey)).toBe(false);
    expect(plan.stats.relations).toBe(5);
  });

  it("同机表内原号码优先于当前选中的非QQ对象", () => {
    const plan = buildImportPlan(xlsx("device-header"), { currentSource: { kind: "device", value: "Device-QA-01" } });
    expect(plan).toMatchObject({ template: "qq-device", canSubmit: true });
    expect(plan.sourceEntity?.key).toBe("710000001");
    expect(plan.stats).toMatchObject({ valid: 5, error: 0, relations: 5 });
    expect(plan.relations.some(({ sourceKey, targetKey }) => sourceKey === targetKey)).toBe(false);
  });
});
