import type { AttributeValueType, EntityKind } from "./types";

export type StructuredFieldDefinition = {
  key: string;
  label: string;
  valueType: AttributeValueType;
  placeholder?: string;
  advanced?: boolean;
};

export const structuredFieldLabels: Record<string, string> = {
  group_name: "群名称", member_count: "群人数", last_message_at: "最后消息时间", created_at: "创建时间",
  description: "简介", announcement: "公告", query_role: "查询人角色", group_remark: "群备注", nickname: "昵称",
  friend_group: "好友分组", friend_remark: "好友备注", registration: "注册地", account_status: "账号状态",
  risk_status: "风险状态", similarity: "相似度", device_signal: "同机说明", phone_type: "手机号类型",
  set_at: "设置时间", modified_at: "修改时间", verified_at: "验证时间", title: "标题", display_name: "显示名称",
  platform: "平台", organization_name: "个人/团伙名称", model: "型号", device_id: "设备标识", ip_address: "IP 地址",
  avatar: "头像", identifier: "标识ID", registered_at: "注册时间", last_login_at: "最后登录时间",
  ban_count: "一年内被封次数", report_count: "一年内被举报次数", report_success_count: "举报成功次数",
  qq_credit: "QQ信用分", space_credit: "空间信用分", space_status: "空间状态", channel_status: "频道资格",
};

const field = (key: string, valueType: AttributeValueType, options: Omit<StructuredFieldDefinition, "key" | "label" | "valueType"> = {}): StructuredFieldDefinition => ({ key, label: structuredFieldLabels[key] || key, valueType, ...options });

export const entityFieldsByKind: Partial<Record<EntityKind, StructuredFieldDefinition[]>> = {
  qq: [field("nickname", "text"), field("registration", "text", { advanced: true }), field("account_status", "enum", { advanced: true }), field("registered_at", "datetime", { advanced: true }), field("last_login_at", "datetime", { advanced: true }), field("ban_count", "number", { advanced: true }), field("report_count", "number", { advanced: true }), field("report_success_count", "number", { advanced: true }), field("qq_credit", "number", { advanced: true }), field("space_credit", "enum", { advanced: true }), field("space_status", "enum", { advanced: true }), field("channel_status", "enum", { advanced: true }), field("avatar", "text", { advanced: true }), field("identifier", "text", { advanced: true })],
  wechat: [field("nickname", "text"), field("account_status", "enum", { advanced: true })],
  phone: [field("registration", "text", { advanced: true })],
  ip: [field("registration", "text"), field("risk_status", "enum", { advanced: true })],
  group: [field("group_name", "text"), field("member_count", "number", { placeholder: "例如 1648" }), field("description", "text"), field("announcement", "text", { advanced: true }), field("created_at", "datetime", { advanced: true }), field("last_message_at", "datetime", { advanced: true }), field("avatar", "text", { advanced: true }), field("identifier", "text", { advanced: true })],
  device: [field("model", "text"), field("device_id", "text")],
  platform: [field("nickname", "text"), field("platform", "text"), field("account_status", "enum", { advanced: true })],
  organization: [field("organization_name", "text"), field("description", "text")],
  location: [field("description", "text")],
  datacenter: [field("registration", "text"), field("description", "text")],
  custom: [field("title", "text"), field("description", "text")],
};

export const relationFieldsByLabel: Record<string, StructuredFieldDefinition[]> = {
  好友: [field("friend_group", "text"), field("friend_remark", "text")],
  加入群: [field("query_role", "enum"), field("group_remark", "text")],
  群成员: [field("query_role", "enum"), field("group_remark", "text")],
  同机: [field("similarity", "number", { placeholder: "例如 0.92 或 92%" }), field("device_signal", "list")],
  绑定手机号: [field("phone_type", "enum"), field("set_at", "datetime", { advanced: true }), field("modified_at", "datetime", { advanced: true }), field("verified_at", "datetime", { advanced: true })],
};

export const fieldsForEntity = (kind: EntityKind) => entityFieldsByKind[kind] || [];
export const fieldsForRelation = (label: string) => relationFieldsByLabel[label.trim()] || [];
