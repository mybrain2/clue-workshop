import os
import sqlite3
from pathlib import Path

DB = Path.home() / "Library" / "Application Support" / "线索研判数据" / "casework.sqlite3"
CASE = "case-regression-multihop"

def add_entity(cur, entity_id, kind, label, role="未标注"):
    cur.execute(
        "INSERT OR IGNORE INTO entities(id,case_id,kind,label,role) VALUES(?,?,?,?,?)",
        (entity_id, CASE, kind, label, role),
    )

def add_relation(cur, relation_id, source, target, label, spread):
    cur.execute(
        "INSERT OR IGNORE INTO relations(id,case_id,source_id,target_id,label,spread) VALUES(?,?,?,?,?,?)",
        (relation_id, CASE, source, target, label, spread),
    )

def main():
    if not DB.exists():
        raise SystemExit(f"数据库不存在：{DB}")
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute("DELETE FROM relations WHERE case_id=?", (CASE,))
    cur.execute("DELETE FROM entities WHERE case_id=?", (CASE,))
    cur.execute("DELETE FROM cases WHERE id=?", (CASE,))
    cur.execute(
        "INSERT INTO cases(id,title,background,status,sort_order,root_id,created_at,updated_at) VALUES(?,?,?,?,?,?,datetime('now'),datetime('now'))",
        (CASE, "脱敏多跳回归案件", "用于回归：多手机号、多QQ、同机、同IP、群聊高连接、跨平台回连。", "active", -1, "r-root"),
    )
    add_entity(cur, "r-root", "subject", "主体 R · wxid_seed", "核心账号")
    add_entity(cur, "r-wx", "wechat", "wxid_seed", "业务号")
    add_relation(cur, "r-0", "r-root", "r-wx", "初始线索", "人工关联")
    for phone_index in range(3):
        phone = f"1360000{phone_index:04d}"
        phone_id = f"r-phone-{phone_index}"
        add_entity(cur, phone_id, "phone", phone, "核心账号" if phone_index == 0 else "未标注")
        add_relation(cur, f"r-ph-{phone_index}", "r-wx", phone_id, "微信关联手机号", "跨平台映射")
        for qq_index in range(8):
            qq_id = f"r-qq-{phone_index}-{qq_index}"
            add_entity(cur, qq_id, "qq", f"QQ {700000000 + phone_index * 10 + qq_index}", "小号" if qq_index > 5 else "未标注")
            add_relation(cur, f"r-qqrel-{phone_index}-{qq_index}", phone_id, qq_id, "手机号关联QQ号", "跨平台映射")
    add_entity(cur, "r-ip", "ip", "172.16.8.24")
    add_entity(cur, "r-device", "device", "Device-R-01")
    add_entity(cur, "r-group", "group", "群 44018")
    add_entity(cur, "r-location", "location", "华东 · 某市")
    add_entity(cur, "r-datacenter", "datacenter", "华东 · IDC-07")
    add_relation(cur, "r-iprel", "r-qq-0-0", "r-ip", "登录 IP", "同 IP 扩散")
    add_relation(cur, "r-device-rel", "r-qq-0-0", "r-device", "同机登录", "同机扩散")
    add_relation(cur, "r-group-rel", "r-qq-0-1", "r-group", "加入群聊", "群聊扩散")
    add_relation(cur, "r-location-rel", "r-wx", "r-location", "账号活跃位置", "人工关联")
    add_relation(cur, "r-dc-rel", "r-ip", "r-datacenter", "IP 所属机房", "同 IP 扩散")
    for member in range(56):
        member_id = f"r-member-{member}"
        add_entity(cur, member_id, "qq", f"QQ {800000000 + member}")
        add_relation(cur, f"r-member-rel-{member}", "r-group", member_id, "群成员扩散", "群聊扩散")
    conn.commit()
    entities = cur.execute("SELECT COUNT(*) FROM entities WHERE case_id=?", (CASE,)).fetchone()[0]
    relations = cur.execute("SELECT COUNT(*) FROM relations WHERE case_id=?", (CASE,)).fetchone()[0]
    assert entities == 1 + 1 + 3 + 24 + 5 + 56, entities
    assert relations == 1 + 3 + 24 + 5 + 56, relations
    print({"case": CASE, "entities": entities, "relations": relations, "db": str(DB)})
    conn.close()

if __name__ == "__main__":
    main()
