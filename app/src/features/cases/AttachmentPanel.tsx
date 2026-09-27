import { open as pickPath } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import type { Attachment, CaseDetail } from "../../lib/types";

type Props = {
  detail?: CaseDetail;
  onAdd(sourcePath: string, note: string, entityId?: string): Promise<void>;
  onNote(attachment: Attachment, note: string): Promise<void>;
  onDelete(attachment: Attachment): Promise<void>;
  onOpen(attachment: Attachment): Promise<void>;
};

export function AttachmentPanel({ detail, onAdd, onNote, onDelete, onOpen }: Props) {
  const [note, setNote] = useState("");
  const [entityId, setEntityId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNoteIds, setSavingNoteIds] = useState<Record<string, boolean>>({});
  const attachments = detail?.attachments || [];
  useEffect(() => {
    setNoteDrafts((current) => Object.fromEntries(attachments.map((attachment) => [attachment.id, current[attachment.id] ?? attachment.note])));
  }, [detail?.attachments]);
  if (!detail) return null;
  async function choose() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const path = await pickPath({ multiple: false, title: "选择要固定的本地附件" });
      if (!path || Array.isArray(path)) return;
      await onAdd(path, note, entityId || undefined); setNote("");
    } catch (cause) { setError(`固定附件失败：${String(cause)}`); }
    finally { setBusy(false); }
  }
  async function updateNote(attachment: Attachment) {
    if (savingNoteIds[attachment.id]) return;
    const nextNote = noteDrafts[attachment.id] ?? attachment.note;
    setSavingNoteIds((current) => ({ ...current, [attachment.id]: true }));
    setError("");
    try {
      await onNote(attachment, nextNote);
      setNoteDrafts((current) => ({ ...current, [attachment.id]: nextNote }));
    } catch (cause) {
      setError(`保存附件说明失败：${String(cause)}`);
    } finally {
      setSavingNoteIds((current) => ({ ...current, [attachment.id]: false }));
    }
  }
  async function remove(attachment: Attachment) { try { await onDelete(attachment); } catch (cause) { setError(`删除附件失败：${String(cause)}`); } }
  async function open(attachment: Attachment) { try { await onOpen(attachment); } catch (cause) { setError(`打开附件失败：${String(cause)}`); } }
  return <details className="attachment-panel"><summary><span>证据附件</span><small>{attachments.length} 个本地副本</small></summary><div className="attachment-body">{error && <p className="import-error">{error}</p>}<p>副本保存在当前案件的隔离目录。</p><label>新附件说明<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="添加附件时一并记录来源或用途" /></label><label>关联对象（可选）<select value={entityId} onChange={(event) => setEntityId(event.target.value)}><option value="">不关联对象</option>{detail.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.displayName || entity.label}</option>)}</select></label><button className="attachment-add" disabled={busy} onClick={() => void choose()}>{busy ? "正在固定…" : "选择并固定附件"}</button><div className="attachment-list">{attachments.length === 0 ? <p>当前案件还没有附件。</p> : attachments.map((attachment) => <article key={attachment.id}><strong title={attachment.originalName}>{attachment.originalName}</strong><small>{attachment.mimeType} · {(attachment.sizeBytes / 1024).toFixed(1)} KB</small><input value={noteDrafts[attachment.id] ?? attachment.note} aria-label={`${attachment.originalName} 的说明`} onChange={(event) => setNoteDrafts((current) => ({ ...current, [attachment.id]: event.target.value }))} placeholder="添加说明"/><div><button disabled={savingNoteIds[attachment.id]} onClick={() => void updateNote(attachment)}>{savingNoteIds[attachment.id] ? "保存中…" : "保存说明"}</button><button onClick={() => void open(attachment)}>打开附件</button><button className="danger" onClick={() => { if (window.confirm(`确认删除附件“${attachment.originalName}”及其本地副本？此操作不可恢复。`)) void remove(attachment); }}>删除</button></div></article>)}</div></div></details>;
}
