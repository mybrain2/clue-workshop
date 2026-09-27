import type { AttributeRecord, EntityKind, EntityRecord } from "./types";
import { structuredFieldLabels } from "./structured-fields";

export const entityKinds: EntityKind[] = ["wechat", "qq", "phone", "ip", "location", "datacenter", "device", "group", "platform", "organization", "subject", "custom"];

export const attributeLabels = structuredFieldLabels;

type EntityPresentation = { titleKeys: string[]; secondaryKeys: string[]; keyAttributeKeys: string[] };

export const entityPresentation: Record<EntityKind, EntityPresentation> = {
  wechat: { titleKeys: ["nickname"], secondaryKeys: ["account_status"], keyAttributeKeys: ["nickname", "account_status"] },
  qq: { titleKeys: ["nickname"], secondaryKeys: ["account_status", "registration"], keyAttributeKeys: ["account_status", "registration"] },
  phone: { titleKeys: [], secondaryKeys: ["phone_type", "registration"], keyAttributeKeys: ["phone_type", "registration"] },
  ip: { titleKeys: [], secondaryKeys: ["registration", "risk_status"], keyAttributeKeys: ["registration", "risk_status"] },
  location: { titleKeys: [], secondaryKeys: ["description"], keyAttributeKeys: ["description"] },
  datacenter: { titleKeys: [], secondaryKeys: ["registration", "description"], keyAttributeKeys: ["registration", "description"] },
  device: { titleKeys: ["model"], secondaryKeys: ["device_id", "device_signal"], keyAttributeKeys: ["device_id", "device_signal"] },
  group: { titleKeys: ["group_name"], secondaryKeys: ["member_count", "last_message_at"], keyAttributeKeys: ["member_count", "last_message_at"] },
  platform: { titleKeys: ["nickname"], secondaryKeys: ["account_status", "platform"], keyAttributeKeys: ["nickname", "account_status"] },
  organization: { titleKeys: ["organization_name"], secondaryKeys: ["description"], keyAttributeKeys: ["organization_name", "description"] },
  subject: { titleKeys: ["title"], secondaryKeys: ["description"], keyAttributeKeys: ["description"] },
  custom: { titleKeys: ["title", "nickname"], secondaryKeys: ["description"], keyAttributeKeys: ["description"] },
};

export function attributeLabel(fieldKey: string) { return attributeLabels[fieldKey] || fieldKey.replaceAll("_", " "); }

export function attributeValue(attribute: Pick<AttributeRecord, "valueType" | "valueText" | "valueNumber" | "valueTime">) {
  if (attribute.valueType === "number" && attribute.valueNumber != null) return new Intl.NumberFormat("zh-CN").format(attribute.valueNumber);
  if (attribute.valueType === "datetime" && attribute.valueTime) return attribute.valueTime;
  return attribute.valueText;
}

export function entityDisplay(entity: EntityRecord, attributes: AttributeRecord[]) {
  const values = new Map(attributes.filter((item) => item.subjectId === entity.id && attributeValue(item).trim()).map((item) => [item.fieldKey, attributeValue(item)]));
  const config = entityPresentation[entity.kind];
  const preferred = config.titleKeys.map((key) => values.get(key)).find(Boolean) || "";
  const title = entity.displayName?.trim() || preferred || entity.label || entity.id;
  const secondaryValues = config.secondaryKeys.map((key) => values.get(key)).filter((value): value is string => Boolean(value));
  const mustShowRawIdentifier = (["wechat", "qq", "platform", "group"] as EntityKind[]).includes(entity.kind) && entity.label !== title;
  const secondary = mustShowRawIdentifier
    ? [entity.label, secondaryValues[0]].filter(Boolean).join(" · ")
    : secondaryValues.slice(0, 2).join(" · ") || (entity.label !== title ? entity.label : entity.role?.trim() || "");
  const keyAttributes = config.keyAttributeKeys.map((key) => attributes.find((item) => item.subjectId === entity.id && item.fieldKey === key && attributeValue(item).trim())).filter((item): item is AttributeRecord => Boolean(item)).slice(0, 2);
  return { title, secondary, keyAttributes };
}
