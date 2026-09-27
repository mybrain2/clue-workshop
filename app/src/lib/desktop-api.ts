import { invoke } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import type { AddRelationsResult, ArchiveFolder, Attachment, AttributeRecord, CaseDetail, CaseOverviewInput, CaseRecord, EntityKind, EntityRecord, ExportResult, HistoryRestoreResult, ImportBatch, ImportPlanResult, RelationRecord, StorageLayout } from "./types";
import type { ImportPlan } from "../features/import/smart-table";

const inTauri = "__TAURI_INTERNALS__" in window;
async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> { if (!inTauri) throw new Error("请在桌面应用中运行"); return invoke<T>(name, args); }
export async function readClipboardText(): Promise<string> {
  if (!inTauri) throw new Error("请在桌面应用中运行");
  let pluginError: unknown;
  try {
    const text = await readText();
    if (text.trim()) return text;
    pluginError = new Error("剪贴板插件返回空文本");
  } catch (error) {
    pluginError = error;
  }

  try {
    return await invoke<string>("read_clipboard_text_native");
  } catch (nativeError) {
    const pluginMessage = pluginError instanceof Error ? pluginError.message : String(pluginError);
    const nativeMessage = nativeError instanceof Error ? nativeError.message : String(nativeError);
    throw new Error(`剪贴板插件与原生读取均失败：插件：${pluginMessage}；原生：${nativeMessage}`);
  }
}
export const initializeStorage = () => command<StorageLayout>("initialize_storage");
export const getExternalRevision = () => command<string>("get_external_revision");
export const listArchiveFolders = () => command<ArchiveFolder[]>("list_archive_folders");
export const createArchiveFolder = (name: string) => command<ArchiveFolder>("create_archive_folder", { name });
export const renameArchiveFolder = (id: string, name: string) => command<void>("rename_archive_folder", { id, name });
export const deleteArchiveFolder = (id: string) => command<void>("delete_archive_folder", { id });
export const listCases = (status?: CaseRecord["status"]) => command<CaseRecord[]>("list_cases", { status: status ?? null });
export const getCaseDetail = (id: string) => command<CaseDetail>("get_case_detail", { id });
export const createCase = (title: string, background: string, seedKind: EntityKind, seedValue: string) => command<CaseRecord>("create_case", { title, background, seedKind, seedValue });
export const reorderCases = (ids: string[]) => command<void>("reorder_cases", { ids });
export const archiveCase = (id: string, archiveTitle: string, note: string, folderId?: string | null) => command<void>("archive_case", { id, archiveTitle, note, folderId: folderId || null });
export const restoreCase = (id: string) => command<void>("restore_case", { id });
export const trashCase = (id: string) => command<void>("trash_case", { id });
export const permanentlyDeleteCase = (id: string, confirmedTitle: string) => command<void>("permanently_delete_case", { id, confirmedTitle });
export const addRelations = (caseId: string, sourceId: string, targetKind: EntityKind, values: string[], label: string, spread: string, note: string, customType = "", displayNames?: string[], source?: string, entityAttributes?: ImportPlan["entityAttributes"], relationAttributes?: ImportPlan["relationAttributes"]) => command<AddRelationsResult>("add_relations", { caseId, sourceId, targetKind, values, displayNames, label, spread, note, customType, source, entityAttributes, relationAttributes });
export const importPlan = (caseId: string, plan: ImportPlan, sourceSummary: string) => command<ImportPlanResult>("import_plan", { input: { caseId, sourceSummary, template: plan.template, templateVersion: plan.templateVersion, templateMode: plan.templateMode, headerFingerprint: plan.headerFingerprint, inputDigest: plan.inputDigest, rawTable: plan.rawTable, queryOrigin: plan.queryOrigin, currentSource: plan.currentSource, overlapCandidates: plan.overlapCandidates, parentSelectionReason: plan.parentSelectionReason, explicitParentKey: plan.explicitParentKey, endpointContract: plan.endpointContract, mapping: plan.mapping, duplicateRelations: plan.duplicateRelations, rowDecisions: plan.rowDecisions.map(({ valid, decision }) => ({ valid, decision })), batchErrors: plan.batchErrors, rawRowCount: plan.stats.total, validRowCount: plan.stats.valid, relationCount: plan.stats.relations, entityCount: plan.stats.entities, bridgeRelationCount: plan.bridgeRelationCount ?? 0, errorCount: plan.stats.error, entities: [...plan.sourceEntities, ...plan.targetEntities], relations: plan.relations } });
export const listImportBatches = (caseId: string) => command<ImportBatch[]>("list_import_batches", { caseId });
export const undoImportBatch = (caseId: string, batchId: string) => command<number>("undo_import_batch", { caseId, batchId });
export const updateCaseOverview = (input: CaseOverviewInput) => command<void>("update_case_overview", { input });
export const updateEntity = (entity: EntityRecord) => command<void>("update_entity", { entity });
export const deleteEntity = (caseId: string, entityId: string) => command<void>("delete_entity", { caseId, entityId });
export const updateRelation = (relation: RelationRecord) => command<void>("update_relation", { relation });
export const upsertAttributes = (caseId: string, subjectKind: "entity" | "relation", attributes: AttributeRecord[]) => command<AttributeRecord[]>("upsert_attributes", { caseId, subjectKind, attributes });
export const deleteAttribute = (caseId: string, subjectKind: "entity" | "relation", attributeId: string) => command<void>("delete_attribute", { caseId, subjectKind, attributeId });
export const addAttachment = (caseId: string, sourcePath: string, note = "", entityId?: string, relationId?: string) => command<Attachment>("add_attachment", { caseId, sourcePath, note, entityId, relationId });
export const updateAttachmentNote = (caseId: string, attachmentId: string, note: string) => command<void>("update_attachment_note", { caseId, attachmentId, note });
export const deleteAttachment = (caseId: string, attachmentId: string) => command<void>("delete_attachment", { caseId, attachmentId });
export const openAttachment = (caseId: string, attachmentId: string) => command<void>("open_attachment", { caseId, attachmentId });
export const exportCase = (id: string) => command<ExportResult>("export_case", { id });
export const exportCaseTo = (id: string, destinationRoot: string) => command<ExportResult>("export_case_to", { id, destinationRoot });
export const importCasePackage = (packagePath: string) => command<CaseRecord>("import_case_package", { packagePath });
export const undoCase = (caseId: string) => command<HistoryRestoreResult>("undo_case", { caseId });
export const redoCase = (caseId: string) => command<HistoryRestoreResult>("redo_case", { caseId });
