import { CSSProperties, memo, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CaseDetail, EntityKind, EntityRecord, RelationRecord } from "../../lib/types";
import { kindColor, kindLabel } from "../../lib/types";
import { attributeLabel, attributeValue, entityDisplay, entityKinds } from "../../lib/entity-presentation";

type View = "path" | "network" | "table";
export type RenderEntity = EntityRecord & { virtual?: boolean; hiddenCount?: number };
export type RenderRelation = RelationRecord & { cross?: boolean; virtual?: boolean };
type Point = { x: number; y: number; layer: number; context?: boolean; disconnected?: boolean; sourceId?: string };
type Projection = { entities: RenderEntity[]; edges: RenderRelation[]; positions: Map<string, Point>; hidden: number; width: number; height: number; maxLayer: number; contextStart: number };

export const COLLAPSE_THRESHOLD = 6;
const VIEW_LAYOUT_VERSION = 8;
export const contextDisplayLabel = (entity: Pick<EntityRecord, "kind" | "label">) => `${kindLabel[entity.kind]} · ${entity.label}`;

export const GraphPanel = memo(function GraphPanel({ detail, selectedId, selectedRelationId, onSelect, onRelation, onEditRelation, onEditNode, onAddFromNode, onDeleteNode }: {
  detail?: CaseDetail;
  selectedId?: string;
  selectedRelationId?: string;
  onSelect(id: string): void;
  onRelation(id: string): void;
  onEditRelation(id: string): void;
  onEditNode(id: string): void;
  onAddFromNode(id: string): void;
  onDeleteNode(id: string): void;
}) {
  const [view, setView] = useState<View>("path");
  const [depth, setDepth] = useState(1);
  // 缩放和位移必须原子更新；分开 setState 会在连续滚轮事件中混用上一帧的 zoom/pan，造成锚点向上漂移。
  const [viewport, setViewport] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const { zoom, pan } = viewport;
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<Set<EntityKind>>(() => new Set());
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [onlyUnverified, setOnlyUnverified] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [nodeMenu, setNodeMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, number>>({});
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number; pointerId: number; caseId: string; capture: HTMLElement; nodeId?: string; baseOffset?: number; moved?: boolean } | null>(null);
  const suppressNodeClick = useRef<string | null>(null);

  const filtersActive = Boolean(query.trim()) || kinds.size > 0 || onlyPinned || onlyUnverified;
  const filterMatchingIds = useMemo(() => filtersActive ? matchingGraphEntityIds(detail, query, kinds, onlyPinned, onlyUnverified) : new Set<string>(), [detail, query, kinds, onlyPinned, onlyUnverified]);
  const graph = useMemo(
    () => project(detail, view, undefined, depth, expanded, nodeOffsets, filterMatchingIds),
    [detail, view, depth, expanded, nodeOffsets, filterMatchingIds],
  );
  const filtered = useMemo(() => filterGraph(detail, graph, query, kinds, onlyPinned, onlyUnverified), [detail, graph, query, kinds, onlyPinned, onlyUnverified]);
  const relationSummary = (relation: RelationRecord) => edgeShortSummary(relation, detail?.relationAttributes || []);
  const activeSelectedId = filtered.entityIds.has(selectedId || "") ? selectedId : undefined;
  const activeSelectedRelationId = filtered.relationIds.has(selectedRelationId || "") ? selectedRelationId : undefined;

  useEffect(() => {
    if (!detail) return;
    // 切换案件先回到稳定的阅读起点；若该案件没有有效状态，不能继承上一案件的缩放或展开状态。
    setView("path");
    setDepth(1);
    setViewport({ zoom: 1, pan: { x: 0, y: 0 } });
    setExpanded(false);
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(`clue-node-offsets:${detail.case.id}`) || "{}");
      if (!saved || Array.isArray(saved) || Object.getPrototypeOf(saved) !== Object.prototype) throw new Error("invalid offsets");
      const offsets: Record<string, number> = {};
      for (const [id, offset] of Object.entries(saved)) {
        if (typeof offset !== "number" || !Number.isFinite(offset) || offset < -96 || offset > 96) throw new Error("invalid offset");
        offsets[id] = offset;
      }
      setNodeOffsets(offsets);
    } catch { try { localStorage.removeItem(`clue-node-offsets:${detail.case.id}`); } catch { /* Storage may be unavailable. */ } setNodeOffsets({}); }
    let raw: string | null = null;
    try { raw = localStorage.getItem(`clue-view:${detail.case.id}`); } catch { /* Storage may be unavailable. */ }
    if (raw) try {
      const saved = JSON.parse(raw);
      if (saved.layoutVersion === VIEW_LAYOUT_VERSION) {
        setView(saved.view === "network" || saved.view === "table" ? saved.view : "path");
        setDepth(saved.depth === 2 ? 2 : 1);
      }
    } catch {
      // Ignore stale local view state.
    }

  }, [detail?.case.id]);

  useEffect(() => {
    if (!detail) return;
    try { localStorage.setItem(`clue-view:${detail.case.id}`, JSON.stringify({ layoutVersion: VIEW_LAYOUT_VERSION, view, depth })); } catch { /* Persistence must never interrupt React. */ }
  }, [detail?.case.id, view, depth]);
  useEffect(() => {
    if (!detail || dragging) return;
    const caseId = detail.case.id;
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(`clue-node-offsets:${caseId}`, JSON.stringify(nodeOffsets)); } catch { /* Persistence must never interrupt React. */ }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [detail?.case.id, nodeOffsets, dragging]);

  useEffect(() => {
    if (!filtersOpen) return;
    const close = (event: MouseEvent) => { if (!filterRef.current?.contains(event.target as Node)) setFiltersOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setFiltersOpen(false); };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("keydown", escape); };
  }, [filtersOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // React 的 wheel 监听器在 WebKit 中可能已是 passive，preventDefault 不会阻止容器滚动。
    // 这里显式注册 non-passive 原生监听器：滚轮只改视口，不会再同时触发原生滚动。
    const wheel = (event: globalThis.WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left + canvas.scrollLeft, y: event.clientY - rect.top + canvas.scrollTop };
      event.preventDefault();
      event.stopPropagation();
      setViewport((current) => {
        const currentZoom = finite(current.zoom, 1);
        const currentPan = { x: finite(current.pan.x), y: finite(current.pan.y) };
        const nextZoom = Math.max(0.55, Math.min(1.8, finite(currentZoom * Math.exp(-finite(event.deltaY) * 0.001), currentZoom)));
        if (nextZoom === currentZoom) return { zoom: currentZoom, pan: currentPan };
        const ratio = finite(nextZoom / currentZoom, 1);
        return {
          zoom: nextZoom,
          pan: {
            x: finite(anchor.x - (anchor.x - currentPan.x) * ratio),
            y: finite(anchor.y - (anchor.y - currentPan.y) * ratio),
          },
        };
      });
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [detail?.case.id]);

  useEffect(() => {
    const cancel = () => finishPointer();
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("blur", cancel); finishPointer(); };
  }, [detail?.case.id, view, query, kinds, onlyPinned, onlyUnverified]);

  useEffect(() => {
    if (nodeMenu && !detail?.entities.some((entity) => entity.id === nodeMenu.id)) setNodeMenu(null);
  }, [detail, nodeMenu]);

  function clearSelection() { window.getSelection?.()?.removeAllRanges(); }

  function down(event: PointerEvent) {
    // 只有按住左键才进入平移，右键只用于节点上下文菜单。
    if (event.button !== 0 || !detail || (event.target as Element).closest(".node-group,.edge-group")) return;
    event.preventDefault();
    clearSelection();
    const capture = event.currentTarget as HTMLElement;
    drag.current = { x: event.clientX, y: event.clientY, px: finite(pan.x), py: finite(pan.y), pointerId: event.pointerId, caseId: detail.case.id, capture };
    setDragging(true);
    try { capture.setPointerCapture(event.pointerId); } catch { finishPointer(); }
  }

  function move(event: PointerEvent) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId || current.caseId !== detail?.case.id) return;
    event.preventDefault();
    if (current.nodeId) {
      const nodeId = current.nodeId;
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 3) current.moved = true;
      const next = Math.max(-96, Math.min(96, finite(current.baseOffset) + finite(event.clientY - current.y)));
      setNodeOffsets((offsets) => ({ ...offsets, [nodeId]: Math.round(next / 12) * 12 }));
      return;
    }
    const nextPan = { x: finite(current.px + event.clientX - current.x), y: finite(current.py + event.clientY - current.y) };
    setViewport((viewport) => ({ ...viewport, pan: nextPan }));
  }

  function finishPointer() {
    const current = drag.current;
    drag.current = null;
    setDragging(false);
    if (!current) return;
    if (current.nodeId && current.moved) suppressNodeClick.current = current.nodeId;
    try { if (current.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId); } catch { /* Capture may already be lost. */ }
  }

  function nodeDown(event: PointerEvent, id: string) {
    // 普通点击永远用于选中。只在按住 Option/Alt 时启动受限排版微调，避免轻微抖动把点击变成拖动。
    if (event.button !== 0 || !event.altKey || !detail || !canvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    clearSelection();
    const capture = canvasRef.current;
    drag.current = { x: event.clientX, y: event.clientY, px: finite(pan.x), py: finite(pan.y), pointerId: event.pointerId, caseId: detail.case.id, capture, nodeId: id, baseOffset: finite(nodeOffsets[id]) };
    setDragging(true);
    try { capture.setPointerCapture(event.pointerId); } catch { finishPointer(); }
  }

  function switchView(next: View) {
    setView(next);
    setViewport({ zoom: 1, pan: { x: 0, y: 0 } });
  }

  function activateNode(id: string) {
    if (suppressNodeClick.current === id) { suppressNodeClick.current = null; return; }
    onSelect(id);
  }


  const focus = useMemo(() => {
    if (activeSelectedRelationId) {
      const relation = filtered.edges.find((item) => item.id === activeSelectedRelationId);
      return relation ? { entityIds: new Set([relation.sourceId, relation.targetId]), relationIds: new Set([relation.id]) } : { entityIds: new Set<string>(), relationIds: new Set<string>() };
    }
    if (!activeSelectedId) return { entityIds: new Set<string>(), relationIds: new Set<string>() };
    const incident = filtered.edges.filter((item) => item.sourceId === activeSelectedId || item.targetId === activeSelectedId);
    return { entityIds: new Set(incident.flatMap((item) => [item.sourceId, item.targetId])), relationIds: new Set(incident.map((item) => item.id)) };
  }, [filtered.edges, activeSelectedId, activeSelectedRelationId]);

  function toggleKind(kind: EntityKind) {
    setKinds((current) => {
      const next = new Set(current);
      next.has(kind) ? next.delete(kind) : next.add(kind);
      return next;
    });
  }

  function clearFilters() {
    setQuery("");
    setKinds(new Set());
    setOnlyPinned(false);
    setOnlyUnverified(false);
  }

  if (!detail) return <section className="graph-panel empty"><strong>选择案件开始查看关系</strong></section>;

  return <section className="graph-panel">
    <div className="graph-header">
      <nav aria-label="关系视图">
        {([ ["path", "调查路径"], ["network", "主体关系网"], ["table", "全量关系表"] ] as const).map(([id, label]) =>
          <button className={view === id ? "selected" : ""} onClick={() => switchView(id)} key={id}>{label}</button>,
        )}
      </nav>
      <div className="view-controls">
        <div className="filter-control" ref={filterRef}>
          <button className={`filter-button${filtersOpen || filtersActive ? " selected" : ""}`} onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} aria-controls="graph-filters">⌕ 筛选{filtersActive ? " · 已启用" : ""}</button>
          {filtersOpen && <div id="graph-filters" className="graph-filters" role="dialog" aria-label="图谱筛选">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对象、关系、属性或备注" autoFocus />
            <div className="filter-options">{entityKinds.map((kind) => <button key={kind} className={kinds.has(kind) ? "selected" : ""} onClick={() => toggleKind(kind)}>{kindLabel[kind]}</button>)}</div>
            <label><input type="checkbox" checked={onlyPinned} onChange={(event) => setOnlyPinned(event.target.checked)} />仅重点</label>
            <label><input type="checkbox" checked={onlyUnverified} onChange={(event) => setOnlyUnverified(event.target.checked)} />仅待核实</label>
            {filtersActive && <button className="clear-filters" onClick={clearFilters}>清除</button>}
          </div>}
        </div>
        {view === "network" && <button onClick={() => setDepth((value) => value === 1 ? 2 : 1)}>{depth === 1 ? "展开两跳" : "收起两跳"}</button>}
        {view !== "table" && expanded && <button onClick={() => setExpanded(false)}>收起大分支</button>}
        {view !== "table" && <>
          <button onClick={() => setViewport({ zoom: 1, pan: { x: 0, y: 0 } })}>阅读</button>
          <button onClick={() => setViewport({ zoom: 0.72, pan: { x: 0, y: 0 } })}>总览</button>
          <span>{Math.round(zoom * 100)}%</span>
        </>}
      </div>
    </div>


    {view === "table" ? <RelationTable detail={detail} relations={filtered.tableRelations} entityIds={filtered.entityIds} onSelect={onSelect} onRelation={onRelation} onEditRelation={onEditRelation} /> : <>
      <div className="graph-caption">
        {view === "path" ? "点击对象查看一跳高亮；点击关系查看该线及两端，双击关系可编辑。按住 ⌥ 再拖动节点可同层上下微调。" : "以当前对象为中心；点击对象或关系查看局部高亮，默认一跳，需要时展开两跳。"}
      </div>
      <div ref={canvasRef} className="graph-canvas" onPointerDown={(event) => { setNodeMenu(null); down(event); }} onPointerMove={move} onPointerUp={finishPointer} onPointerCancel={finishPointer} onLostPointerCapture={finishPointer}>
        <svg width={graph.width} height={graph.height} viewBox={`0 0 ${graph.width} ${graph.height}`} role="img" aria-label="案件关系图">
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            <defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5.5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" /></marker></defs>
            {view === "path" && <g className="path-rail"><text x="18" y="38">账号与关联条件主线</text><line x1="18" y1="52" x2={graph.width - 26} y2="52" />{[...graph.positions.values()].some((point) => point.disconnected) && <text x={graph.width - 222} y="38">未连接对象</text>}</g>}
            {(() => { const renderedLabels = new Set<string>(); return filtered.edges.map((relation) => {
              const source = graph.positions.get(relation.sourceId);
              const target = graph.positions.get(relation.targetId);
              if (!source || !target) return null;
              const active = focus.relationIds.has(relation.id);
              const contextEdge = Boolean(source.context || target.context);
              const virtualEdge = Boolean(relation.virtual);
              const forward = source.x <= target.x;
              // 附属卡固定从主卡底边连到附属卡顶边；常规关系才使用左右锚点。
              const x1 = contextEdge ? source.x : source.x + (forward ? 82 : -82);
              const y1 = contextEdge ? source.y + (source.context ? 13 : 31) : source.y;
              const x2 = contextEdge ? target.x : target.x + (forward ? -82 : 82);
              const y2 = contextEdge ? target.y - (target.context ? 13 : 31) : target.y;
              const childCount = filtered.edges.filter((edge) => edge.sourceId === relation.sourceId).length;
              const labelKey = `${relation.sourceId}:${relation.label}`;
              const firstLabelForBranch = !renderedLabels.has(labelKey);
              renderedLabels.add(labelKey);
              // 标签固定在线段中部，并按同源关系微移，避免压住节点或堆成一团。
              const labelOffset = (([...renderedLabels].filter((key) => key.startsWith(`${relation.sourceId}:`)).length - 1) % 3 - 1) * 12;
              const labelX = (x1 + x2) / 2;
              const labelY = (y1 + y2) / 2 + labelOffset;
              const showLabel = !virtualEdge && (active || relation.emphasis || childCount <= 3) && !contextEdge && (firstLabelForBranch || active || relation.emphasis);
              const label = relation.label.length > 16 ? `${relation.label.slice(0, 16)}…` : relation.label;
              const summary = relationSummary(relation);
              const labelWidth = Math.max(44, Math.max(label.length, summary.length) * 10);
              return <g key={relation.id} onClick={() => { if (!virtualEdge) onRelation(relation.id); }} onDoubleClick={() => { if (!virtualEdge) onEditRelation(relation.id); }} className={`edge-group${contextEdge ? " context-edge" : ""}${virtualEdge ? " virtual-edge" : ""}${relation.emphasis ? " emphasized-edge" : ""}${active ? " selected-edge" : ""}`}>
                <title>{relation.emphasis ? `重点关系 · ${relation.label}` : relation.label}</title>
                <line className="edge-line" x1={x1} y1={y1} x2={x2} y2={y2} markerEnd={contextEdge ? undefined : "url(#arrow)"} />
                {relation.emphasis && <line className="edge-emphasis-mark" x1={labelX - 7} y1={labelY - 4} x2={labelX + 7} y2={labelY - 4} />}
                {showLabel && <g className="edge-label" transform={`translate(${labelX} ${labelY})`}><rect x={-labelWidth / 2} y={summary ? -15 : -11} width={labelWidth} height={summary ? 28 : 18} rx="4" /><text textAnchor="middle" y={summary ? -2 : 2}>{label}</text>{summary && <text className="edge-summary" textAnchor="middle" y="10">{summary}</text>}</g>}
              </g>;
            }); })()}
            {graph.entities.filter((entity) => filtered.entityIds.has(entity.id)).map((entity) => {
              const point = graph.positions.get(entity.id);
              if (!point) return null;
              if (entity.virtual) { const aggregateName = entity.displayName.replace(/ \+\d+$/, ""); return <g key={entity.id} transform={`translate(${point.x - 82},${point.y - 31})`} className="node-group virtual-node" aria-label={`展开${entity.displayName}`} role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); setExpanded(true); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setExpanded(true); } }}>
                <rect className="node-surface" width="164" height="62" rx="8" />
                <text x="82" y="27" textAnchor="middle" className="virtual-node-label">{aggregateName}</text>
                <text x="82" y="48" textAnchor="middle" className="virtual-node-count">+{entity.hiddenCount}</text>
              </g>; }
              const active = entity.id === activeSelectedId;
              const linked = !active && focus.entityIds.has(entity.id);
              const rawLabel = entity.label || entity.id;
              const attributes = detail.entityAttributes.filter((item) => item.subjectId === entity.id);
              const presentation = entityDisplay(entity, attributes);
              const displayName = presentation.title;
              const classification = compactSvgText(entity.customType?.trim() || kindLabel[entity.kind], 52, 8.5, 7);
              const status = statusStyle(entity.status || "");
              const title = compactSvgText(presentation.title, 140, 13.5, 18);
              const secondary = compactSvgText(presentation.secondary, entity.pinned ? 106 : 140, 9, 18);
              const context = isContextKind(entity.kind);
              const dotColor = (entity.accent || "").trim() || kindColor[entity.kind];
              const nodeWidth = context ? 142 : 164;
              const nodeHeight = context ? 26 : 62;
              return <g key={entity.id} transform={`translate(${point.x - nodeWidth / 2},${point.y - nodeHeight / 2})`} onPointerDown={(event) => { if (!context) nodeDown(event, entity.id); }} onClick={() => activateNode(entity.id)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onSelect(entity.id); setNodeMenu({ id: entity.id, x: event.clientX, y: event.clientY }); }} className={`node-group${context ? " context-node" : ""}${entity.pinned ? " pinned-node" : ""}${active ? " selected-node" : ""}${linked ? " linked-node" : ""}`}>
                <title>{[displayName, classification, rawLabel !== displayName ? rawLabel : "", entity.role?.trim(), entity.pinned ? "重点对象" : "", status.marker, ...presentation.keyAttributes.map((item) => `${attributeLabel(item.fieldKey)}：${attributeValue(item)}`)].filter(Boolean).join(" · ")}</title>
                <rect className={`node-surface${active ? " node-surface-selected" : linked ? " node-surface-linked" : ""}`} width={nodeWidth} height={nodeHeight} rx={context ? 13 : 8} />
                {context ? <><circle className="node-type-dot" cx="12" cy="13" r="3.5" fill={dotColor} /><text x="21" y="16" className="context-value">{compactSvgText(contextDisplayLabel(entity), 108, 10, 16)}</text></> : <>{entity.kind === "ip" ? <g className="entity-ip-badge"><rect x="9" y="4" width="31" height="15" rx="7.5"/><text x="24.5" y="14.5" textAnchor="middle">IP</text></g> : <><circle className="node-type-dot" cx="15.5" cy="11" r="3.5" fill={dotColor} /><text x="23" y="14" className="entity-type-line">{classification}</text></>}{status.marker && <text x="152" y="14" textAnchor="end" className={`entity-status status-${status.tone}`}><tspan className="entity-status-dot">●</tspan><tspan dx="3">{status.marker}</tspan></text>}<text x="12" y="35" className="entity-display-name">{title}</text>{secondary && <text x="12" y="54" className="entity-secondary">{secondary}</text>}{entity.pinned && <><g className="node-priority-mark"><circle cx="151" cy="30" r="5" /><text x="151" y="32.5" textAnchor="middle">◆</text></g><text x="152" y="54" textAnchor="end" className="entity-priority-text">重点</text></>}</>}
              </g>;
            })}
          </g>
        </svg>
      </div>
      <footer className="graph-footer"><span>{graph.entities.filter((entity) => !entity.virtual && filtered.entityIds.has(entity.id)).length} 个可见对象 · {filtered.edges.filter((edge) => !edge.virtual).length} 条可见关系</span>{graph.hidden > 0 && <span>已聚合 {graph.hidden} 个叶子对象</span>}</footer>
      {nodeMenu && <div className="node-context-menu" style={{ left: nodeMenu.x, top: nodeMenu.y }}><button onClick={() => { onEditNode(nodeMenu.id); setNodeMenu(null); }}>编辑对象</button><button onClick={() => { onAddFromNode(nodeMenu.id); setNodeMenu(null); }}>从此对象添加线索</button>{nodeMenu.id !== detail.rootId && <button className="danger" onClick={() => { onDeleteNode(nodeMenu.id); setNodeMenu(null); }}>删除对象</button>}</div>}
    </>}
  </section>;
});

function matchingGraphEntityIds(detail: CaseDetail | undefined, query: string, kinds: Set<EntityKind>, onlyPinned: boolean, onlyUnverified: boolean) {
  const term = query.trim().toLocaleLowerCase();
  const matching = new Set<string>();
  for (const entity of detail?.entities || []) {
    const attributes = detail?.entityAttributes.filter((item) => item.subjectId === entity.id) || [];
    const textMatches = !term || [entity.label, entity.displayName, kindLabel[entity.kind], entity.customType, entity.note, entity.role, entity.status, ...attributes.flatMap((item) => [attributeLabel(item.fieldKey), attributeValue(item)])].some((value) => (value || "").toLocaleLowerCase().includes(term));
    if (textMatches && (!kinds.size || kinds.has(entity.kind)) && (!onlyPinned || entity.pinned) && (!onlyUnverified || entity.status === "待核实")) matching.add(entity.id);
  }
  if (term) for (const relation of detail?.relations || []) {
    const attributes = detail?.relationAttributes.filter((item) => item.subjectId === relation.id) || [];
    if ([relation.label, relation.note, relation.spread, ...attributes.flatMap((item) => [attributeLabel(item.fieldKey), attributeValue(item)])].some((value) => value.toLocaleLowerCase().includes(term))) {
      matching.add(relation.sourceId);
      matching.add(relation.targetId);
    }
  }
  return matching;
}

function filterGraph(detail: CaseDetail | undefined, graph: Projection, query: string, kinds: Set<EntityKind>, onlyPinned: boolean, onlyUnverified: boolean) {
  const term = query.trim().toLocaleLowerCase();
  if (!term && !kinds.size && !onlyPinned && !onlyUnverified) return {
    edges: graph.edges,
    entityIds: new Set(graph.entities.map((entity) => entity.id)),
    relationIds: new Set(graph.edges.filter((edge) => !edge.virtual).map((edge) => edge.id)),
    tableRelations: detail?.relations || [],
  };
  const entityMatches = (entity: EntityRecord) => {
    const attributes = detail?.entityAttributes.filter((item) => item.subjectId === entity.id) || [];
    const textMatches = !term || [entity.label, entity.displayName, kindLabel[entity.kind], entity.customType, entity.note, entity.role, entity.status, ...attributes.flatMap((item) => [attributeLabel(item.fieldKey), attributeValue(item)])].some((value) => (value || "").toLocaleLowerCase().includes(term));
    return textMatches && (!kinds.size || kinds.has(entity.kind)) && (!onlyPinned || entity.pinned) && (!onlyUnverified || entity.status === "待核实");
  };
  const relationMatches = (relation: RelationRecord) => {
    const attributes = detail?.relationAttributes.filter((item) => item.subjectId === relation.id) || [];
    return Boolean(term) && [relation.label, relation.note, relation.spread, ...attributes.flatMap((item) => [attributeLabel(item.fieldKey), attributeValue(item)])].some((value) => value.toLocaleLowerCase().includes(term));
  };
  const entities = detail?.entities || [];
  const matchingEntities = new Set(entities.filter(entityMatches).map((entity) => entity.id));
  const tableRelations = (detail?.relations || []).filter((relation) => relationMatches(relation) || matchingEntities.has(relation.sourceId) || matchingEntities.has(relation.targetId));
  const relationIds = new Set(tableRelations.map((relation) => relation.id));
  for (const relation of tableRelations) {
    matchingEntities.add(relation.sourceId);
    matchingEntities.add(relation.targetId);
  }
  const visibleGraphIds = new Set(graph.entities.filter((entity) => matchingEntities.has(entity.id)).map((entity) => entity.id));
  const edges = graph.edges.filter((relation) => visibleGraphIds.has(relation.sourceId) && visibleGraphIds.has(relation.targetId) && relationIds.has(relation.id));
  const entityIds = new Set<string>();
  for (const relation of edges) {
    entityIds.add(relation.sourceId);
    entityIds.add(relation.targetId);
  }
  for (const entity of graph.entities) if (matchingEntities.has(entity.id)) entityIds.add(entity.id);
  return { edges, entityIds, relationIds, tableRelations };
}

function isContextKind(kind: EntityRecord["kind"]) {
  return kind === "location" || kind === "datacenter";
}

function statusStyle(status: string) {
  if (status === "已失效") return { marker: "已失效", tone: "muted" };
  if (status === "已排除") return { marker: "已排除", tone: "excluded" };
  if (status === "待核实") return { marker: "待核实", tone: "pending" };
  return { marker: status.trim(), tone: "active" };
}

function compactText(value: string, maxLength: number) {
  const text = value.trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function edgeShortSummary(relation: RelationRecord, attributes: CaseDetail["relationAttributes"]) {
  if (!relation.label.includes("同机")) return "";
  const similarity = attributes.find((item) => item.subjectId === relation.id && item.fieldKey === "similarity");
  if (!similarity) return "";
  const raw = attributeValue(similarity).trim();
  if (!raw) return "";
  if (raw.endsWith("%")) return raw;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return "";
  return `${numeric <= 1 ? Math.round(numeric * 100) : Math.round(numeric)}%`;
}

function compactSvgText(value: string, maxWidth: number, fontSize: number, maxChars: number) {
  const text = value.trim();
  if (!text) return "";
  let width = 0;
  let result = "";
  for (const character of text) {
    const unit = /[\u2e80-\u9fff\uff00-\uffef]/u.test(character) ? 1 : /[A-Z0-9]/.test(character) ? .68 : .55;
    if (result.length >= maxChars || width + unit * fontSize > maxWidth - fontSize) return `${result}…`;
    result += character;
    width += unit * fontSize;
  }
  return result;
}

function RelationTable({ detail, relations, entityIds, onSelect, onRelation, onEditRelation }: { detail: CaseDetail; relations: RelationRecord[]; entityIds: Set<string>; onSelect(id: string): void; onRelation(id: string): void; onEditRelation(id: string): void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const entityMap = new Map(detail.entities.map((entity) => [entity.id, entity]));
  const entityLabel = (entity: EntityRecord | undefined) => entity ? <span className={`table-entity${entity.pinned ? " table-entity-priority" : ""}`} style={entity.accent ? { "--entity-accent": entity.accent } as CSSProperties : undefined}>{entity.pinned && <i aria-label="重点对象">◆</i>}{entity.displayName ? `${entity.displayName} · ${entity.label}` : entity.label}</span> : "未知";
  return <div className="relation-table"><table><thead><tr><th>当前对象</th><th>关系 / 推导</th><th>关联对象</th><th>状态</th></tr></thead><tbody>
    {relations.map((relation) => {
      const source = entityMap.get(relation.sourceId);
      const target = entityMap.get(relation.targetId);
      const attributes = detail.relationAttributes.filter((item) => item.subjectId === relation.id && attributeValue(item).trim());
      const isExpanded = expanded.has(relation.id);
      const visibleAttributes = isExpanded ? attributes : attributes.slice(0, 2);
      return <tr key={relation.id} className={relation.emphasis ? "emphasized-relation" : ""} onClick={() => onRelation(relation.id)} onDoubleClick={() => onEditRelation(relation.id)}><td><button onClick={(event) => { event.stopPropagation(); source && entityIds.has(source.id) && onSelect(source.id); }}>{entityLabel(source)}</button></td><td><button className="relation-name-button" onClick={() => onRelation(relation.id)} onDoubleClick={() => onEditRelation(relation.id)}><strong>{relation.emphasis && <span className="table-priority-badge">重点</span>}{relation.label}</strong></button><small>{relation.spread}{relation.note ? ` · ${relation.note}` : ""}</small>{attributes.length > 0 && <small className="relation-attributes">{visibleAttributes.map((item) => `${attributeLabel(item.fieldKey)}：${attributeValue(item)}`).join(" · ")}{attributes.length > 2 && <button onClick={(event) => { event.stopPropagation(); setExpanded((current) => { const next = new Set(current); if (next.has(relation.id)) next.delete(relation.id); else next.add(relation.id); return next; }); }}>{isExpanded ? "收起" : `查看全部 · +${attributes.length - 2}`}</button>}</small>}</td><td><button onClick={(event) => { event.stopPropagation(); target && entityIds.has(target.id) && onSelect(target.id); }} onDoubleClick={(event) => event.stopPropagation()}>{entityLabel(target)}</button></td><td>{relation.status}</td></tr>;
    })}
  </tbody></table></div>;
}

function finite(value: number | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function graphLevels(rootId: string, entities: RenderEntity[], edges: RenderRelation[], undirected = false) {
  const entityIds = new Set(entities.map((entity) => entity.id));
  const outgoing = new Map<string, string[]>();
  const weak = new Map<string, string[]>();
  for (const id of entityIds) { outgoing.set(id, []); weak.set(id, []); }
  for (const edge of edges) {
    if (!entityIds.has(edge.sourceId) || !entityIds.has(edge.targetId)) continue;
    outgoing.get(edge.sourceId)!.push(edge.targetId);
    weak.get(edge.sourceId)!.push(edge.targetId);
    weak.get(edge.targetId)!.push(edge.sourceId);
    if (undirected) outgoing.get(edge.targetId)!.push(edge.sourceId);
  }
  const levels = new Map<string, number>();
  const assign = (roots: string[], baseLayer: number, allowed?: Set<string>) => {
    const queue = [...roots];
    roots.forEach((id) => levels.set(id, baseLayer));
    while (queue.length) {
      const id = queue.shift()!;
      for (const next of outgoing.get(id) || []) if ((!allowed || allowed.has(next)) && !levels.has(next)) {
        levels.set(next, levels.get(id)! + 1);
        queue.push(next);
      }
    }
  };
  if (entityIds.has(rootId)) assign([rootId], 0);
  const disconnected = new Set([...entityIds].filter((id) => !levels.has(id)));
  if (undirected) {
    const layer = Math.max(0, ...levels.values()) + 1;
    disconnected.forEach((id) => levels.set(id, layer));
    return { levels, disconnected };
  }

  const branchLayer = Math.max(0, ...levels.values()) + 1;
  const remaining = new Set(disconnected);
  while (remaining.size) {
    const seed = remaining.values().next().value as string;
    const component = new Set<string>([seed]);
    const queue = [seed];
    remaining.delete(seed);
    while (queue.length) {
      for (const next of weak.get(queue.shift()!) || []) if (remaining.has(next)) {
        remaining.delete(next);
        component.add(next);
        queue.push(next);
      }
    }
    const indegree = new Map([...component].map((id) => [id, 0]));
    for (const edge of edges) if (component.has(edge.sourceId) && component.has(edge.targetId)) indegree.set(edge.targetId, indegree.get(edge.targetId)! + 1);
    const roots = [...component].filter((id) => indegree.get(id) === 0);
    assign(roots.length ? roots : [seed], branchLayer, component);
    for (const id of component) if (!levels.has(id)) levels.set(id, branchLayer);
  }
  return { levels, disconnected };
}

function aggregateKey(sourceId: string, relationLabel: string, kind: EntityKind) {
  return encodeURIComponent(JSON.stringify([sourceId, relationLabel, kind]));
}

function virtualEntity(caseId: string, key: string, kind: EntityKind, hiddenCount: number): RenderEntity {
  const label = `其余${kindLabel[kind]} +${hiddenCount}`;
  return { id: `__aggregate__:${caseId}:${key}`, caseId, kind, label, displayName: label, status: "", role: "", note: "", accent: "", pinned: false, virtual: true, hiddenCount };
}

function virtualEdge(caseId: string, key: string, sourceId: string, targetId: string): RenderRelation {
  return { id: `__aggregate_edge__:${caseId}:${key}`, caseId, sourceId, targetId, label: "聚合", spread: "", status: "", note: "", emphasis: false, virtual: true };
}

export function project(detail: CaseDetail | undefined, mode: View, selected: string | undefined, depth: number, expanded: boolean, nodeOffsets: Record<string, number>, filterMatchingIds: Set<string>): Projection {
  if (!detail) return { entities: [], edges: [], positions: new Map(), hidden: 0, width: 1200, height: 720, maxLayer: 0, contextStart: 0 };
  const contextEntities = detail.entities.filter((entity) => isContextKind(entity.kind));
  const contextIds = new Set(contextEntities.map((entity) => entity.id));
  const regularEntities = detail.entities.filter((entity) => !contextIds.has(entity.id));
  const regularIds = new Set(regularEntities.map((entity) => entity.id));
  const allEdges: RenderRelation[] = detail.relations.map((relation) => ({ ...relation, cross: false }));
  const regularEdges = allEdges.filter((edge) => regularIds.has(edge.sourceId) && regularIds.has(edge.targetId));
  const contextParentEdges = new Map<string, RenderRelation>();
  for (const edge of allEdges) if (contextIds.has(edge.targetId) && !contextParentEdges.has(edge.targetId)) contextParentEdges.set(edge.targetId, edge);

  let entities: RenderEntity[] = regularEntities;
  let sourceEdges = regularEdges;
  const levelRoot = detail.rootId;
  if (mode === "network") {
    const { levels } = graphLevels(levelRoot, entities, sourceEdges, true);
    const maxDepth = depth === 2 ? 2 : 1;
    const ids = new Set([...levels].filter(([, layer]) => layer <= maxDepth).map(([id]) => id));
    filterMatchingIds.forEach((id) => { if (regularIds.has(id)) ids.add(id); });
    entities = regularEntities.filter((entity) => ids.has(entity.id));
    sourceEdges = regularEdges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId));
  }

  const { levels, disconnected } = graphLevels(levelRoot, entities, sourceEdges, mode === "network");
  const outgoing = new Set(sourceEdges.map((edge) => edge.sourceId));
  const incoming = new Map<string, RenderRelation[]>();
  sourceEdges.forEach((edge) => incoming.set(edge.targetId, [...(incoming.get(edge.targetId) || []), edge]));
  const groups = new Map<string, { sourceId: string; relationLabel: string; kind: EntityKind; items: RenderEntity[] }>();
  for (const item of entities) {
    const edges = incoming.get(item.id) || [];
    if (outgoing.has(item.id) || edges.length !== 1) continue;
    const edge = edges[0];
    const key = aggregateKey(edge.sourceId, edge.label, item.kind);
    const group = groups.get(key) || { sourceId: edge.sourceId, relationLabel: edge.label, kind: item.kind, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const visible: RenderEntity[] = [...entities];
  const proxies: RenderRelation[] = [];
  const hiddenIds = new Set<string>();
  const proxyDisconnected = new Set<string>();
  if (!expanded) for (const [key, group] of groups) {
    if (group.items.length <= COLLAPSE_THRESHOLD) continue;
    const retainedLeafIds = new Set(group.items.slice(0, 3).map((item) => item.id));
    filterMatchingIds.forEach((id) => retainedLeafIds.add(id));
    const hidden = group.items.filter((item) => !retainedLeafIds.has(item.id));
    hidden.forEach((item) => hiddenIds.add(item.id));
    if (!hidden.length) continue;
    const proxy = virtualEntity(detail.case.id, key, group.kind, hidden.length);
    levels.set(proxy.id, levels.get(hidden[0].id) || 0);
    if (hidden.some((item) => disconnected.has(item.id))) proxyDisconnected.add(proxy.id);
    visible.push(proxy);
    proxies.push(virtualEdge(detail.case.id, key, group.sourceId, proxy.id));
  }
  const renderedRegular = visible.filter((entity) => !hiddenIds.has(entity.id));
  const visibleRegularIds = new Set(renderedRegular.map((entity) => entity.id));
  const attachedContexts = contextEntities.filter((entity) => {
    const parent = contextParentEdges.get(entity.id);
    return parent ? visibleRegularIds.has(parent.sourceId) : mode === "path";
  });
  const contextsByParent = new Map<string, RenderEntity[]>();
  for (const context of attachedContexts) {
    const parentId = contextParentEdges.get(context.id)?.sourceId;
    if (parentId) contextsByParent.set(parentId, [...(contextsByParent.get(parentId) || []), context]);
  }
  const positions = layout(renderedRegular, levels, nodeOffsets, new Set([...disconnected, ...proxyDisconnected]), contextsByParent);
  let fallbackY = Math.max(100, ...[...positions.values()].map((point) => point.y)) + 90;
  let contextStart = 0;
  for (const context of attachedContexts) {
    const parentId = contextParentEdges.get(context.id)?.sourceId;
    const parent = parentId ? positions.get(parentId) : undefined;
    const siblings = parentId ? contextsByParent.get(parentId) || [] : [];
    const index = siblings.findIndex((item) => item.id === context.id);
    const point: Point = parent
      ? { x: parent.x, y: parent.y + 54 + index * 32, layer: parent.layer, context: true, sourceId: parentId }
      : { x: 110, y: fallbackY, layer: 0, context: true };
    if (!parent) fallbackY += 32;
    if (!contextStart || point.y < contextStart) contextStart = point.y;
    positions.set(context.id, point);
  }
  const renderedEntities = [...renderedRegular, ...attachedContexts];
  const visibleIds = new Set(renderedEntities.map((entity) => entity.id));
  const contextEdges = [...contextParentEdges.values()].filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId));
  const edges = sourceEdges.filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId)).concat(proxies, contextEdges);
  const points = [...positions.values()];
  const maxLayer = Math.max(0, ...points.map((point) => point.layer));
  return {
    entities: renderedEntities,
    edges,
    positions,
    hidden: hiddenIds.size,
    width: Math.max(1040, ...points.map((point) => point.x + 110)),
    height: Math.max(300, ...points.map((point) => point.y + (point.context ? 41 : 72))),
    maxLayer,
    contextStart,
  };
}

function layout(entities: RenderEntity[], levels: Map<string, number>, nodeOffsets: Record<string, number>, disconnected: Set<string>, contextsByParent: Map<string, RenderEntity[]>) {
  const points = new Map<string, Point>();
  const nextY = new Map<number, number>();
  for (const entity of entities) {
    const layer = levels.get(entity.id) ?? 0;
    const y = nextY.get(layer) || 100;
    const contextCount = contextsByParent.get(entity.id)?.length || 0;
    nextY.set(layer, y + 90 + contextCount * 32);
    points.set(entity.id, { x: 110 + layer * 250, y: y + (entity.virtual ? 0 : finite(nodeOffsets[entity.id])), layer, disconnected: disconnected.has(entity.id) });
  }
  return points;
}
