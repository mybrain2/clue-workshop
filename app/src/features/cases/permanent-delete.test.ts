import { describe, expect, it, vi } from "vitest";
import { confirmPermanentCaseDeletion } from "./permanent-delete";

const item = { id: "case-1", title: "测试案件" };

describe("confirmPermanentCaseDeletion", () => {
  it("确认时提示不可恢复并携带案件名调用后端合同", async () => {
    const confirmDelete = vi.fn(() => true);
    const deleteCase = vi.fn(async () => undefined);

    await expect(confirmPermanentCaseDeletion(item, deleteCase, confirmDelete)).resolves.toBe(true);

    expect(confirmDelete).toHaveBeenCalledWith(expect.stringContaining("测试案件"));
    expect(confirmDelete).toHaveBeenCalledWith(expect.stringContaining("不可恢复"));
    expect(deleteCase).toHaveBeenCalledOnce();
    expect(deleteCase).toHaveBeenCalledWith("case-1", "测试案件");
  });

  it("取消时不调用永久删除", async () => {
    const deleteCase = vi.fn(async () => undefined);

    await expect(confirmPermanentCaseDeletion(item, deleteCase, () => false)).resolves.toBe(false);

    expect(deleteCase).not.toHaveBeenCalled();
  });
});
