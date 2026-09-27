import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/desktop-api", () => ({ readClipboardText: vi.fn() }));

import { ImportDialog } from "./ImportDialog";

// 六模板群列表表头（与 smart-table 合同一致）
const GROUP_HEADERS = ["QQ账号(解密)","QQ群账号(解密)","错误备注","错误码类型","命中结果","QQ号","群号","查询人角色","群备注","群名称","群头像","最新群公告","群人数","最后群消息时间","群创建时间","群简介","标识id"];
function groupRow(seed = "710000001", group = "910000001") {
  // 17列：QQ账号(解密) QQ群账号(解密) 错误备注 错误码类型 命中结果 QQ号 群号 查询人角色 群备注 群名称 群头像 最新群公告 群人数 最后群消息时间 群创建时间 群简介 标识id
  return [seed, group, "", "【Success】成功", seed, seed, group, "【10】普通成员", "", "测试群", "https://example.com/a.png", "", "3", "2026-01-01 10:00:00", "2025-01-01 10:00:00", "", ""].join("\t");
}
const GROUP_TSV = [GROUP_HEADERS.join("\t"), groupRow(), groupRow("710000001", "910000002")].join("\n");

const baseProps = {
  open: true,
  initialMode: "smart" as const,
  initialSmartText: GROUP_TSV,
  onClose: () => undefined,
  onImport: async () => ({ candidateCount: 0, addedCount: 0, skippedCount: 0 }),
  onSmartImport: async () => ({ addedEntities: 0, reusedEntities: 0, addedRelations: 0, reusedRelations: 0, addedAttributes: 0, reusedAttributes: 0, updatedAttributes: 0, attributeCount: 0, errorCount: 0 }),
  batches: [],
  onUndoBatch: async () => undefined,
};

function renderHtml(extra: Partial<typeof baseProps> = {}) {
  return renderToStaticMarkup(<ImportDialog {...baseProps} {...extra} />);
}

describe("ImportDialog unavailable 阻止提交合同（2026-09-23）", () => {
  it("无选中对象时第二步显示已阻止提交，确认按钮 disabled", () => {
    const html = renderHtml({ sourceKey: undefined, sourceKind: undefined, existingEntityKeys: new Set() });
    // 第二步（review）渲染：strict 计划 + unavailable 接入状态
    expect(html).toContain("缺少可用接入对象：已阻止提交");
    expect(html).toContain("已阻止提交——本批结果会全部成为未连接对象");
    // 确认写入按钮被禁用（disabled 属性出现在按钮上）
    expect(html).toMatch(/<button[^>]*class="primary"[^>]*disabled[^>]*>/);
    expect(html).toContain("确认写入");
  });

  it("选中主链对象时正常可提交（bridge-available 默认勾选接入）", () => {
    const html = renderHtml({
      sourceLabel: "123123123",
      sourceKey: "123123123",
      sourceKind: "qq" as never,
      existingEntityKeys: new Set(["qq\u0000123123123"]),
    });
    // 选中了案件已有对象 → bridge-available，不出现阻断文案
    expect(html).not.toContain("已阻止提交");
    expect(html).toContain("接入当前对象");
  });

  it("无选中且起点即查询对象（query-origin 不存在此形态）之外的计划不受影响", () => {
    // 无选中时计划 accessStatus=unavailable 且无 batchErrors → 阻断；
    // 若存在 batchErrors（canSubmit=false）按钮本来就禁用，文案不叠加
    const html = renderHtml({ sourceKey: undefined, sourceKind: undefined, existingEntityKeys: new Set() });
    expect(html).toContain("缺少可用接入对象：已阻止提交");
  });
});
