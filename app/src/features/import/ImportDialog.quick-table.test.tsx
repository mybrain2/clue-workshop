import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ index: 0, setters: [] as ReturnType<typeof vi.fn>[] }));
const clipboard = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => undefined,
    useMemo: <T,>(factory: () => T) => factory(),
    useRef: <T,>(value: T) => ({ current: value }),
    useState: <T,>(initial: T) => {
      const setter = vi.fn();
      hooks.setters[hooks.index++] = setter;
      return [initial, setter] as const;
    },
  };
});
vi.mock("../../lib/desktop-api", () => ({ readClipboardText: clipboard.read }));

import type { ReactElement, ReactNode } from "react";
import { ImportDialog } from "./ImportDialog";
import { normalizeTable } from "./smart-table";

const baseProps = {
  open: true,
  initialMode: "quick" as const,
  onClose: () => undefined,
  onImport: async () => ({ candidateCount: 0, addedCount: 0, skippedCount: 0 }),
  onSmartImport: async () => ({ addedEntities: 0, reusedEntities: 0, addedRelations: 0, reusedRelations: 0, addedAttributes: 0, reusedAttributes: 0, updatedAttributes: 0, attributeCount: 0, errorCount: 0 }),
  batches: [],
  onUndoBatch: async () => undefined,
};

function findElement(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  if (predicate(element)) return element;
  for (const child of Array.isArray(element.props.children) ? element.props.children : [element.props.children]) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return undefined;
}

const table17 = Array.from({ length: 17 }, (_, index) => Array.from({ length: 17 }, (_, column) => column === 0 ? "710000001" : column === 1 ? String(880000001 + index) : `字段${column + 1}-${index + 1}`).join("\t")).join("\n");

describe("ImportDialog 简要录入表格保护", () => {
  beforeEach(() => { hooks.index = 0; hooks.setters = []; clipboard.read.mockReset(); });

  it("读取 17×17 剪贴板时切换 smart、保留17条数据且不写入 quick 内容", async () => {
    clipboard.read.mockResolvedValue(table17);
    expect(normalizeTable(table17, false).dataRecordCount).toBe(17);
    const tree = ImportDialog(baseProps);
    const button = findElement(tree, (element) => element.type === "button" && element.props.children === "读取剪贴板");
    expect(button).toBeDefined();
    await (button!.props.onClick as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault: () => undefined });
    await Promise.resolve();

    expect(hooks.setters[0]).toHaveBeenCalledWith("smart");
    expect(hooks.setters[12]).toHaveBeenCalledWith(table17);
    expect(hooks.setters[13]).toHaveBeenCalledWith(null);
    expect(hooks.setters.some((setter) => setter.mock.calls.some(([value]) => value === false))).toBe(true);
    expect(hooks.setters.some((setter) => setter.mock.calls.some(([value]) => value === "检测到多列表格，已切换到全量粘贴"))).toBe(true);
    expect(hooks.setters[2]).not.toHaveBeenCalledWith(table17);
    expect(hooks.setters[8]).not.toHaveBeenCalled();
  });

  it("手工粘贴多列表格立即切换，单列名单保持 quick", () => {
    let tree = ImportDialog(baseProps);
    let textarea = findElement(tree, (element) => element.type === "textarea" && element.props.autoFocus === true);
    (textarea!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: table17 } });
    expect(hooks.setters[0]).toHaveBeenCalledWith("smart");
    expect(hooks.setters[12]).toHaveBeenCalledWith(table17);

    hooks.index = 0; hooks.setters = [];
    tree = ImportDialog(baseProps);
    textarea = findElement(tree, (element) => element.type === "textarea" && element.props.autoFocus === true);
    const accounts = Array.from({ length: 17 }, (_, index) => String(880000001 + index)).join("\n");
    (textarea!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: accounts } });
    expect(hooks.setters[0]).not.toHaveBeenCalled();
    expect(hooks.setters[2]).toHaveBeenCalledWith(accounts);
  });
});
