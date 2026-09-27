import { useEffect, useRef, useState } from "react";
import type { CaseRecord } from "../../lib/types";

const fallback = ["初始线索", "联系方式", "账号关系", "设备与网络", "社交与组织", "延展"];
function lanes(raw: string) { try { const parsed = JSON.parse(raw); return Array.isArray(parsed) && parsed.length ? parsed.join("\n") : fallback.join("\n"); } catch { return fallback.join("\n"); } }
type Props = { caseRecord?: CaseRecord; open: boolean; onClose(): void; onSave(input: { background: string; policeDisposal: string; currentStatus: string; pathLanes: string[] }): Promise<void>; };

export function CaseOverviewDialog({ caseRecord, open, onClose, onSave }: Props) {
  const [background, setBackground] = useState("");
  const [policeDisposal, setPoliceDisposal] = useState("");
  const [currentStatus, setCurrentStatus] = useState("");
  const [pathLanes, setPathLanes] = useState(fallback.join("\n"));
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null), busyRef = useRef(busy), closeRef = useRef(onClose);
  busyRef.current = busy; closeRef.current = onClose;
  useEffect(() => { if (!caseRecord) return; setBackground(caseRecord.background || ""); setPoliceDisposal(caseRecord.policeDisposal || ""); setCurrentStatus(caseRecord.currentStatus || ""); setPathLanes(lanes(caseRecord.pathLanes)); }, [caseRecord?.id]);
  useEffect(() => { if (!open) return; const timer = window.setTimeout(() => titleRef.current?.focus(), 0); const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busyRef.current) closeRef.current(); }; window.addEventListener("keydown", escape); return () => { window.clearTimeout(timer); window.removeEventListener("keydown", escape); }; }, [open]);
  if (!open || !caseRecord) return null;
  async function save() { setBusy(true); try { await onSave({ background, policeDisposal, currentStatus, pathLanes: pathLanes.split(/\r?\n|,|，/).map((item) => item.trim()).filter(Boolean) }); onClose(); } finally { setBusy(false); } }
  return <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }}>
    <section className="dialog case-overview-dialog" role="dialog" aria-modal="true" aria-labelledby="case-overview-dialog-title" onClick={(event) => event.stopPropagation()}>
      <header><div><h2 id="case-overview-dialog-title" ref={titleRef} tabIndex={-1}>案件概览</h2><p>三段备注会进入简报；调查路径由真实关系自动分为主线、关联条件、背景说明与群组组织。</p></div><button type="button" disabled={busy} aria-label="关闭案件概览" onClick={onClose}>×</button></header>
      <label>案情简介<textarea value={background} onChange={(event) => setBackground(event.target.value)} placeholder="案件背景、初始发现与研判范围" /></label>
      <label>警方处置<textarea value={policeDisposal} onChange={(event) => setPoliceDisposal(event.target.value)} placeholder="已采取的处置、协查、固定证据或待办" /></label>
      <label>当前现状<textarea value={currentStatus} onChange={(event) => setCurrentStatus(event.target.value)} placeholder="当前进展、未核实点、下一步优先方向" /></label>
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "正在保存…" : "保存案件概览"}</button></footer>
    </section>
  </div>;
}
