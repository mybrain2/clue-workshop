import { FormEvent, useEffect, useRef, useState } from "react";
import type { ArchiveFolder, CaseRecord } from "../../lib/types";

interface Props {
  open: boolean; folders: ArchiveFolder[]; cases: CaseRecord[]; error: string;
  onClose(): void; onCreate(name: string): Promise<void>;
  onRename(id: string, name: string): Promise<void>; onDelete(id: string): Promise<void>;
}

export function ArchiveFolderDialog(props: Props) {
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null), busyRef = useRef(busy), closeRef = useRef(props.onClose);
  busyRef.current = busy; closeRef.current = props.onClose;
  useEffect(() => {
    if (!props.open) return;
    setEditing(undefined); setBusy(undefined); setError("");
    const timer = window.setTimeout(() => titleRef.current?.focus(), 0);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busyRef.current) closeRef.current(); };
    window.addEventListener("keydown", escape);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", escape); };
  }, [props.open]);
  if (!props.open) return null;
  async function act(key: string, action: () => Promise<void>) {
    if (busy) return false;
    setBusy(key); setError("");
    try { await action(); return true; }
    catch (reason) { setError(String(reason)); return false; }
    finally { setBusy(undefined); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await act("create", () => props.onCreate(String(new FormData(form).get("name") || "")))) form.reset();
  }
  return <div className="modal-backdrop" onClick={() => { if (!busy) props.onClose(); }}><section className="dialog archive-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-folder-dialog-title" onClick={(event) => event.stopPropagation()}>
    <header><div><h2 id="archive-folder-dialog-title" ref={titleRef} tabIndex={-1}>管理归档文件夹</h2><p>仅空文件夹可删除，案件不会被删除。</p></div><button type="button" aria-label="关闭归档文件夹管理" disabled={Boolean(busy)} onClick={props.onClose}>×</button></header>
    <form className="archive-folder-create" onSubmit={submit}><input name="name" placeholder="新文件夹名称" required disabled={Boolean(busy)}/><button className="primary" disabled={Boolean(busy)}>{busy === "create" ? "正在新建…" : "新建"}</button></form>
    {(error || props.error) && <p className="danger-copy" role="alert">{error || props.error}</p>}
    <div className="archive-folder-list">{props.folders.map(folder => {
      const count = props.cases.filter(item => item.status === "archived" && item.archiveFolderId === folder.id).length;
      return <div key={folder.id}>{editing === folder.id ?
        <form onSubmit={async event => { event.preventDefault(); if (await act(`rename:${folder.id}`, () => props.onRename(folder.id, String(new FormData(event.currentTarget).get("name") || "")))) setEditing(undefined); }}><input name="name" defaultValue={folder.name} required disabled={Boolean(busy)}/><button className="primary" disabled={Boolean(busy)}>{busy === `rename:${folder.id}` ? "正在保存…" : "保存"}</button><button type="button" disabled={Boolean(busy)} onClick={() => setEditing(undefined)}>取消</button></form> :
        <><span><strong>{folder.name}</strong><small>{count} 个案件</small></span><button type="button" disabled={Boolean(busy)} onClick={() => setEditing(folder.id)}>重命名</button><button type="button" className="danger" disabled={Boolean(busy)} onClick={() => void act(`delete:${folder.id}`, () => props.onDelete(folder.id))}>{busy === `delete:${folder.id}` ? "正在删除…" : "删除"}</button></>
      }</div>;
    })}</div>
  </section></div>;
}
