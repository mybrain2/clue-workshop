import os
import sqlite3
from pathlib import Path

DB = Path.home() / "Library" / "Application Support" / "线索研判数据" / "casework.sqlite3"
CASE = "case-regression-multihop"

conn = sqlite3.connect(DB)
cur = conn.cursor()
entities = cur.execute("SELECT COUNT(*) FROM entities WHERE case_id=?", (CASE,)).fetchone()[0]
relations = cur.execute("SELECT COUNT(*) FROM relations WHERE case_id=?", (CASE,)).fetchone()[0]
kind_counts = dict(cur.execute("SELECT kind,COUNT(*) FROM entities WHERE case_id=? GROUP BY kind", (CASE,)).fetchall())
duplicates = cur.execute("SELECT kind,label,COUNT(*) FROM entities WHERE case_id=? GROUP BY kind,label HAVING COUNT(*)>1", (CASE,)).fetchall()
group_members = cur.execute("SELECT COUNT(*) FROM relations WHERE case_id=? AND source_id='r-group' AND label='群成员扩散'", (CASE,)).fetchone()[0]
assert entities == 90, entities
assert relations == 89, relations
assert kind_counts["phone"] == 3, kind_counts
assert kind_counts["qq"] == 80, kind_counts
assert kind_counts["ip"] == 1 and kind_counts["location"] == 1 and kind_counts["datacenter"] == 1, kind_counts
assert group_members == 56, group_members
assert not duplicates, duplicates
print({"result": "pass", "entities": entities, "relations": relations, "group_members": group_members, "kinds": kind_counts})
conn.close()
