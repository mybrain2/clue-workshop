import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportPlan } from "../features/import/smart-table";

const { readText, invoke } = vi.hoisted(() => ({ readText: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readText }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

beforeEach(() => {
  vi.resetModules();
  readText.mockReset();
  invoke.mockReset();
  Object.assign(globalThis, { window: { __TAURI_INTERNALS__: {} } });
});

describe("importPlan", () => {
  it("提交时仅保留每行的有效性与决策并保持其他输入", async () => {
    invoke.mockResolvedValue({});
    const plan = {
      template: "friend-list",
      templateVersion: "strict-v1",
      templateMode: "strict-header",
      headerFingerprint: "header-fingerprint",
      inputDigest: "input-digest",
      rawTable: [["QQ", "昵称"], ["10001", "好友"]],
      endpointContract: {
        sourceColumn: "当前QQ",
        sourceKind: "qq",
        targetColumn: "QQ",
        targetKind: "qq",
        relationLabel: "好友",
        direction: "source-to-target",
      },
      mapping: undefined,
      duplicateRelations: 0,
      rowDecisions: [
        {
          rowNumber: 2,
          valid: true,
          reason: "有效好友",
          targetEntities: [],
          relations: [],
          entityAttributes: [],
          relationAttributes: [],
          rawRecord: { QQ: "10001", 昵称: "好友" },
          relationKey: "qq:current->qq:10001",
          decision: "accepted",
        },
      ],
      batchErrors: [],
      stats: { total: 1, valid: 1, error: 0, relations: 0, entities: 0 },
      bridgeRelationCount: 0,
      sourceEntities: [],
      targetEntities: [],
      relations: [],
    } as unknown as ImportPlan;

    const { importPlan } = await import("./desktop-api");
    await importPlan("case-1", plan, "好友表");

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("import_plan", {
      input: expect.objectContaining({
        caseId: "case-1",
        sourceSummary: "好友表",
        template: "friend-list",
        templateVersion: "strict-v1",
        templateMode: "strict-header",
        headerFingerprint: "header-fingerprint",
        inputDigest: "input-digest",
        rawTable: plan.rawTable,
        endpointContract: plan.endpointContract,
        mapping: undefined,
        duplicateRelations: 0,
        batchErrors: [],
        rawRowCount: 1,
        validRowCount: 1,
        relationCount: 0,
        entityCount: 0,
        bridgeRelationCount: 0,
        errorCount: 0,
        entities: [],
        relations: [],
      }),
    });
    const input = invoke.mock.calls[0][1].input;
    expect(input.rowDecisions).toEqual([{ valid: true, decision: "accepted" }]);
    expect(Object.keys(input.rowDecisions[0])).toEqual(["valid", "decision"]);
  });
});

describe("readClipboardText", () => {
  it("插件有值时保留制表符和换行且不回退", async () => {
    const clipboard = "来源QQ\t目标QQ\n10001\t20002\n";
    readText.mockResolvedValue(clipboard);
    const { readClipboardText } = await import("./desktop-api");
    await expect(readClipboardText()).resolves.toBe(clipboard);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("插件空值时回退原生命令", async () => {
    const clipboard = "来源QQ\t目标QQ\n10001\t20002\n";
    readText.mockResolvedValue(" \n");
    invoke.mockResolvedValue(clipboard);
    const { readClipboardText } = await import("./desktop-api");
    await expect(readClipboardText()).resolves.toBe(clipboard);
    expect(invoke).toHaveBeenCalledWith("read_clipboard_text_native");
  });

  it("插件异常时回退原生命令", async () => {
    readText.mockRejectedValue(new Error("clipboard unavailable"));
    invoke.mockResolvedValue("fallback\tvalue\n");
    const { readClipboardText } = await import("./desktop-api");
    await expect(readClipboardText()).resolves.toBe("fallback\tvalue\n");
  });

  it("插件与原生读取均失败时保留两个错误", async () => {
    readText.mockRejectedValue(new Error("plugin failed"));
    invoke.mockRejectedValue(new Error("native failed"));
    const { readClipboardText } = await import("./desktop-api");
    await expect(readClipboardText()).rejects.toThrow("插件：plugin failed；原生：native failed");
  });
});
