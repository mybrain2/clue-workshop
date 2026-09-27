import type { EntityKind } from "../../lib/types";

export const SPREAD_OPTIONS = ["账号链扩展", "跨平台映射", "同 IP 扩散", "同机扩散", "群聊扩散", "智能导入", "人工关联"] as const;

export const RELATION_PRESETS = ["关联", "归属", "好友", "加入群", "群成员", "同机", "绑定手机号", "登录IP", "使用设备", "自定义"] as const;

export const withCurrentOption = (options: readonly string[], current?: string, emptyLabel = "未设置") => {
  const value = current ?? "";
  return value && !options.includes(value) ? [{ value, label: `当前值：${value}` }, ...options.map((item) => ({ value: item, label: item }))] : [{ value: "", label: emptyLabel }, ...options.map((item) => ({ value: item, label: item }))];
};

export const relationLabelForKind = (kind: EntityKind) => ({
  wechat: "关联微信号", qq: "关联QQ号", phone: "关联手机号", ip: "关联IP", location: "账号活跃位置",
  datacenter: "IP所属机房", device: "关联设备", group: "加入群", platform: "关联平台账号",
  organization: "归属", subject: "建立主体簇", custom: "自定义",
}[kind]);

export const defaultSpreadFor = (kind: EntityKind) => ({
  wechat: "账号链扩展", qq: "账号链扩展", phone: "跨平台映射", ip: "同 IP 扩散", location: "人工关联",
  datacenter: "同 IP 扩散", device: "同机扩散", group: "群聊扩散", platform: "跨平台映射",
  organization: "人工关联", custom: "人工关联", subject: "人工关联",
}[kind]);

const RELATION_KIND_HINTS: Partial<Record<string, EntityKind[]>> = {
  "加入群": ["group"], "群成员": ["wechat", "qq", "phone", "platform"], "同机": ["qq"], "归属": ["organization"],
  "绑定手机号": ["phone"], "登录IP": ["ip"], "使用设备": ["device"],
};

export const hasRelationKindConflict = (label: string, kind: EntityKind) => {
  const expected = RELATION_KIND_HINTS[label.trim()];
  return Boolean(expected && !expected.includes(kind));
};

export const defaultsAfterKindChange = (kind: EntityKind, currentLabel: string, labelEdited: boolean) => ({
  label: labelEdited ? currentLabel : relationLabelForKind(kind),
  spread: defaultSpreadFor(kind),
});
