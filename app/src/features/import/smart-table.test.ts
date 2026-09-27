import { describe, expect, it } from "vitest";
import { buildImportPlan, isTableLike, normalizeTable, parseDelimited } from "./smart-table";

const headers = ["QQ账号(解密)","QQ群账号(解密)","错误备注","错误码类型","命中结果","QQ号","群号","查询人角色","群备注","群名称","群头像","最新群公告","群人数","最后群消息时间","群创建时间","群简介","标识id"];
const valid = ["","880000001","","【Success】成功","710000001","710000001","cipher-group","管理员","","测试群","","公告","20","2026-09-01","2020-01-01","","id-1"];

describe("strict-v1 表格解析安全边界", () => {
  it("单行 TSV 与表头加一行均为表格", () => {
    expect(isTableLike("a\tb")).toBe(true);
    expect(isTableLike([headers, valid])).toBe(true);
  });
  it("单行逗号账号名单保持 QuickAdd，未知 CSV 失败关闭", () => {
    expect(isTableLike("710000001,880000001")).toBe(false);
    expect(buildImportPlan("foo,bar\na,b").canSubmit).toBe(false);
  });
  it("严格已知单行 CSV 表头路由 smart 但不可提交空批", () => {
    expect(isTableLike(headers.join(","))).toBe(true);
    expect(buildImportPlan(headers.join(",")).canSubmit).toBe(false);
  });
  it("RFC4180 引号内换行和制表符保持单元格", () => {
    const parsed=parseDelimited('a\t"内含\n换行"\t"内含\tTab"');
    expect(parsed.rows[0]).toEqual(["a","内含\n换行","内含\tTab"]);
  });
  it("规范表格与摘要原始行一致", () => {
    const plan=buildImportPlan([headers,valid]);
    expect(plan).toMatchObject({template:"group-list",canSubmit:true,rawTable:[headers,valid]});
    expect(plan.inputDigest).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
  });
  it("重复、额外、缺失表头均拒绝", () => {
    expect(buildImportPlan([headers.concat("额外"),valid.concat("")]).canSubmit).toBe(false);
    expect(buildImportPlan([[...headers,"QQ号"],valid.concat("710000001")]).canSubmit).toBe(false);
    expect(buildImportPlan([headers.slice(1),valid.slice(1)]).canSubmit).toBe(false);
  });
  it("数据行额外或缺少单元格均失败关闭", () => {
    const short=buildImportPlan([headers,valid.slice(0,-1)]);
    const long=buildImportPlan([headers,valid.concat("extra")]);
    expect(short.canSubmit).toBe(false);
    expect(long.canSubmit).toBe(false);
    expect(short.diagnostics[0]?.code).toBe("row-width");
    expect(long.diagnostics[0]?.code).toBe("row-width");
  });
  it("normalizeTable 保留单行 TSV 两列",()=>expect(normalizeTable("a\tb",false).rows).toEqual([["a","b"]]));
});
