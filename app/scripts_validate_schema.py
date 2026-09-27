import os
import sqlite3
from pathlib import Path

p = Path.home() / "Library" / "Application Support" / "线索研判数据" / "casework.sqlite3"
conn = sqlite3.connect(p)
cur = conn.cursor()
tables = {row[0] for row in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")}
required = {"cases", "entities", "relations", "case_operations", "case_snapshots", "case_redos"}
missing = required - tables
assert not missing, missing
columns = {row[1] for row in cur.execute("PRAGMA table_info(entities)")}
assert {"accent", "pinned", "custom_type"}.issubset(columns), columns
relation_columns = {row[1] for row in cur.execute("PRAGMA table_info(relations)")}
assert "emphasis" in relation_columns, relation_columns
print({"result": "pass", "tables": sorted(required), "entity_columns": sorted(columns), "relation_columns": sorted(relation_columns)})
conn.close()
