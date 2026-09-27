import { useEffect, useState } from "react";
import type { EntityKind, EntityRecord } from "../../lib/types";

const STORAGE_KEY = "clue-workbench.quick-entry-labels.v3";
const LEGACY_STORAGE_KEY = "clue-workbench.quick-entry-labels.v1";
const kinds: Array<[Exclude<EntityKind, "subject">, string]> = [["wechat", "微信"], ["qq", "QQ"], ["phone", "手机号"], ["ip", "IP"], ["location", "位置"], ["datacenter", "机房"], ["device", "设备"], ["group", "群聊"], ["platform", "平台账号"], ["organization", "个人/团伙"], ["custom", "自定义关联"]];
const entries: Array<{ slot: Exclude<EntityKind, "subject">; kind: Exclude<EntityKind, "subject">; title: string; subtitle: string; relationLabel?: string; spread?: string }> = [
  { slot: "wechat", kind: "wechat", title: "添加微信号", subtitle: "微信号 · 账号链扩展" },
  { slot: "qq", kind: "qq", title: "添加QQ号", subtitle: "QQ号 · 账号链扩展" },
  { slot: "phone", kind: "phone", title: "添加手机号", subtitle: "手机号 · 跨平台映射" },
  { slot: "ip", kind: "ip", title: "添加IP", subtitle: "IP · 同IP扩散" },
  { slot: "location", kind: "location", title: "添加活跃位置", subtitle: "活跃位置 · 人工关联" },
  { slot: "datacenter", kind: "datacenter", title: "添加机房信息", subtitle: "机房信息 · 同IP扩散" },
  { slot: "device", kind: "qq", title: "添加同机QQ", subtitle: "QQ号 · 同机关系", relationLabel: "同机", spread: "同机扩散" },
  { slot: "group", kind: "group", title: "添加群聊", subtitle: "群聊 · 群聊扩散" },
  { slot: "platform", kind: "platform", title: "添加平台账号", subtitle: "平台账号 · 跨平台映射" },
  { slot: "organization", kind: "organization", title: "添加个人/团伙", subtitle: "账号归集 · 标注节点", relationLabel: "归属", spread: "人工关联" },
  { slot: "custom", kind: "custom", title: "自定义关联", subtitle: "其他类型与关系" },
];

type QuickEntryKind = Exclude<EntityKind, "subject">;
export type QuickEntryPreset = { kind: QuickEntryKind; relationLabel?: string; spread?: string };
type QuickEntryConfig = QuickEntryPreset & { title: string; subtitle: string };
type Config = Record<QuickEntryKind, QuickEntryConfig>;
type LegacyCopy = Record<QuickEntryKind, { title: string; subtitle: string }>;
export const quickEntryDefaults = Object.fromEntries(entries.map((entry) => [entry.slot, { kind: entry.kind, title: entry.title, subtitle: entry.subtitle, relationLabel: entry.relationLabel, spread: entry.spread }])) as Config;
const defaults = quickEntryDefaults;
export const defaultQuickEntryCopyFor = (kind: QuickEntryKind) => {
  const entry = entries.find((item) => item.kind === kind)!;
  return { title: entry.title, subtitle: entry.subtitle };
};
export const syncQuickEntryKind = (current: QuickEntryConfig, kind: QuickEntryKind): QuickEntryConfig => {
  const previousDefaults = defaultQuickEntryCopyFor(current.kind);
  const nextDefaults = defaultQuickEntryCopyFor(kind);
  return {
    kind,
    relationLabel: undefined,
    spread: undefined,
    title: current.title === previousDefaults.title ? nextDefaults.title : current.title,
    subtitle: current.subtitle === previousDefaults.subtitle ? nextDefaults.subtitle : current.subtitle,
  };
};
const isQuickEntryKind = (kind: unknown): kind is QuickEntryKind => kinds.some(([value]) => value === kind);

function readConfig(): Config {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<Config> | null;
    if (saved) return Object.fromEntries(entries.map((entry) => {
      const value = saved[entry.slot];
      return [entry.slot, { ...defaults[entry.slot], ...value, kind: isQuickEntryKind(value?.kind) ? value.kind : defaults[entry.slot].kind }];
    })) as Config;
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null") as Partial<LegacyCopy> | null;
    if (legacy) {
      const migrated = Object.fromEntries(entries.map((entry) => [entry.slot, { ...defaults[entry.slot], ...legacy[entry.slot], kind: entry.kind }])) as Config;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch { /* 使用默认配置 */ }
  return defaults;
}

export function QuickEntryPanel({ selected, onOpen, onImport }: { selected?: EntityRecord; onOpen(preset: QuickEntryPreset): void; onImport(): void }) {
  const [config, setConfig] = useState<Config>(defaults);
  const [editing, setEditing] = useState(false);
  useEffect(() => setConfig(readConfig()), []);
  function save(next: Config) { setConfig(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
  function reset() { setConfig(defaults); localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_STORAGE_KEY); }
  return <section className="action-panel">
    <div className="quick-entry-heading"><div><span className="eyebrow">直接录入</span><h2>添加关联线索</h2></div><button className="edit-quick-labels" type="button" onClick={() => setEditing(true)} aria-label="编辑快捷按钮">编辑快捷项</button></div>
    <p>{selected ? `当前对象：${selected.displayName || selected.label}` : "先在图中选择一个对象，即可直接录入"}</p>
    <div className="quick-entry-grid">{entries.map((entry) => <button key={entry.slot} className={entry.slot === "custom" ? "more-entry" : ""} onClick={() => onOpen(config[entry.slot])} disabled={!selected}><strong>＋ {config[entry.slot].title}</strong><small>{config[entry.slot].subtitle}</small></button>)}</div>
    <button className="bulk-entry" onClick={onImport} disabled={!selected}><strong>＋ 批量导入</strong><small>Excel、CSV、表格粘贴</small></button>
    {editing && <div className="modal-backdrop" onClick={() => setEditing(false)}><div className="dialog quick-label-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-label-title" onClick={(event) => event.stopPropagation()}>
      <header><div><h2 id="quick-label-title">编辑快捷项</h2><p>选择对象类型会影响快捷按钮打开时实际新增的对象；默认关系标签和扩散方式会随类型预置，标题可单独保留。</p></div><button type="button" onClick={() => setEditing(false)} aria-label="关闭编辑快捷项对话框">×</button></header>
      <div className="quick-label-list">{entries.map((entry) => <div className="quick-label-row" key={entry.slot}><label>新增对象类型<select aria-label={`${entry.title}新增对象类型`} value={config[entry.slot].kind} onChange={(event) => { const kind = event.target.value as QuickEntryKind; setConfig((current) => ({ ...current, [entry.slot]: syncQuickEntryKind(current[entry.slot], kind) })); }}>{kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{entry.title}主标题<input aria-label={`${entry.title}主标题`} value={config[entry.slot].title} onChange={(event) => setConfig((current) => ({ ...current, [entry.slot]: { ...current[entry.slot], title: event.target.value } }))} /></label><label>副标题<input aria-label={`${entry.title}副标题`} value={config[entry.slot].subtitle} onChange={(event) => setConfig((current) => ({ ...current, [entry.slot]: { ...current[entry.slot], subtitle: event.target.value } }))} /></label></div>)}</div>
      <footer><button type="button" onClick={reset}>恢复默认</button><button type="button" onClick={() => { const next = Object.fromEntries(entries.map((entry) => [entry.slot, { ...config[entry.slot], title: config[entry.slot].title.trim() || defaults[entry.slot].title, subtitle: config[entry.slot].subtitle.trim() || defaults[entry.slot].subtitle }])); save(next as Config); setEditing(false); }} className="primary">保存快捷项</button></footer>
    </div></div>}
  </section>;
}
