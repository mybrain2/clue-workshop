import { FormEvent, useEffect, useRef, useState } from "react";
import { kindLabel, type EntityKind } from "../../lib/types";
import { phoneContract } from "../import/smart-table";

const quickKinds: EntityKind[] = ["wechat", "qq", "phone", "ip"];
const moreKinds: EntityKind[] = ["platform", "device", "group", "organization", "location", "datacenter", "custom"];

function isIpv4(value: string) {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function detectKind(value: string): EntityKind | null {
  const first = value.trim();
  if (!first) return null;
  if (phoneContract.isPhoneLoose(first)) return "phone";
  if (isIpv4(first)) return "ip";
  if (/^(?:qq\s*)?\d{5,12}$/i.test(first)) return "qq";
  if (/^(wxid_|weixin|微信)/i.test(first)) return "wechat";
  return null;
}

type Props = {
  open: boolean;
  onClose(): void;
  onCreate(input: { title: string; background: string; seedKind: EntityKind; seedValue: string }): Promise<void>;
};

export function CreateCaseDialog({ open, onClose, onCreate }: Props) {
  const [title, setTitle] = useState("");
  const [seedValue, setSeedValue] = useState("");
  const [seedKind, setSeedKind] = useState<EntityKind | null>(null);
  const [showMoreKinds, setShowMoreKinds] = useState(false);
  const [background, setBackground] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  function closeDialog() {
    if (busy) return;
    onClose();
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTitle("");
    setSeedValue("");
    setSeedKind(null);
    setShowMoreKinds(false);
    setBackground("");
    setError("");
    const timer = window.setTimeout(() => titleRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") return closeDialog();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  if (!open) return null;

  function chooseKind(kind: EntityKind) {
    setSeedKind(kind);
    setError("");
  }

  function recognizeKind() {
    const detected = detectKind(seedValue);
    if (!detected) return setError("未能识别线索类型，请手动选择类型。");
    setSeedKind(detected);
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !seedValue.trim() || !seedKind || busy) return;
    setBusy(true);
    setError("");
    try {
      await onCreate({ title: title.trim(), background: background.trim(), seedKind, seedValue: seedValue.trim() });
      closeDialog();
    } catch (reason) {
      setError(`创建失败：${String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" onClick={closeDialog}>
    <form ref={dialogRef} className="dialog create-case-dialog" onSubmit={submit} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="create-case-title">
      <header><div><h2 id="create-case-title">新建案件</h2><p>先录入案件名和一条线索；其他信息可在案件内补充。</p></div><button type="button" onClick={closeDialog} disabled={busy} aria-label="关闭新建案件">×</button></header>
      <label>案件名称<input ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：某平台账号线索" required /></label>
      <label>第一条线索<input value={seedValue} onChange={(event) => setSeedValue(event.target.value)} placeholder="粘贴账号、手机号、IP、设备或群聊" required /></label>
      <section className="kind-picker" aria-label="第一条线索类型">
        <div className="kind-picker-heading"><span>{seedKind ? `线索类型：${kindLabel[seedKind]}` : "请选择线索类型"}</span></div>
        <div className="kind-hint">{quickKinds.map((kind) => <button type="button" className={seedKind === kind ? "selected" : ""} onClick={() => chooseKind(kind)} key={kind}>{kindLabel[kind]}</button>)}</div>
        <div className="more-kinds"><button type="button" className="more-kinds-toggle" aria-expanded={showMoreKinds} aria-controls="more-seed-kinds" onClick={() => setShowMoreKinds((value) => !value)}>{showMoreKinds ? "收起更多类型" : "更多类型"}</button><button type="button" className="more-kinds-toggle" onClick={recognizeKind}>识别类型</button>{showMoreKinds && <div className="kind-hint" id="more-seed-kinds">{moreKinds.map((kind) => <button type="button" className={seedKind === kind ? "selected" : ""} onClick={() => chooseKind(kind)} key={kind}>{kindLabel[kind]}</button>)}</div>}</div>
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <details className="advanced-details"><summary>补充案情简介（可选）</summary><textarea value={background} onChange={(event) => setBackground(event.target.value)} placeholder="不填也可以，后续可在案件概览补充" /></details>
      <footer><button type="button" onClick={closeDialog} disabled={busy}>取消</button><button className="primary" disabled={!title.trim() || !seedValue.trim() || !seedKind || busy}>{busy ? "正在创建…" : "创建案件"}</button></footer>
    </form>
  </div>;
}
