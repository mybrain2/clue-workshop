import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  AddRelationsResult,
  EntityKind,
  ImportBatch,
  ImportPlanResult,
} from "../../lib/types";
import {
  buildImportPlan,
  buildManualMappedPlan,
  currentClueBridge,
  isTableLike,
  normalizeTable,
  suggestManualMapping,
  withCurrentClueBridge,
  type ImportPlan,
  type ManualEntityKind,
  type PlannedRelation,
  type TemplateType,
} from "./smart-table";
import { readTabularFile } from "./tabular-file";
import { readClipboardText } from "../../lib/desktop-api";
import { structuredFieldLabels } from "../../lib/structured-fields";
import {
  defaultSpreadFor,
  relationLabelForKind,
  RELATION_PRESETS,
  SPREAD_OPTIONS,
} from "../graph/relation-options";
const kindOptions: Array<[EntityKind, string]> = [
  ["wechat", "微信号"],
  ["qq", "QQ号"],
  ["phone", "手机号"],
  ["ip", "IP"],
  ["location", "活跃位置"],
  ["datacenter", "机房信息"],
  ["device", "设备"],
  ["group", "群聊"],
  ["platform", "平台账号"],
  ["organization", "个人/团伙"],
  ["custom", "自定义对象"],
];
const templateName: Record<TemplateType, string> = {
  "group-list": "QQ群列表",
  "friend-list": "QQ好友列表",
  "qq-device": "QQ同机",
  "qq-phone-binding": "QQ绑定手机号",
  "group-member": "QQ群成员",
  "qq-phone-lookup": "QQ查手机号",
  custom: "自定义",
};
const fieldName = structuredFieldLabels;

type Props = {
  open: boolean;
  initialMode?: Mode;
  initialSmartText?: string;
  initialSource?: string;
  sourceLabel?: string;
  sourceKey?: string;
  sourceKind?: EntityKind;
  existingRelations?: PlannedRelation[];
  existingEntityKeys?: ReadonlySet<string>;
  onClose(): void;
  onImport(input: {
    kind: EntityKind;
    values: string[];
    displayNames: string[];
    label: string;
    spread: string;
    note: string;
    customType: string;
    source: string;
  }): Promise<AddRelationsResult>;
  onSmartImport(plan: ImportPlan, source: string): Promise<ImportPlanResult>;
  batches: ImportBatch[];
  onUndoBatch(batch: ImportBatch): Promise<void>;
};
type Entry = { value: string; displayName: string };
type Mode = "quick" | "smart";
const split = (raw: string) =>
  raw
    .split(/\r?\n|\t|,|，/)
    .map((value) => value.trim())
    .filter(Boolean);
const isHeader = (value: string) =>
  /^(账号|QQ号?|微信号?|手机号|电话|IP|昵称|ID|编号|名称)$/i.test(value.trim());

export function ImportDialog({
  open,
  initialMode = "quick",
  initialSmartText = "",
  initialSource = "手工粘贴",
  sourceLabel,
  sourceKey,
  sourceKind,
  existingRelations = [],
  existingEntityKeys = new Set(),
  onClose,
  onImport,
  onSmartImport,
  batches,
  onUndoBatch,
}: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [kind, setKind] = useState<EntityKind>("qq"),
    [text, setText] = useState(""),
    [source, setSource] = useState("手工粘贴");
  const [label, setLabel] = useState(relationLabelForKind("qq")),
    [spread, setSpread] = useState(defaultSpreadFor("qq")),
    [note, setNote] = useState(""),
    [customType, setCustomType] = useState("");
  const [table, setTable] = useState<string[][] | null>(null),
    [valueColumn, setValueColumn] = useState(0),
    [nameColumn, setNameColumn] = useState(-1),
    [hasHeader, setHasHeader] = useState(false);
  const [smartText, setSmartText] = useState(initialMode === "smart" ? initialSmartText : ""),
    [smartRows, setSmartRows] = useState<string[][] | null>(null);
  const [connectCurrent, setConnectCurrent] = useState(false);
  const [explicitParentKey, setExplicitParentKey] = useState("");
  const [smartStep, setSmartStep] = useState<"structure" | "review">(
      initialMode === "smart" && initialSmartText.trim() ? "review" : "structure",
    ),
    [forceManual, setForceManual] = useState(false);
  const [headerChoice, setHeaderChoice] = useState<"auto" | "yes" | "no">(
      "auto",
    ),
    [sourceIndex, setSourceIndex] = useState<number | "">(""),
    [targetIndex, setTargetIndex] = useState<number | "">("");
  const [sourceMapKind, setSourceMapKind] = useState<ManualEntityKind>("qq"),
    [targetMapKind, setTargetMapKind] = useState<ManualEntityKind>("qq"),
    [relationName, setRelationName] = useState("关联"),
    [displayNameIndex, setDisplayNameIndex] = useState<number | "">("");
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState(""),
    [actionError, setActionError] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null),
    tableFileRef = useRef<HTMLInputElement>(null),
    openRef = useRef(open),
    pendingRef = useRef(false),
    closeRef = useRef(onClose),
    generation = useRef(0);
  const smart = mode === "smart";
  const pending = busy;
  openRef.current = open;
  pendingRef.current = pending;
  closeRef.current = onClose;
  const entries = useMemo<Entry[]>(() => {
    const raw = table
      ? table
          .slice(hasHeader ? 1 : 0)
          .map((row) => ({
            value: String(row[valueColumn] ?? "").trim(),
            displayName:
              nameColumn >= 0 ? String(row[nameColumn] ?? "").trim() : "",
          }))
      : split(text).map((value) => ({ value, displayName: "" }));
    const seen = new Set<string>();
    return raw.filter(
      (entry) =>
        entry.value && !seen.has(entry.value) && Boolean(seen.add(entry.value)),
    );
  }, [text, table, hasHeader, valueColumn, nameColumn]);
  const smartInput = smartRows ?? smartText;
  const strictPlan = useMemo(() => {
    if (
      !smart ||
      (typeof smartInput === "string" ? !smartInput.trim() : !smartInput.length)
    )
      return undefined;
    try {
      return buildImportPlan(smartInput, { currentSource: sourceKey && sourceKind ? { kind: sourceKind, value: sourceKey, displayName: sourceLabel } : undefined, existingEntityKeys, explicitParentKey });
    } catch {
      return undefined;
    }
  }, [smart, smartInput, sourceKey, sourceKind, sourceLabel, existingEntityKeys, explicitParentKey]);
  const manualMode = Boolean(
    strictPlan && (strictPlan.template === "custom" || forceManual),
  );
  const effectiveHasHeader =
    headerChoice === "auto"
      ? Boolean(normalizeTable(smartInput).hasHeader)
      : headerChoice === "yes";
  const plan = useMemo(() => {
    if (!manualMode || sourceIndex === "" || targetIndex === "")
      return strictPlan;
    try {
      return buildManualMappedPlan(smartInput, {
        hasHeader: effectiveHasHeader,
        sourceIndex,
        sourceKind: sourceMapKind,
        targetIndex,
        targetKind: targetMapKind,
        displayNameIndex:
          displayNameIndex === "" ? undefined : displayNameIndex,
        relationLabel: relationName,
      }, { currentSource: sourceKey && sourceKind ? { kind: sourceKind, value: sourceKey, displayName: sourceLabel } : undefined, existingEntityKeys });
    } catch {
      return strictPlan;
    }
  }, [
    manualMode,
    strictPlan,
    smartInput,
    effectiveHasHeader,
    sourceIndex,
    sourceMapKind,
    targetIndex,
    targetMapKind,
    displayNameIndex,
    relationName,
    sourceKey,
    sourceKind,
    sourceLabel,
    existingEntityKeys,
  ]);
  const bridge = useMemo(
    () =>
      plan && sourceKey && sourceKind
        ? currentClueBridge(
            plan,
            { kind: sourceKind, value: sourceKey, displayName: sourceLabel },
          )
        : undefined,
    [plan, sourceKey, sourceKind, sourceLabel],
  );
  const submittedPlan = useMemo(
    () => (connectCurrent ? withCurrentClueBridge(plan!, bridge) : plan),
    [plan, bridge, connectCurrent],
  );
  const unreachableBlocked = useMemo(
    () =>
      Boolean(
        smart &&
          smartStep === "review" &&
          plan?.accessStatus === "unavailable" &&
          !(connectCurrent && bridge) &&
          !plan?.batchErrors.length,
      ),
    [smart, smartStep, plan, connectCurrent, bridge],
  );
  const normalized = useMemo(
    () => (smart ? normalizeTable(smartInput) : undefined),
    [smart, smartInput],
  );
  const headers = table?.[0] || [];
  useEffect(() => {
    openRef.current = open;
    if (!open) {
      generation.current += 1;
      return;
    }
    setMode(initialMode);
    setKind("qq");
    setText("");
    setSource(initialSource);
    setLabel(relationLabelForKind("qq"));
    setSpread(defaultSpreadFor("qq"));
    setNote("");
    setCustomType("");
    setTable(null);
    setValueColumn(0);
    setNameColumn(-1);
    setHasHeader(false);
    setSmartText(initialMode === "smart" ? initialSmartText : "");
    setSmartRows(null);
    setConnectCurrent(false);
    setExplicitParentKey("");
    setSmartStep(initialMode === "smart" && initialSmartText.trim() ? "review" : "structure");
    setForceManual(false);
    setHeaderChoice("auto");
    setSourceIndex("");
    setTargetIndex("");
    setDisplayNameIndex("");
    setSourceMapKind("qq");
    setTargetMapKind("qq");
    setRelationName("关联");
    setBusy(false);
    setResult("");
    setActionError(
      initialMode === "smart" && initialSmartText
        ? "检测到多列表格，已转到全量导入"
        : "",
    );
    const timer = window.setTimeout(() => titleRef.current?.focus(), 0);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingRef.current) closeRef.current();
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", escape);
    };
  }, [open, initialMode, initialSmartText, initialSource]);
  useEffect(() => {
    setConnectCurrent(Boolean(plan?.accessStatus === "bridge-available" && bridge));
  }, [mode, sourceKey, sourceKind, plan, bridge]);
  useEffect(() => {
    if (!smart || !strictPlan || strictPlan.template !== "custom") return;
    const suggestion = suggestManualMapping(smartInput, effectiveHasHeader);
    setSourceIndex(suggestion.sourceIndex ?? "");
    setTargetIndex(suggestion.targetIndex ?? "");
    if (suggestion.sourceKind) setSourceMapKind(suggestion.sourceKind);
    if (suggestion.targetKind) setTargetMapKind(suggestion.targetKind);
    setSmartStep("structure");
  }, [smartInput, smart, effectiveHasHeader, strictPlan?.template]);
  if (!open) return null;

  function switchToSmart(input: string | string[][], nextSource: string) {
    setConnectCurrent(false);
    setExplicitParentKey("");
    setSmartStep("structure");
    setForceManual(false);
    setMode("smart");
    setSmartText(typeof input === "string" ? input : "");
    setSmartRows(typeof input === "string" ? null : input);
    setSource(nextSource);
    setResult("");
    setActionError("检测到多列表格，已切换到全量粘贴");
  }
  async function readWorkbook(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || busy) return;
    const run = generation.current;
    setBusy(true);
    setActionError("");
    try {
      const parsed = await readTabularFile(file);
      if (!openRef.current || run !== generation.current) return;
      if (smart) {
        setSmartRows(parsed.rows);
        setSmartText("");
      } else if (isTableLike(parsed.rows)) {
        switchToSmart(parsed.rows, parsed.sourceLabel);
      } else {
        const detected = parsed.rows.length > 1 && parsed.rows[0].some(isHeader);
        setTable(parsed.rows);
        setValueColumn(0);
        setNameColumn(parsed.rows[0]?.length > 1 ? 1 : -1);
        setHasHeader(detected);
        setText("");
      }
      setSource(parsed.sourceLabel);
      setResult("");
      setSmartStep("structure");
    } catch (error) {
      if (openRef.current && run === generation.current)
        setActionError(`读取文件失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (openRef.current && run === generation.current) setBusy(false);
      event.target.value = "";
    }
  }
  async function importClipboard() {
    if (busy) return;
    const run = generation.current;
    setBusy(true);
    setActionError("");
    try {
      const value = await readClipboardText();
      if (!openRef.current || run !== generation.current) return;
      if (!value.trim()) throw new Error("剪贴板中没有可读取的文本");
      if (smart) {
        setSmartText(value);
        setSmartRows(null);
        setSource("系统剪贴板");
        setResult("");
      } else if (isTableLike(value)) {
        switchToSmart(value, "系统剪贴板");
      } else {
        setText(value);
        setTable(null);
        setSource("系统剪贴板");
        setResult("");
      }
    } catch (error) {
      if (openRef.current && run === generation.current)
        setActionError(`读取剪贴板失败：${String(error)}`);
    } finally {
      if (openRef.current && run === generation.current) setBusy(false);
    }
  }
  async function confirm() {
    if (!entries.length || busy) return;
    setBusy(true);
    try {
      const run = generation.current;
      const outcome = await onImport({
        kind,
        values: entries.map((e) => e.value),
        displayNames: entries.map((e) => e.displayName),
        label: label.trim() || relationLabelForKind(kind),
        spread,
        note,
        customType,
        source,
      });
      if (!openRef.current || run !== generation.current) return;
      setResult(
        `候选 ${outcome.candidateCount}、实际新增 ${outcome.addedCount}、已存在/跳过 ${outcome.skippedCount}。`,
      );
      setActionError("");
    } catch (error) {
      setActionError(`导入失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }
  async function confirmSmart() {
    if (!submittedPlan?.canSubmit || busy) return;
    setBusy(true);
    try {
      const run = generation.current;
      const outcome = await onSmartImport(submittedPlan, source);
      if (!openRef.current || run !== generation.current) return;
      setResult(
        `新增对象 ${outcome.addedEntities}、复用对象 ${outcome.reusedEntities}、新增关系 ${outcome.addedRelations}、复用关系 ${outcome.reusedRelations}、新增属性 ${outcome.addedAttributes}、复用属性 ${outcome.reusedAttributes}、更新属性 ${outcome.updatedAttributes}、错误 ${outcome.errorCount}。`,
      );
      setActionError("");
    } catch (error) {
      setActionError(`导入失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }
  function clearSmartContent() {
    setConnectCurrent(false);
    setExplicitParentKey("");
    setSmartStep("structure");
    setForceManual(false);
    setSmartText("");
    setSmartRows(null);
    setSource("手工粘贴");
    setResult("");
    setActionError("");
  }
  function clearQuickContent() {
    setConnectCurrent(false);
    setText("");
    setTable(null);
    setValueColumn(0);
    setNameColumn(-1);
    setHasHeader(false);
    setSource("手工粘贴");
    setResult("");
    setActionError("");
  }
  const hasSmartContent =
    typeof smartInput === "string"
      ? Boolean(smartInput.trim())
      : smartInput.length > 0;
  const reason =
    !hasSmartContent || !plan || (manualMode && smartStep === "structure")
      ? ""
      : plan.diagnostics[0]?.message ||
        plan.batchErrors[0] ||
        plan.rows.find((row) => row.error)?.error ||
        (!plan.stats.valid ? "缺少有效主键" : "");
  const columnLabels = normalized
    ? Array.from(
        { length: Math.max(0, ...normalized.rows.map((r) => r.length)) },
        (_, i) =>
          `第${i + 1}列 · ${normalized.hasHeader ? normalized.headers[i] || "空表头" : normalized.dataRows.find((r) => r[i]?.trim())?.[i] || "空值"}`,
      )
    : [];
  const relationSamples = plan?.relations.slice(0, 3) || [];
  const statItems = plan
    ? [
        ["原始行", plan.stats.total],
        ["有效行", plan.stats.valid],
        ["错误行", plan.template === "custom" ? "未校验" : plan.stats.error],
        ["重复关系", plan.stats.duplicate],
        ["唯一对象", plan.stats.entities],
        ["唯一关系", plan.stats.relations],
        ["对象属性", plan.stats.entityAttributes],
        ["关系属性", plan.stats.relationAttributes],
      ]
    : [];
  const recordNote =
    plan && plan.stats.physicalLineCount !== plan.stats.logicalRecordCount
      ? plan.diagnostics[0]?.message ||
        `物理行与逻辑记录不同：检测到单元格内换行（${plan.stats.physicalLineCount} 行合并为 ${plan.stats.logicalRecordCount} 条记录）`
      : "";

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <section
        className="dialog entry-dialog import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="import-dialog-title" ref={titleRef} tabIndex={-1}>
              批量导入关联
            </h2>
            <p className="entry-sentence">
              {sourceLabel || "当前对象"}
              {!smart && (
                <>
                  {" "}
                  <b>— {label.trim() || "关系"} →</b>{" "}
                  {kindOptions.find(([value]) => value === kind)?.[1]}
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭批量导入"
            disabled={pending}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="import-mode-tabs" role="tablist" aria-label="导入模式">
          <button
            type="button"
            role="tab"
            aria-selected={!smart}
            className={!smart ? "selected" : ""}
            onClick={() => {
              setConnectCurrent(false);
              setMode("quick");
              setActionError("");
            }}
          >
            简要录入
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={smart}
            className={smart ? "selected" : ""}
            onClick={() => {
              setConnectCurrent(false);
              setMode("smart");
              setActionError("");
            }}
          >
            全量粘贴
          </button>
        </div>
        <div className="import-scroll-body">
          {smart && (
            <div className="import-source-row">
              <button type="button" className="file-picker" disabled={pending} onClick={()=>{if(tableFileRef.current){tableFileRef.current.value="";tableFileRef.current.click();}}}>读取 Excel / CSV</button>
              <input ref={tableFileRef} className="hidden-file-input" type="file" accept=".xlsx,.xls,.csv,.tsv,text/csv,text/tab-separated-values" disabled={pending} onChange={readWorkbook}/>
              <span>
                {sourceLabel ? `当前对象：${sourceLabel}` : "未选择当前对象"}
              </span>
            </div>
          )}
          {smart ? (
            <section className="smart-import-pane">
              <div className="smart-import-heading"><strong>智能模板与手动映射</strong></div>
              <div className="smart-stepper">
                <span className={smartStep === "structure" ? "active" : "done"}>
                  1 结构确认
                </span>
                <span className={smartStep === "review" ? "active" : ""}>
                  2 检查结果
                </span>
              </div>
              <label className="paste-field">
                <span className="paste-field-head">
                  <span>粘贴表格</span>
                  <span className="paste-field-actions">
                    <button
                      type="button"
                      className="clipboard-inline-button"
                      disabled={busy}
                      onClick={(event) => {
                        event.preventDefault();
                        void importClipboard();
                      }}
                    >
                      {busy ? "正在读取…" : "读取剪贴板"}
                    </button>
                    {hasSmartContent && (
                      <button
                        type="button"
                        className="ghost clear-content-button"
                        disabled={pending}
                        onClick={clearSmartContent}
                      >
                        清空内容
                      </button>
                    )}
                  </span>
                </span>
                <textarea
                  value={smartText}
                  onChange={(e) => {
                    setSmartText(e.target.value);
                    setSmartRows(null);
                    setSource("手工粘贴");
                    setSmartStep("structure");
                    setForceManual(false);
                    setActionError("");
                    setResult("");
                  }}
                  placeholder="从 Excel 复制后直接粘贴，或读取剪贴板"
                />
              </label>
              {plan && normalized && smartStep === "structure" && (
                <div className="import-summary">
                  {!manualMode ? (
                    <>
                      <div className="import-summary-head">
                        <strong>
                          自动识别为 {templateName[plan.template]}
                        </strong>
                        <span>{plan.templateVersion}</span>
                      </div>
                      <div className="mapping-cards">
                        {plan.template === "qq-device" ? <>
                          <span><small>当前选中QQ</small><b>{sourceKind === "qq" && sourceKey ? sourceKey : "未选择QQ"}</b></span>
                          <span><small>案件重合候选</small><b>{plan.overlapCandidates?.length ? plan.overlapCandidates.join("、") : "无"}</b></span>
                          <span><small>本批父节点</small><b>{plan.queryOrigin?.key || "待选择"}</b></span>
                          <span><small>选择原因</small><b>{plan.parentSelectionReason === "unique-existing-overlap" ? "唯一案件重合，自动使用" : plan.parentSelectionReason === "explicit-existing-overlap" ? "已人工选择重合QQ" : plan.parentSelectionReason === "file-origin" ? "使用文件内唯一原号码" : "使用当前选中QQ"}</b></span>
                          {(plan.overlapCandidates?.length || 0) > 1 && <label>选择本批父节点<select value={explicitParentKey} onChange={event=>setExplicitParentKey(event.target.value)}><option value="">请选择重合QQ</option>{plan.overlapCandidates!.map(key=><option key={key} value={key}>{key}</option>)}</select></label>}
                          <span><small>结果列 / 类型</small><b>{plan.endpointContract?.targetColumn} · {plan.endpointContract?.targetKind}</b></span>
                          <span><small>关系</small><b>{plan.endpointContract?.relationLabel}</b></span>
                        </> : <>
                          <span><small>查询起点</small><b>{plan.queryOrigin ? `${plan.queryOrigin.kind} · ${plan.queryOrigin.key}` : "未确定"}</b></span>
                          <span><small>接入状态</small><b>{plan.accessStatus === "query-origin" ? "当前对象就是查询起点" : plan.accessStatus === "reuse-existing" ? "复用案件已有查询起点" : plan.accessStatus === "bridge-available" ? "当前对象 → 查询号码 → 查询起点" : "缺少可用接入对象"}</b></span>
                          <span><small>查询起点列 / 类型</small><b>{plan.endpointContract?.sourceColumn} · {plan.endpointContract?.sourceKind}</b></span>
                          <span><small>关系</small><b>{plan.endpointContract?.relationLabel}</b></span>
                          <span><small>目标列 / 类型</small><b>{plan.endpointContract?.targetColumn} · {plan.endpointContract?.targetKind}</b></span>
                        </>}
                      </div>
                      {bridge && plan.accessStatus === "bridge-available" && <label><input type="checkbox" checked={connectCurrent} onChange={e=>setConnectCurrent(e.target.checked)}/> 接入当前对象：{bridge.relation.sourceKey} → 查询号码 → {bridge.relation.targetKey}</label>}
                      <ul className="relation-samples">
                        {relationSamples.map((r, i) => (
                          <li key={i}>
                            {r.sourceKey} → {r.label} → {r.targetKey}
                          </li>
                        ))}
                      </ul>
                      <details className="mapping-details">
                        <summary>调整映射</summary>
                        <p>已知模板合同不可直接编辑。</p>
                        <button
                          type="button"
                          onClick={() => {
                            setForceManual(true);
                            const suggestion = suggestManualMapping(
                              smartInput,
                              effectiveHasHeader,
                            );
                            setSourceIndex(suggestion.sourceIndex ?? "");
                            setTargetIndex(suggestion.targetIndex ?? "");
                            if (suggestion.sourceKind)
                              setSourceMapKind(suggestion.sourceKind);
                            if (suggestion.targetKind)
                              setTargetMapKind(suggestion.targetKind);
                          }}
                        >
                          切换到手动映射
                        </button>
                      </details>
                    </>
                  ) : (
                    <>
                      <p className="manual-notice">
                        未能可靠确定来源列和目标列，数据本身不一定有错。
                      </p>
                      <div className="manual-mapping-form">
                        <label>
                          第一行是否表头
                          <select
                            value={headerChoice}
                            onChange={(e) => {
                              setHeaderChoice(
                                e.target.value as typeof headerChoice,
                              );
                              setSmartStep("structure");
                            }}
                          >
                            <option value="auto">自动</option>
                            <option value="yes">有</option>
                            <option value="no">无</option>
                          </select>
                        </label>
                        <label>
                          来源列
                          <select
                            value={sourceIndex}
                            onChange={(e) =>
                              setSourceIndex(
                                e.target.value === ""
                                  ? ""
                                  : Number(e.target.value),
                              )
                            }
                          >
                            <option value="">请选择</option>
                            {columnLabels.map((x, i) => (
                              <option value={i} key={i}>
                                {x}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          来源类型
                          <select
                            value={sourceMapKind}
                            onChange={(e) =>
                              setSourceMapKind(
                                e.target.value as ManualEntityKind,
                              )
                            }
                          >
                            {["qq", "group", "phone", "ip", "custom"].map(
                              (x) => (
                                <option key={x}>{x}</option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          关系名称
                          <input
                            value={relationName}
                            onChange={(e) => setRelationName(e.target.value)}
                          />
                        </label>
                        <label>
                          目标列
                          <select
                            value={targetIndex}
                            onChange={(e) =>
                              setTargetIndex(
                                e.target.value === ""
                                  ? ""
                                  : Number(e.target.value),
                              )
                            }
                          >
                            <option value="">请选择</option>
                            {columnLabels.map((x, i) => (
                              <option value={i} key={i}>
                                {x}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          目标类型
                          <select
                            value={targetMapKind}
                            onChange={(e) =>
                              setTargetMapKind(
                                e.target.value as ManualEntityKind,
                              )
                            }
                          >
                            {["qq", "group", "phone", "ip", "custom"].map(
                              (x) => (
                                <option key={x}>{x}</option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          显示名列（可选）
                          <select
                            value={displayNameIndex}
                            onChange={(e) =>
                              setDisplayNameIndex(
                                e.target.value === ""
                                  ? ""
                                  : Number(e.target.value),
                              )
                            }
                          >
                            <option value="">不使用</option>
                            {columnLabels.map((x, i) => (
                              <option value={i} key={i}>
                                {x}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {plan.templateVersion === "manual-mapped-v1" &&
                        plan.batchErrors.map((x, i) => (
                          <p className="import-error" key={i}>
                            {x}
                          </p>
                        ))}
                      {plan.templateVersion === "manual-mapped-v1" &&
                        plan.rows
                          .filter((r) => !r.valid)
                          .slice(0, 8)
                          .map((r) => (
                            <p className="error-row" key={r.rowNumber}>
                              第 {r.rowNumber} 行：{r.error}
                            </p>
                          ))}
                    </>
                  )}
                </div>
              )}
              {plan && smartStep === "review" && (
                <div className="import-summary">
                  <div className="import-summary-head">
                    <strong>检查结果</strong>
                    <span>{plan.templateVersion}</span>
                  </div>
                  <div className="mapping-cards">
                    <span><small>查询起点</small><b>{plan.queryOrigin ? `${plan.queryOrigin.kind} · ${plan.queryOrigin.key}` : "未确定"}</b></span>
                    <span><small>接入状态</small><b>{plan.accessStatus === "query-origin" ? "当前对象就是查询起点" : plan.accessStatus === "reuse-existing" ? "复用案件已有查询起点" : connectCurrent && bridge ? "已勾选当前对象 → 查询号码 → 查询起点" : plan.accessStatus === "bridge-available" ? "未接入（用户已取消）" : plan.accessStatus === "unavailable" ? "缺少可用接入对象：已阻止提交" : "无接入关系"}</b></span>
                  </div>
                  {bridge && plan.accessStatus === "bridge-available" && <label className="bridge-check"><input type="checkbox" checked={connectCurrent} onChange={e=>setConnectCurrent(e.target.checked)}/> 接入当前对象：{bridge.relation.sourceKey} → 查询号码 → {bridge.relation.targetKey}</label>}
                  {plan.accessStatus === "unavailable" && plan.queryOrigin && <p className="import-error">提示：查询起点不在案件中且未选中接入对象，已阻止提交——本批结果会全部成为未连接对象。请先在图谱选中一个主链对象后重新打开导入，或勾选接入后再提交。</p>}
                  <div className="import-stats">
                    {statItems.map(([name, value]) => (
                      <span key={name}>
                        <b>{value}</b>
                        <small>{name}</small>
                      </span>
                    ))}
                  </div>
                  <ul className="relation-samples">
                    {relationSamples.map((r, i) => (
                      <li key={i}>
                        {r.sourceKey} → {r.label} → {r.targetKey}
                      </li>
                    ))}
                  </ul>
                  {reason && <p className="import-error">{reason}</p>}
                  <button
                    type="button"
                    onClick={() => setSmartStep("structure")}
                  >
                    返回调整
                  </button>
                </div>
              )}
            </section>
          ) : (
            <section className="quick-import-pane">
              <div className="import-source-row">
                <button type="button" className="file-picker" disabled={pending} onClick={()=>{if(tableFileRef.current){tableFileRef.current.value="";tableFileRef.current.click();}}}>读取 Excel / CSV</button>
                <input ref={tableFileRef} className="hidden-file-input" type="file" accept=".xlsx,.xls,.csv,.tsv,text/csv,text/tab-separated-values" disabled={pending} onChange={readWorkbook}/>
              </div>
              <div className="row">
                <label>
                  对象类型
                  <select
                    value={kind}
                    onChange={(e) => {
                      const next = e.target.value as EntityKind;
                      setKind(next);
                      setLabel(relationLabelForKind(next));
                      setSpread(defaultSpreadFor(next));
                    }}
                  >
                    {kindOptions.map(([v, n]) => (
                      <option value={v} key={v}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  关系名称
                  <input
                    list="import-relation-presets"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                  <datalist id="import-relation-presets">
                    {RELATION_PRESETS.map((item) => (
                      <option value={item} key={item} />
                    ))}
                  </datalist>
                </label>
              </div>
              <div className="row">
                <label>
                  扩散方式
                  <select
                    value={spread}
                    onChange={(e) => setSpread(e.target.value)}
                  >
                    {SPREAD_OPTIONS.map((item) => (
                      <option value={item} key={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                {kind === "custom" && (
                  <label>
                    自定义对象类型
                    <input
                      value={customType}
                      onChange={(e) => setCustomType(e.target.value)}
                    />
                  </label>
                )}
              </div>
              <label className="paste-field">
                <span className="paste-field-head">
                  <span>多值名单（每行一个；支持 Tab、逗号）</span>
                  <span className="paste-field-actions">
                    <button
                      type="button"
                      className="clipboard-inline-button"
                      disabled={busy}
                      onClick={(event) => {
                        event.preventDefault();
                        void importClipboard();
                      }}
                    >
                      {busy ? "正在读取…" : "读取剪贴板"}
                    </button>
                    {text.trim() && (
                      <button
                        type="button"
                        className="ghost clear-content-button"
                        aria-label="清空候选名单内容"
                        onClick={clearQuickContent}
                      >
                        清空内容
                      </button>
                    )}
                  </span>
                </span>
                <textarea
                  value={text}
                  autoFocus
                  onChange={(e) => {
                    const value = e.target.value;
                    if (isTableLike(value)) {
                      switchToSmart(value, "手工粘贴");
                      return;
                    }
                    setText(value);
                    setTable(null);
                    setSource("手工粘贴");
                    setActionError("");
                    setResult("");
                  }}
                />
                <small>多列表格会自动转到全量粘贴</small>
              </label>
              <details className="quick-note-details">
                <summary>备注</summary>
                <label>
                  备注
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
              </details>
              <div className="import-preview">
                <strong>候选统计</strong>
                <span>识别 {entries.length} 个去重候选值</span>
                {entries.length > 0 && (
                  <code>
                    {entries
                      .slice(0, 10)
                      .map((e) =>
                        e.displayName
                          ? `${e.value}（${e.displayName}）`
                          : e.value,
                      )
                      .join(" · ")}
                  </code>
                )}
              </div>
            </section>
          )}
          {result && <p className="import-result">{result}</p>}
          {actionError && <p className="import-error">{actionError}</p>}
          {smart && (
            <details className="import-history">
              <summary>导入记录（{batches.length}）</summary>
              {batches.length ? (
                batches.map((batch) => (
                  <div className="import-batch" key={batch.id}>
                    <span>
                      {batch.createdAt} · {batch.sourceSummary} · 新增{" "}
                      {batch.relationCount} 条
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm("确认撤销本批新增内容？"))
                          void onUndoBatch(batch).catch((e) =>
                            setActionError(`撤销失败：${String(e)}`),
                          );
                      }}
                    >
                      撤销此批
                    </button>
                  </div>
                ))
              ) : (
                <p>暂无可撤销批次</p>
              )}
            </details>
          )}
        </div>
        <footer>
          <button type="button" disabled={pending} onClick={onClose}>
            取消
          </button>
          {smart && smartStep === "structure" ? (
            <button
              type="button"
              className="primary"
              disabled={pending || !plan?.canSubmit}
              onClick={() => setSmartStep("review")}
            >
              下一步：检查结果
            </button>
          ) : (
            <button
              className="primary"
              disabled={pending || (smart ? !plan?.canSubmit || unreachableBlocked : !entries.length)}
              onClick={() => void (smart ? confirmSmart() : confirm())}
            >
              {busy
                ? "正在写入…"
                : smart
                  ? `确认写入 ${plan?.stats.relations || 0} 条关系`
                  : `添加 ${entries.length} 条`}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
