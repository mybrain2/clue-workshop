import type { CaseRecord } from "../../lib/types";

export async function confirmPermanentCaseDeletion(
  item: Pick<CaseRecord, "id" | "title">,
  deleteCase: (id: string, confirmedTitle: string) => Promise<unknown>,
  confirmDelete: (message: string) => boolean = window.confirm,
) {
  if (!confirmDelete(`确认永久删除案件「${item.title}」？此操作不可恢复。`)) return false;
  await deleteCase(item.id, item.title);
  return true;
}
