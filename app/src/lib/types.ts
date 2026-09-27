export type CaseStatus = "active" | "archived" | "trash";
export type EntityKind = "subject" | "wechat" | "qq" | "phone" | "ip" | "location" | "datacenter" | "device" | "group" | "platform" | "organization" | "custom";

export interface ArchiveFolder { id: string; name: string; sortOrder: number; createdAt: string; updatedAt: string; }
export interface CaseRecord { id: string; title: string; archiveTitle?: string | null; archiveFolder: string; archiveFolderId?: string | null; background: string; policeDisposal: string; currentStatus: string; pathLanes: string; status: CaseStatus; sortOrder: number; updatedAt: string; entityCount: number; relationCount: number; }
export interface EntityRecord { id: string; caseId: string; kind: EntityKind; label: string; displayName: string; status: string; role: string; note: string; accent: string; pinned: boolean; customType?: string; }
export interface CaseOverviewInput { id: string; background: string; policeDisposal: string; currentStatus: string; pathLanes: string[]; }
export interface RelationRecord { id: string; caseId: string; sourceId: string; targetId: string; label: string; spread: string; status: string; note: string; emphasis: boolean; }
export type AttributeValueType = "text" | "number" | "datetime" | "enum" | "list";
export interface AttributeRecord { id: string; caseId: string; subjectId: string; fieldKey: string; valueType: AttributeValueType; valueText: string; valueNumber?: number | null; valueTime?: string | null; sortOrder: number; createdAt: string; updatedAt: string; }
export interface ImportBatch { id: string; caseId: string; sourceId: string; targetKind: EntityKind; relationLabel: string; relationSpread: string; relationCount: number; sourceSummary: string; createdAt: string; }
export interface HistoryRestoreResult { entityCount: number; relationCount: number; }
export interface AddRelationsResult { candidateCount: number; addedCount: number; skippedCount: number; attributeCount?: number; batch?: ImportBatch | null; }
export interface ImportPlanResult { addedEntities: number; reusedEntities: number; addedRelations: number; reusedRelations: number; addedAttributes: number; reusedAttributes: number; updatedAttributes: number; attributeCount: number; errorCount: number; batch?: ImportBatch | null; }
export interface Attachment { id: string; caseId: string; originalName: string; relativePath: string; sha256: string; mimeType: string; sizeBytes: number; collectedAt: string; note: string; entityId?: string | null; relationId?: string | null; createdAt: string; }
export interface CaseDetail { case: CaseRecord; rootId: string; entities: EntityRecord[]; relations: RelationRecord[]; entityAttributes: AttributeRecord[]; relationAttributes: AttributeRecord[]; attachments: Attachment[]; }
export interface StorageLayout { root: string; database: string; attachments: string; exports: string; backups: string; snapshots: string; logs: string; }
export interface ExportResult { directory: string; summaryPath: string; graphPath: string; dataPath: string; packagePath: string; xmindPath: string; markdownPath: string; xmindSizeBytes: number; xmindGeneratedAt: string; }
export const kindLabel: Record<EntityKind, string> = { subject: "主体簇", wechat: "微信号", qq: "QQ号", phone: "手机号", ip: "IP", location: "活跃位置", datacenter: "机房信息", device: "设备", group: "群聊", platform: "平台账号", organization: "个人/团伙", custom: "自定义对象" };
export const kindColor: Record<EntityKind, string> = { subject: "#286082", wechat: "#3e7e61", qq: "#6955a7", phone: "#a8722d", ip: "#ad5049", location: "#2b7f83", datacenter: "#885d3a", device: "#72757a", group: "#a64d70", platform: "#4269a5", organization: "#7b5932", custom: "#667085" };
