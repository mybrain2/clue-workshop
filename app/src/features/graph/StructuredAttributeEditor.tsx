import { useEffect, useState } from "react";
import type { AttributeRecord, AttributeValueType } from "../../lib/types";
import { attributeLabel } from "../../lib/entity-presentation";

type Draft = AttributeRecord & { draftValue: string };

export function StructuredAttributeEditor({ attributes, onSave, onDelete }: { attributes: AttributeRecord[]; onSave(attribute: AttributeRecord): Promise<void>; onDelete(attribute: AttributeRecord): Promise<void> }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState("");
  useEffect(() => setDrafts(attributes.map((item) => ({ ...item, draftValue: inputValue(item) }))), [attributes]);
  if (!drafts.length) return <details className="advanced-details"><summary>结构化属性</summary><p>暂无结构化属性</p></details>;
  const update = (id: string, draftValue: string) => setDrafts((items) => items.map((item) => item.id === id ? { ...item, draftValue } : item));
  const save = async (draft: Draft) => {
    setBusy(draft.id);
    try { await onSave(toAttribute(draft)); } finally { setBusy(""); }
  };
  const remove = async (draft: Draft) => {
    setBusy(draft.id);
    try { await onDelete(draft); } finally { setBusy(""); }
  };
  return <details className="advanced-details structured-attribute-editor"><summary>结构化属性（{drafts.length}）</summary>{drafts.map((draft) => <div className="attribute-edit-row" key={draft.id}><label><span>{attributeLabel(draft.fieldKey)}</span>{attributeInput(draft, (value) => update(draft.id, value))}</label><div><button type="button" disabled={Boolean(busy)} onClick={() => void save(draft)}>保存</button><button type="button" className="danger" disabled={Boolean(busy)} onClick={() => void remove(draft)}>删除</button></div></div>)}</details>;
}

function inputValue(attribute: AttributeRecord) {
  if (attribute.valueType === "number") return attribute.valueNumber == null ? attribute.valueText : String(attribute.valueNumber);
  if (attribute.valueType === "datetime") return attribute.valueTime || attribute.valueText;
  return attribute.valueText;
}

function attributeInput(attribute: Draft, onChange: (value: string) => void) {
  const common = { value: attribute.draftValue, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value) };
  if (attribute.valueType === "number") return <input type="number" step="any" {...common} />;
  if (attribute.valueType === "datetime") return <input type="datetime-local" {...common} />;
  if (attribute.valueType === "list") return <textarea rows={2} {...common} />;
  return <input type="text" {...common} />;
}

function toAttribute(draft: Draft): AttributeRecord {
  const valueType: AttributeValueType = draft.valueType;
  return { ...draft, valueText: draft.draftValue, valueNumber: valueType === "number" && draft.draftValue.trim() ? Number(draft.draftValue) : null, valueTime: valueType === "datetime" ? draft.draftValue || null : null };
}
