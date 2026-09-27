import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/desktop-api", () => ({ readClipboardText: vi.fn() }));

import { ImportDialog } from "./ImportDialog";

const baseProps = {
  open: true,
  sourceLabel: "测试对象",
  onClose: () => undefined,
  onImport: async () => ({ candidateCount: 0, addedCount: 0, skippedCount: 0 }),
  onSmartImport: async () => ({ addedEntities: 0, reusedEntities: 0, addedRelations: 0, reusedRelations: 0, addedAttributes: 0, reusedAttributes: 0, updatedAttributes: 0, attributeCount: 0, errorCount: 0 }),
  batches: [],
  onUndoBatch: async () => undefined,
};

function renderMode(initialMode: "quick" | "smart") {
  return renderToStaticMarkup(<ImportDialog {...baseProps} initialMode={initialMode} />);
}

describe("ImportDialog 模式渲染", () => {
  it("简要录入只渲染简要字段", () => {
    const html = renderMode("quick");
    expect(html).toContain("对象类型");
    expect(html).toContain("关系名称");
    expect(html).toContain("扩散方式");
    expect(html).toContain("多值名单");
    expect(html).toContain("候选统计");
    expect(html).toContain("添加 0 条");
    expect(html).toContain("读取 Excel / CSV");
    expect(html).toContain("多列表格会自动转到全量粘贴");
    expect(html).not.toContain("粘贴表格");
    expect(html).not.toContain("字段映射与错误行");
    expect(html).not.toContain("导入记录");
  });

  it("全量粘贴第一步在固定页脚显示下一步操作", () => {
    const html = renderMode("smart");
    expect(html).toContain("读取 Excel / CSV");
    expect(html).toContain("模板");
    expect(html).not.toContain("模板合同自动识别");
    expect(html).toContain("hidden-file-input");
    expect(html).not.toContain("识别截图");
    expect(html).toContain("粘贴表格");
    expect(html).toContain("导入记录");
    expect(html).toContain("下一步：检查结果");
    expect(html).not.toContain("确认写入 0 条关系");
    expect(html).not.toContain("对象类型");
    expect(html).not.toContain("扩散方式");
    expect(html).not.toContain("多值名单");
    expect(html).not.toContain("候选统计");
  });
});
