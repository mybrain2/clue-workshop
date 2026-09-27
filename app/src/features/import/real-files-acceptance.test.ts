import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { buildImportPlan, recognizeTemplate } from "./smart-table";

const DIR = "/Users/chrishong/Desktop/涉诈和大鱼线索/clueprobe大鱼线索/张士豪";

describe("真实五文件最终验收", () => {
  const CASES: Array<[string, string, number]> = [
    ["PCG_好友列表.csv", "friend-list", 500],
    ["PCG_加群列表.csv", "group-list", 36],
    ["PCG_群成员-2.csv", "group-member", 100],
    ["PCG_手机号查绑定QQ.csv", "qq-phone-binding", 5],
    ["PCG_QQ查手机号-2.csv", "qq-phone-lookup", 1],
  ];
  for (const [file, template, relationCount] of CASES) {
    it(`${file} → ${template}`, () => {
      const text = readFileSync(`${DIR}/${file}`, "utf8");
      expect(recognizeTemplate(text).template).toBe(template);
      const plan = buildImportPlan(text, {});
      expect(plan.canSubmit).toBe(true);
      expect(plan.batchErrors).toHaveLength(0);
      expect(plan.relations).toHaveLength(relationCount);
    });
  }
});
