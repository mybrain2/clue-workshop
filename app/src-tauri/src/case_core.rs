use chrono::Local;
use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const MAX_PACKAGE_FILES: usize = 1_024;
const MAX_PACKAGE_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_PACKAGE_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES: u64 = MAX_PACKAGE_FILE_BYTES;
const V2_PACKAGE_FILES: [&str; 3] = ["case.json", "attachments.json", "manifest.json"];
use uuid::Uuid;

#[cfg(test)]
thread_local! {
    static TEST_DATA_ROOT: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
}

pub type CoreResult<T> = Result<T, String>;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaseRecord {
    pub id: String,
    pub title: String,
    pub archive_title: Option<String>,
    #[serde(default)]
    pub archive_folder: String,
    #[serde(default)]
    pub archive_folder_id: Option<String>,
    pub background: String,
    #[serde(default)]
    pub police_disposal: String,
    #[serde(default)]
    pub current_status: String,
    #[serde(default)]
    pub path_lanes: String,
    pub status: String,
    pub sort_order: i64,
    pub updated_at: String,
    pub entity_count: i64,
    pub relation_count: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveFolder {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub id: String,
    pub case_id: String,
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub display_name: String,
    pub status: String,
    pub role: String,
    pub note: String,
    pub accent: String,
    pub pinned: bool,
    pub custom_type: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub id: String,
    pub case_id: String,
    pub source_id: String,
    pub target_id: String,
    pub label: String,
    pub spread: String,
    pub status: String,
    pub note: String,
    pub emphasis: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttributeRecord {
    #[serde(default)]
    pub id: String,
    pub case_id: String,
    pub subject_id: String,
    pub field_key: String,
    pub value_type: String,
    #[serde(default)]
    pub value_text: String,
    #[serde(default)]
    pub value_number: Option<f64>,
    #[serde(default)]
    pub value_time: Option<String>,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaseDetail {
    pub case: CaseRecord,
    pub root_id: String,
    pub entities: Vec<Entity>,
    pub relations: Vec<Relation>,
    #[serde(default)]
    pub entity_attributes: Vec<AttributeRecord>,
    #[serde(default)]
    pub relation_attributes: Vec<AttributeRecord>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistorySnapshot {
    #[serde(flatten)]
    detail: CaseDetail,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active_import_batch_ids: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRestoreResult {
    pub entity_count: usize,
    pub relation_count: usize,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub case_id: String,
    pub original_name: String,
    pub relative_path: String,
    pub sha256: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub collected_at: String,
    pub note: String,
    pub entity_id: Option<String>,
    pub relation_id: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub directory: String,
    pub summary_path: String,
    pub graph_path: String,
    pub data_path: String,
    pub package_path: String,
    pub xmind_path: String,
    pub markdown_path: String,
    pub xmind_size_bytes: u64,
    pub xmind_generated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CasePackage {
    format: String,
    version: u32,
    exported_at: String,
    detail: CasePackageDetail,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CasePackageDetail {
    case: CaseRecord,
    root_id: String,
    entities: Vec<Entity>,
    relations: Vec<Relation>,
    #[serde(default)]
    entity_attributes: Vec<AttributeRecord>,
    #[serde(default)]
    relation_attributes: Vec<AttributeRecord>,
}

impl From<&CaseDetail> for CasePackageDetail {
    fn from(detail: &CaseDetail) -> Self {
        Self {
            case: detail.case.clone(),
            root_id: detail.root_id.clone(),
            entities: detail.entities.clone(),
            relations: detail.relations.clone(),
            entity_attributes: detail.entity_attributes.clone(),
            relation_attributes: detail.relation_attributes.clone(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCaseInput {
    pub title: String,
    #[serde(default)]
    pub background: String,
    pub seed_kind: String,
    pub seed_value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseOverviewInput {
    pub id: String,
    pub background: String,
    #[serde(default)]
    pub police_disposal: String,
    #[serde(default)]
    pub current_status: String,
    #[serde(default)]
    pub path_lanes: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddRelationsInput {
    pub case_id: String,
    pub source_id: String,
    pub target_kind: String,
    pub values: Vec<String>,
    #[serde(default)]
    pub display_names: Vec<String>,
    pub label: String,
    #[serde(default = "default_spread")]
    pub spread: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub custom_type: String,
    #[serde(default = "default_import_source")]
    pub source: String,
    #[serde(default)]
    pub attributes: Vec<PlannedAttributeInput>,
    #[serde(default)]
    pub entity_attributes: Vec<PlannedAttributeInput>,
    #[serde(default)]
    pub relation_attributes: Vec<PlannedAttributeInput>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatch {
    pub id: String,
    pub case_id: String,
    pub source_id: String,
    pub target_kind: String,
    pub relation_label: String,
    pub relation_spread: String,
    pub relation_count: i64,
    pub source_summary: String,
    pub created_at: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AddRelationsResult {
    pub candidate_count: i64,
    pub added_count: i64,
    pub skipped_count: i64,
    pub attribute_count: i64,
    pub batch: Option<ImportBatch>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedAttributeInput {
    pub field_key: String,
    pub value_type: String,
    #[serde(default)]
    pub value_text: String,
    #[serde(default)]
    pub value_number: Option<f64>,
    #[serde(default)]
    pub value_time: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedEntityInput {
    pub kind: String,
    pub key: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub attributes: Vec<PlannedAttributeInput>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedRelationInput {
    pub source_kind: String,
    pub source_key: String,
    pub target_kind: String,
    pub target_key: String,
    pub label: String,
    #[serde(default)]
    pub attributes: Vec<PlannedAttributeInput>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueryOriginInput { pub kind: String, pub key: String, #[serde(default)] pub display_name: String }

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CurrentImportSourceInput { pub kind: String, pub value: String, #[serde(default)] pub display_name: String }

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlanInput {
    pub case_id: String,
    pub source_summary: String,
    pub template: String,
    pub template_version: String,
    pub template_mode: String,
    pub header_fingerprint: String,
    pub input_digest: String,
    pub raw_table: Vec<Vec<String>>,
    #[serde(default)]
    pub query_origin: Option<QueryOriginInput>,
    #[serde(default)]
    pub current_source: Option<CurrentImportSourceInput>,
    #[serde(default)]
    pub overlap_candidates: Vec<String>,
    #[serde(default)]
    pub parent_selection_reason: Option<String>,
    #[serde(default)]
    pub explicit_parent_key: Option<String>,
    pub endpoint_contract: serde_json::Value,
    #[serde(default)]
    pub mapping: Option<serde_json::Value>,
    pub duplicate_relations: i64,
    pub raw_row_count: i64,
    pub valid_row_count: i64,
    pub relation_count: i64,
    pub entity_count: i64,
    #[serde(default)]
    pub row_decisions: Vec<serde_json::Value>,
    #[serde(default)]
    pub batch_errors: Vec<String>,
    #[serde(default)]
    pub bridge_relation_count: i64,
    #[serde(default)]
    pub entities: Vec<PlannedEntityInput>,
    #[serde(default)]
    pub relations: Vec<PlannedRelationInput>,
    #[serde(default)]
    pub error_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlanResult {
    pub added_entities: i64,
    pub reused_entities: i64,
    pub added_relations: i64,
    pub reused_relations: i64,
    pub added_attributes: i64,
    pub reused_attributes: i64,
    pub updated_attributes: i64,
    pub attribute_count: i64,
    pub error_count: i64,
    pub batch: Option<ImportBatch>,
}

fn default_spread() -> String {
    "人工关联".into()
}
fn default_import_source() -> String {
    "手工录入".into()
}
fn now() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn data_root() -> CoreResult<PathBuf> {
    #[cfg(test)]
    {
        return TEST_DATA_ROOT.with(|root| {
            root.borrow()
                .clone()
                .ok_or_else(|| "测试数据目录尚未初始化".into())
        });
    }
    #[cfg(not(test))]
    {
        #[cfg(target_os = "macos")]
        {
            let home = env::var_os("HOME").ok_or("无法读取 HOME 目录")?;
            Ok(PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("线索研判数据"))
        }
        #[cfg(target_os = "windows")]
        {
            // Windows 数据目录：%APPDATA%\线索研判数据（与 macOS 版互不冲突，数据可整目录迁移）
            let appdata = env::var_os("APPDATA")
                .ok_or("无法读取 APPDATA 目录（Windows 用户配置缺失）")?;
            Ok(PathBuf::from(appdata).join("线索研判数据"))
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            // Linux 兜底：XDG_DATA_HOME 或 ~/.local/share
            let data_home = env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    let home = env::var_os("HOME").expect("无法读取 HOME 目录");
                    PathBuf::from(home).join(".local").join("share")
                });
            Ok(data_home.join("线索研判数据"))
        }
    }
}

pub fn database_path() -> CoreResult<PathBuf> {
    Ok(data_root()?.join("casework.sqlite3"))
}

fn add_column(conn: &Connection, table: &str, column: &str, definition: &str) -> CoreResult<()> {
    let mut found = false;
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    for row in rows {
        if row.map_err(|e| e.to_string())? == column {
            found = true;
        }
    }
    if !found {
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn open() -> CoreResult<Connection> {
    let root = data_root()?;
    for dir in ["attachments", "exports", "backups", "snapshots", "logs"] {
        fs::create_dir_all(root.join(dir)).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(root.join("casework.sqlite3")).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
        PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS archive_folders(id TEXT PRIMARY KEY,name TEXT NOT NULL,normalized_name TEXT NOT NULL UNIQUE,sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY,title TEXT NOT NULL,archive_title TEXT,archive_folder TEXT NOT NULL DEFAULT '',archive_folder_id TEXT REFERENCES archive_folders(id) ON DELETE SET NULL,background TEXT NOT NULL DEFAULT '',police_disposal TEXT NOT NULL DEFAULT '',current_status TEXT NOT NULL DEFAULT '',path_lanes TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,archive_note TEXT,root_id TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT,trashed_at TEXT);
        CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,kind TEXT NOT NULL,label TEXT NOT NULL,display_name TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT '有效',role TEXT NOT NULL DEFAULT '未标注',note TEXT NOT NULL DEFAULT '',accent TEXT NOT NULL DEFAULT '',pinned INTEGER NOT NULL DEFAULT 0,custom_type TEXT NOT NULL DEFAULT '',FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS relations(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,source_id TEXT NOT NULL,target_id TEXT NOT NULL,label TEXT NOT NULL,spread TEXT NOT NULL DEFAULT '人工关联',status TEXT NOT NULL DEFAULT '有效',note TEXT NOT NULL DEFAULT '',emphasis INTEGER NOT NULL DEFAULT 0,FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,FOREIGN KEY(source_id) REFERENCES entities(id) ON DELETE CASCADE,FOREIGN KEY(target_id) REFERENCES entities(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS entity_attributes(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,subject_id TEXT NOT NULL,field_key TEXT NOT NULL,value_type TEXT NOT NULL CHECK(value_type IN ('text','number','datetime','enum','list')),value_text TEXT NOT NULL DEFAULT '',value_number REAL,value_time TEXT,sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,FOREIGN KEY(subject_id) REFERENCES entities(id) ON DELETE CASCADE);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_attributes_value ON entity_attributes(case_id,subject_id,field_key,value_type,value_text,COALESCE(value_number,0),COALESCE(value_time,''));
        CREATE INDEX IF NOT EXISTS idx_entity_attributes_subject ON entity_attributes(case_id,subject_id,field_key,sort_order);
        CREATE TABLE IF NOT EXISTS relation_attributes(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,subject_id TEXT NOT NULL,field_key TEXT NOT NULL,value_type TEXT NOT NULL CHECK(value_type IN ('text','number','datetime','enum','list')),value_text TEXT NOT NULL DEFAULT '',value_number REAL,value_time TEXT,sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,FOREIGN KEY(subject_id) REFERENCES relations(id) ON DELETE CASCADE);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_relation_attributes_value ON relation_attributes(case_id,subject_id,field_key,value_type,value_text,COALESCE(value_number,0),COALESCE(value_time,''));
        CREATE INDEX IF NOT EXISTS idx_relation_attributes_subject ON relation_attributes(case_id,subject_id,field_key,sort_order);
        CREATE TRIGGER IF NOT EXISTS trg_entity_attributes_same_case_insert BEFORE INSERT ON entity_attributes WHEN NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.subject_id AND case_id=NEW.case_id) BEGIN SELECT RAISE(ABORT,'entity attribute subject case mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS trg_entity_attributes_same_case_update BEFORE UPDATE OF case_id,subject_id ON entity_attributes WHEN NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.subject_id AND case_id=NEW.case_id) BEGIN SELECT RAISE(ABORT,'entity attribute subject case mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS trg_relation_attributes_same_case_insert BEFORE INSERT ON relation_attributes WHEN NOT EXISTS(SELECT 1 FROM relations WHERE id=NEW.subject_id AND case_id=NEW.case_id) BEGIN SELECT RAISE(ABORT,'relation attribute subject case mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS trg_relation_attributes_same_case_update BEFORE UPDATE OF case_id,subject_id ON relation_attributes WHEN NOT EXISTS(SELECT 1 FROM relations WHERE id=NEW.subject_id AND case_id=NEW.case_id) BEGIN SELECT RAISE(ABORT,'relation attribute subject case mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS trg_relations_same_case_insert BEFORE INSERT ON relations WHEN NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.source_id AND case_id=NEW.case_id) OR NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.target_id AND case_id=NEW.case_id) BEGIN SELECT RAISE(ABORT,'relation endpoint case mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS trg_relations_same_case_update BEFORE UPDATE OF case_id,source_id,target_id ON relations WHEN NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.source_id AND case_id=NEW.case_id) OR NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.target_id AND case_id=NEW.case_id) BEGIN SELECT RAISE(ABORT,'relation endpoint case mismatch'); END;
        CREATE TABLE IF NOT EXISTS case_operations(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS case_snapshots(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,reason TEXT NOT NULL DEFAULT 'mutation',payload TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS case_redos(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS import_batches(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,source_id TEXT NOT NULL,target_kind TEXT NOT NULL,relation_label TEXT NOT NULL,relation_spread TEXT NOT NULL,relation_count INTEGER NOT NULL,source_summary TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS import_batch_relations(batch_id TEXT NOT NULL,relation_id TEXT NOT NULL,PRIMARY KEY(batch_id,relation_id));
        CREATE TABLE IF NOT EXISTS import_batch_entities(batch_id TEXT NOT NULL,entity_id TEXT NOT NULL,PRIMARY KEY(batch_id,entity_id));
        CREATE TABLE IF NOT EXISTS import_batch_entity_attributes(batch_id TEXT NOT NULL,attribute_id TEXT NOT NULL,PRIMARY KEY(batch_id,attribute_id));
        CREATE TABLE IF NOT EXISTS import_batch_relation_attributes(batch_id TEXT NOT NULL,attribute_id TEXT NOT NULL,PRIMARY KEY(batch_id,attribute_id));
        CREATE TABLE IF NOT EXISTS import_batch_attribute_updates(batch_id TEXT NOT NULL,table_name TEXT NOT NULL,attribute_id TEXT NOT NULL,before_value TEXT NOT NULL,PRIMARY KEY(batch_id,table_name,attribute_id));
        CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,original_name TEXT NOT NULL,relative_path TEXT NOT NULL UNIQUE,sha256 TEXT NOT NULL,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,collected_at TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',entity_id TEXT,relation_id TEXT,created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_attachments_case_id ON attachments(case_id);
        CREATE TABLE IF NOT EXISTS attachment_cleanup(path TEXT PRIMARY KEY,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workbench_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);",
    ).map_err(|e| e.to_string())?;
    add_column(&conn, "cases", "root_id", "TEXT NOT NULL DEFAULT ''")?;
    add_column(&conn, "cases", "archive_folder", "TEXT NOT NULL DEFAULT ''")?;
    add_column(&conn, "cases", "archive_folder_id", "TEXT")?;
    let timestamp = now();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut statement = tx.prepare("SELECT DISTINCT TRIM(archive_folder) FROM cases WHERE status='archived' AND TRIM(archive_folder)<>''").map_err(|e| e.to_string())?;
        let names = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(statement);
        for name in names {
            let normalized = normalize_folder_name(&name)?;
            tx.execute("INSERT OR IGNORE INTO archive_folders(id,name,normalized_name,sort_order,created_at,updated_at) VALUES(?1,?2,?3,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM archive_folders),?4,?4)", params![Uuid::new_v4().to_string(), name, normalized, timestamp]).map_err(|e| e.to_string())?;
        }
    }
    tx.execute("UPDATE cases SET archive_folder_id=(SELECT id FROM archive_folders WHERE normalized_name=LOWER(TRIM(cases.archive_folder))) WHERE status='archived' AND TRIM(archive_folder)<>'' AND archive_folder_id IS NULL", []).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    add_column(
        &conn,
        "cases",
        "police_disposal",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    add_column(&conn, "cases", "current_status", "TEXT NOT NULL DEFAULT ''")?;
    add_column(&conn, "cases", "path_lanes", "TEXT NOT NULL DEFAULT '[]'")?;
    add_column(
        &conn,
        "entities",
        "display_name",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    add_column(&conn, "entities", "accent", "TEXT NOT NULL DEFAULT ''")?;
    add_column(&conn, "entities", "pinned", "INTEGER NOT NULL DEFAULT 0")?;
    add_column(&conn, "entities", "custom_type", "TEXT NOT NULL DEFAULT ''")?;
    add_column(&conn, "relations", "emphasis", "INTEGER NOT NULL DEFAULT 0")?;
    add_column(
        &conn,
        "case_snapshots",
        "reason",
        "TEXT NOT NULL DEFAULT 'mutation'",
    )?;
    add_column(&conn, "import_batches", "undone", "INTEGER NOT NULL DEFAULT 0")?;
    conn.execute("UPDATE attachments SET entity_id=NULL WHERE entity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM entities WHERE entities.id=attachments.entity_id AND entities.case_id=attachments.case_id)", []).map_err(|e| e.to_string())?;
    conn.execute("UPDATE attachments SET relation_id=NULL WHERE relation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM relations WHERE relations.id=attachments.relation_id AND relations.case_id=attachments.case_id)", []).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn normalize_folder_name(name: &str) -> CoreResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("文件夹名称不能为空".into());
    }
    Ok(trimmed.to_lowercase())
}

pub fn list_archive_folders() -> CoreResult<Vec<ArchiveFolder>> {
    let conn = open()?;
    let mut statement = conn.prepare("SELECT id,name,sort_order,created_at,updated_at FROM archive_folders ORDER BY sort_order,name COLLATE NOCASE").map_err(|e| e.to_string())?;
    let folders = statement
        .query_map([], |r| {
            Ok(ArchiveFolder {
                id: r.get(0)?,
                name: r.get(1)?,
                sort_order: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(folders)
}

pub fn create_archive_folder(name: &str) -> CoreResult<ArchiveFolder> {
    let normalized = normalize_folder_name(name)?;
    let conn = open()?;
    let id = Uuid::new_v4().to_string();
    let timestamp = now();
    conn.execute("INSERT INTO archive_folders(id,name,normalized_name,sort_order,created_at,updated_at) VALUES(?1,?2,?3,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM archive_folders),?4,?4)", params![id,name.trim(),normalized,timestamp]).map_err(|e| if e.to_string().contains("UNIQUE") { "已存在同名归档文件夹".into() } else { e.to_string() })?;
    let sort_order = conn
        .query_row(
            "SELECT sort_order FROM archive_folders WHERE id=?1",
            [&id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(ArchiveFolder {
        id,
        name: name.trim().into(),
        sort_order,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    })
}

pub fn rename_archive_folder(id: &str, name: &str) -> CoreResult<()> {
    let normalized = normalize_folder_name(name)?;
    let conn = open()?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let changed = tx
        .execute(
            "UPDATE archive_folders SET name=?1,normalized_name=?2,updated_at=?3 WHERE id=?4",
            params![name.trim(), normalized, now(), id],
        )
        .map_err(|e| {
            if e.to_string().contains("UNIQUE") {
                "已存在同名归档文件夹".into()
            } else {
                e.to_string()
            }
        })?;
    if changed != 1 {
        return Err("找不到归档文件夹".into());
    }
    tx.execute(
        "UPDATE cases SET archive_folder=?1,updated_at=?2 WHERE archive_folder_id=?3",
        params![name.trim(), now(), id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn delete_archive_folder(id: &str) -> CoreResult<()> {
    let conn = open()?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM cases WHERE archive_folder_id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count > 0 {
        return Err(format!("文件夹内有 {count} 个案件，请先移动或恢复案件"));
    }
    if tx
        .execute("DELETE FROM archive_folders WHERE id=?1", [id])
        .map_err(|e| e.to_string())?
        != 1
    {
        return Err("找不到归档文件夹".into());
    }
    tx.commit().map_err(|e| e.to_string())
}

fn allowed_kind(kind: &str) -> bool {
    matches!(
        kind,
        "subject"
            | "qq"
            | "wechat"
            | "phone"
            | "ip"
            | "location"
            | "datacenter"
            | "device"
            | "group"
            | "platform"
            | "organization"
            | "custom"
    )
}

fn touch_tx(tx: &Transaction<'_>, case_id: &str, action: &str, detail: &str) -> CoreResult<()> {
    let timestamp = now();
    tx.execute(
        "UPDATE cases SET updated_at=?1 WHERE id=?2",
        params![timestamp, case_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO case_operations(id,case_id,action,detail,created_at) VALUES(?1,?2,?3,?4,?5)",
        params![Uuid::new_v4().to_string(), case_id, action, detail, now()],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO workbench_meta(key,value) VALUES('revision',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [Uuid::new_v4().to_string()]).map_err(|e| e.to_string())?;
    Ok(())
}

fn touch(conn: &Connection, case_id: &str, action: &str, detail: &str) -> CoreResult<()> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    touch_tx(&tx, case_id, action, detail)?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn revision() -> CoreResult<String> {
    let conn = open()?;
    Ok(conn
        .query_row(
            "SELECT value FROM workbench_meta WHERE key='revision'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "bootstrap".into()))
}

pub fn case_record(conn: &Connection, id: &str) -> CoreResult<CaseRecord> {
    conn.query_row(
        "SELECT c.id,c.title,c.archive_title,c.archive_folder,c.archive_folder_id,c.background,c.police_disposal,c.current_status,c.path_lanes,c.status,c.sort_order,c.updated_at,(SELECT COUNT(*) FROM entities e WHERE e.case_id=c.id),(SELECT COUNT(*) FROM relations r WHERE r.case_id=c.id) FROM cases c WHERE c.id=?1",
        [id],
        |r| Ok(CaseRecord { id:r.get(0)?, title:r.get(1)?, archive_title:r.get(2)?, archive_folder:r.get(3)?, archive_folder_id:r.get(4)?, background:r.get(5)?, police_disposal:r.get(6)?, current_status:r.get(7)?, path_lanes:r.get(8)?, status:r.get(9)?, sort_order:r.get(10)?, updated_at:r.get(11)?, entity_count:r.get(12)?, relation_count:r.get(13)? }),
    ).map_err(|_| "找不到案件".into())
}

pub fn list_cases(status: Option<&str>) -> CoreResult<Vec<CaseRecord>> {
    let conn = open()?;
    let mut sql = "SELECT c.id,c.title,c.archive_title,c.archive_folder,c.archive_folder_id,c.background,c.police_disposal,c.current_status,c.path_lanes,c.status,c.sort_order,c.updated_at,(SELECT COUNT(*) FROM entities e WHERE e.case_id=c.id),(SELECT COUNT(*) FROM relations r WHERE r.case_id=c.id) FROM cases c".to_string();
    if status.is_some() {
        sql.push_str(" WHERE c.status=?1");
    }
    sql.push_str(" ORDER BY CASE c.status WHEN 'active' THEN 0 WHEN 'archived' THEN 1 ELSE 2 END,c.sort_order,c.updated_at DESC");
    let mut statement = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mapper = |r: &rusqlite::Row| {
        Ok(CaseRecord {
            id: r.get(0)?,
            title: r.get(1)?,
            archive_title: r.get(2)?,
            archive_folder: r.get(3)?,
            archive_folder_id: r.get(4)?,
            background: r.get(5)?,
            police_disposal: r.get(6)?,
            current_status: r.get(7)?,
            path_lanes: r.get(8)?,
            status: r.get(9)?,
            sort_order: r.get(10)?,
            updated_at: r.get(11)?,
            entity_count: r.get(12)?,
            relation_count: r.get(13)?,
        })
    };
    let rows = match status {
        Some(value) => statement.query_map([value], mapper),
        None => statement.query_map([], mapper),
    }
    .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn read_attributes(
    conn: &Connection,
    table: &str,
    case_id: &str,
) -> CoreResult<Vec<AttributeRecord>> {
    let sql = match table {
        "entity_attributes" => "SELECT id,case_id,subject_id,field_key,value_type,value_text,value_number,value_time,sort_order,created_at,updated_at FROM entity_attributes WHERE case_id=?1 ORDER BY subject_id,field_key,updated_at DESC,rowid DESC",
        "relation_attributes" => "SELECT id,case_id,subject_id,field_key,value_type,value_text,value_number,value_time,sort_order,created_at,updated_at FROM relation_attributes WHERE case_id=?1 ORDER BY subject_id,field_key,updated_at DESC,rowid DESC",
        _ => return Err("属性类型无效".into()),
    };
    let mut statement = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([case_id], |r| {
            Ok(AttributeRecord {
                id: r.get(0)?,
                case_id: r.get(1)?,
                subject_id: r.get(2)?,
                field_key: r.get(3)?,
                value_type: r.get(4)?,
                value_text: r.get(5)?,
                value_number: r.get(6)?,
                value_time: r.get(7)?,
                sort_order: r.get(8)?,
                created_at: r.get(9)?,
                updated_at: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn validate_attribute(attribute: &AttributeRecord) -> CoreResult<()> {
    let key = attribute.field_key.trim();
    if key.is_empty()
        || key.len() > 64
        || !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
    {
        return Err("属性字段 key 仅允许 1-64 位字母、数字、下划线、短横线和点".into());
    }
    if !matches!(
        attribute.value_type.as_str(),
        "text" | "number" | "datetime" | "enum" | "list"
    ) {
        return Err("属性值类型无效".into());
    }
    if attribute.value_text.len() > 16_384
        || attribute
            .value_time
            .as_deref()
            .map_or(false, |v| v.len() > 128)
    {
        return Err("属性值过长".into());
    }
    if attribute.value_type == "number" && attribute.value_number.map_or(true, f64::is_nan) {
        return Err("number 属性必须提供有效数值".into());
    }
    Ok(())
}

fn insert_attribute_tx(
    tx: &Transaction<'_>,
    table: &str,
    attribute: &AttributeRecord,
    case_id: &str,
) -> CoreResult<()> {
    validate_attribute(attribute)?;
    if !matches!(table, "entity_attributes" | "relation_attributes") {
        return Err("属性类型无效".into());
    }
    let sql = format!("INSERT OR IGNORE INTO {table}(id,case_id,subject_id,field_key,value_type,value_text,value_number,value_time,sort_order,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)");
    tx.execute(
        &sql,
        params![
            attribute.id,
            case_id,
            attribute.subject_id,
            attribute.field_key,
            attribute.value_type,
            attribute.value_text,
            attribute.value_number,
            attribute.value_time,
            attribute.sort_order,
            attribute.created_at,
            attribute.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn upsert_attributes(
    case_id: &str,
    subject_kind: &str,
    attributes: Vec<AttributeRecord>,
) -> CoreResult<Vec<AttributeRecord>> {
    let (table, subject_table) = match subject_kind {
        "entity" => ("entity_attributes", "entities"),
        "relation" => ("relation_attributes", "relations"),
        _ => return Err("属性主体类型无效".into()),
    };
    if attributes.len() > 1000 {
        return Err("单次最多写入 1000 条属性".into());
    }
    for attribute in &attributes {
        validate_attribute(attribute)?;
        if attribute.case_id != case_id {
            return Err("属性案件 ID 不一致".into());
        }
    }
    let validation_conn = open()?;
    for attribute in &attributes {
        let exists: i64 = validation_conn
            .query_row(
                &format!("SELECT COUNT(*) FROM {subject_table} WHERE id=?1 AND case_id=?2"),
                params![attribute.subject_id, case_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists != 1 {
            return Err("属性主体不存在或不属于目标案件".into());
        }
    }
    drop(validation_conn);
    if !attributes.is_empty() {
        save_history(case_id, false)?;
        clear_redos(case_id)?;
    }
    let mut conn = open()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let timestamp = now();
    for attribute in attributes {
        let current_id: Option<String> = tx.query_row(
            &format!("SELECT id FROM {table} WHERE case_id=?1 AND subject_id=?2 AND field_key=?3 ORDER BY updated_at DESC,rowid DESC LIMIT 1"),
            params![case_id, attribute.subject_id, attribute.field_key.trim()],
            |r| r.get(0),
        ).ok();
        if let Some(id) = current_id {
            tx.execute(
                &format!("UPDATE {table} SET value_type=?1,value_text=?2,value_number=?3,value_time=?4,sort_order=?5,updated_at=?6 WHERE id=?7"),
                params![attribute.value_type, attribute.value_text, attribute.value_number, attribute.value_time, attribute.sort_order, timestamp, id],
            ).map_err(|e| e.to_string())?;
        } else {
            let id = if attribute.id.trim().is_empty() { Uuid::new_v4().to_string() } else { attribute.id };
            tx.execute(
                &format!("INSERT INTO {table}(id,case_id,subject_id,field_key,value_type,value_text,value_number,value_time,sort_order,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)"),
                params![id, case_id, attribute.subject_id, attribute.field_key.trim(), attribute.value_type, attribute.value_text, attribute.value_number, attribute.value_time, attribute.sort_order, timestamp],
            ).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    touch(&conn, case_id, "upsert_attributes", "更新结构化属性")?;
    read_attributes(&conn, table, case_id)
}

pub fn delete_attribute(case_id: &str, subject_kind: &str, attribute_id: &str) -> CoreResult<()> {
    let table = match subject_kind {
        "entity" => "entity_attributes",
        "relation" => "relation_attributes",
        _ => return Err("属性主体类型无效".into()),
    };
    let validation_conn = open()?;
    let exists: i64 = validation_conn
        .query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE id=?1 AND case_id=?2"),
            params![attribute_id, case_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists != 1 {
        return Err("未找到可删除属性".into());
    }
    drop(validation_conn);
    save_history(case_id, false)?;
    clear_redos(case_id)?;
    let conn = open()?;
    let changed = conn
        .execute(
            &format!("DELETE FROM {table} WHERE id=?1 AND case_id=?2"),
            params![attribute_id, case_id],
        )
        .map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("未找到可删除属性".into());
    }
    touch(&conn, case_id, "delete_attribute", "删除结构化属性")
}

pub fn get_case_detail(id: &str) -> CoreResult<CaseDetail> {
    let conn = open()?;
    let case = case_record(&conn, id)?;
    let root_id = conn
        .query_row("SELECT root_id FROM cases WHERE id=?1", [id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let mut entity_statement = conn.prepare("SELECT id,case_id,kind,label,display_name,status,role,note,accent,pinned,custom_type FROM entities WHERE case_id=?1 ORDER BY label COLLATE NOCASE").map_err(|e| e.to_string())?;
    let entities = entity_statement
        .query_map([id], |r| {
            Ok(Entity {
                id: r.get(0)?,
                case_id: r.get(1)?,
                kind: r.get(2)?,
                label: r.get(3)?,
                display_name: r.get(4)?,
                status: r.get(5)?,
                role: r.get(6)?,
                note: r.get(7)?,
                accent: r.get(8)?,
                pinned: r.get::<_, i64>(9)? != 0,
                custom_type: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut relation_statement = conn.prepare("SELECT id,case_id,source_id,target_id,label,spread,status,note,emphasis FROM relations WHERE case_id=?1 ORDER BY rowid").map_err(|e| e.to_string())?;
    let relations = relation_statement
        .query_map([id], |r| {
            Ok(Relation {
                id: r.get(0)?,
                case_id: r.get(1)?,
                source_id: r.get(2)?,
                target_id: r.get(3)?,
                label: r.get(4)?,
                spread: r.get(5)?,
                status: r.get(6)?,
                note: r.get(7)?,
                emphasis: r.get::<_, i64>(8)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut attachment_statement = conn.prepare("SELECT id,case_id,original_name,relative_path,sha256,mime_type,size_bytes,collected_at,note,entity_id,relation_id,created_at FROM attachments WHERE case_id=?1 ORDER BY created_at DESC").map_err(|e| e.to_string())?;
    let attachments = attachment_statement
        .query_map([id], |r| {
            Ok(Attachment {
                id: r.get(0)?,
                case_id: r.get(1)?,
                original_name: r.get(2)?,
                relative_path: r.get(3)?,
                sha256: r.get(4)?,
                mime_type: r.get(5)?,
                size_bytes: r.get(6)?,
                collected_at: r.get(7)?,
                note: r.get(8)?,
                entity_id: r.get(9)?,
                relation_id: r.get(10)?,
                created_at: r.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let entity_attributes = read_attributes(&conn, "entity_attributes", id)?;
    let relation_attributes = read_attributes(&conn, "relation_attributes", id)?;
    Ok(CaseDetail {
        case,
        root_id,
        entities,
        relations,
        entity_attributes,
        relation_attributes,
        attachments,
    })
}

pub fn create_case(input: CreateCaseInput) -> CoreResult<CaseRecord> {
    if input.title.trim().is_empty() || input.seed_value.trim().is_empty() {
        return Err("案件名称和初始线索不能为空".into());
    }
    if !allowed_kind(&input.seed_kind) || input.seed_kind == "subject" {
        return Err("初始线索类型不支持".into());
    }
    let conn = open()?;
    let id = Uuid::new_v4().to_string();
    let root_id = Uuid::new_v4().to_string();
    let seed_id = Uuid::new_v4().to_string();
    let timestamp = now();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let default_lanes = serde_json::to_string(&vec![
        "初始线索",
        "联系方式",
        "账号关系",
        "设备与网络",
        "社交与组织",
        "延展",
    ])
    .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO cases(id,title,background,path_lanes,status,sort_order,root_id,created_at,updated_at) VALUES(?1,?2,?3,?4,'active',(SELECT COALESCE(MIN(sort_order),0)-1 FROM cases WHERE status='active'),?5,?6,?6)", params![id, input.title.trim(), input.background.trim(), default_lanes, root_id, timestamp]).map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO entities(id,case_id,kind,label,role) VALUES(?1,?2,'subject',?3,'核心账号')",
        params![root_id, id, format!("主体簇 · {}", input.seed_value.trim())],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO entities(id,case_id,kind,label) VALUES(?1,?2,?3,?4)",
        params![seed_id, id, input.seed_kind, input.seed_value.trim()],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO relations(id,case_id,source_id,target_id,label,spread) VALUES(?1,?2,?3,?4,'初始线索','人工关联')", params![Uuid::new_v4().to_string(), id, root_id, seed_id]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    touch(&conn, &id, "create_case", "CLI/MCP 创建案件")?;
    case_record(&conn, &id)
}

pub fn add_relations(input: AddRelationsInput) -> CoreResult<AddRelationsResult> {
    let AddRelationsInput {
        case_id,
        source_id,
        target_kind,
        values,
        display_names,
        label,
        spread,
        note,
        custom_type,
        source,
        attributes,
        entity_attributes,
        mut relation_attributes,
    } = input;
    relation_attributes.extend(attributes);
    if !allowed_kind(&target_kind) || target_kind == "subject" {
        return Err("关联对象类型不支持".into());
    }
    if target_kind == "custom" && custom_type.trim().is_empty() {
        return Err("自定义关联必须填写对象类型".into());
    }
    if label.trim().is_empty() {
        return Err("关系名称不能为空".into());
    }
    let mut seen = HashSet::new();
    // 快捷录入 phone 值入库前规范化（+852 0000 0001 与 +85200000001 去重为同一实体）；非法值规范化后仍原样，由使用方理解
    let entries: Vec<(String, String)> = values
        .into_iter()
        .enumerate()
        .filter_map(|(index, value)| {
          let canonical = if target_kind == "phone" { normalize_phone_key(&value) } else { value.trim().to_string() };
          if canonical.is_empty() || !seen.insert(canonical.clone()) {
                return None;
            }
            Some((
                canonical,
                display_names
                    .get(index)
                    .map(|name| name.trim().to_string())
                    .unwrap_or_default(),
            ))
        })
        .collect();
    if entries.is_empty() {
        return Err("至少输入一个关联结果".into());
    }
    if entries.len() > 500 {
        return Err("单次最多录入 500 个关联结果".into());
    }
    let conn = open()?;
    let source_ok: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM entities WHERE id=?1 AND case_id=?2",
            params![source_id, case_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if source_ok != 1 {
        return Err("当前对象不属于目标案件".into());
    }
    for attribute in entity_attributes.iter().chain(relation_attributes.iter()) {
        let record = AttributeRecord { id: String::new(), case_id: case_id.clone(), subject_id: String::new(), field_key: attribute.field_key.clone(), value_type: attribute.value_type.clone(), value_text: attribute.value_text.clone(), value_number: attribute.value_number, value_time: attribute.value_time.clone(), sort_order: 0, created_at: String::new(), updated_at: String::new() };
        validate_attribute(&record)?;
    }
    let candidate_count = entries.len() as i64;
    let mut would_add = !entity_attributes.is_empty() || !relation_attributes.is_empty();
    for (value, _) in &entries {
        let target_id: Option<String> = conn
            .query_row(
                "SELECT id FROM entities WHERE case_id=?1 AND kind=?2 AND label=?3 AND custom_type=?4",
                params![case_id, target_kind, value, custom_type],
                |row| row.get(0),
            )
            .ok();
        match target_id {
            None => {
                would_add = true;
                break;
            }
            Some(target_id) => {
                let exists: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM relations WHERE case_id=?1 AND source_id=?2 AND target_id=?3 AND label=?4",
                        params![case_id, source_id, target_id, label],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if exists == 0 {
                    would_add = true;
                    break;
                }
            }
        }
    }
    drop(conn);
    if !would_add {
        return Ok(AddRelationsResult {
            candidate_count,
            added_count: 0,
            skipped_count: candidate_count,
            attribute_count: 0,
            batch: None,
        });
    }
    let history_payload = history_payload(&case_id)?;
    let mut conn = open()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    save_history_tx(&tx, &case_id, false, &history_payload)?;
    clear_redos_tx(&tx, &case_id)?;
    let mut batch = ImportBatch {
        id: Uuid::new_v4().to_string(),
        case_id: case_id.clone(),
        source_id: source_id.clone(),
        target_kind: target_kind.clone(),
        relation_label: label.clone(),
        relation_spread: spread.clone(),
        relation_count: 0,
        source_summary: source.trim().to_string(),
        created_at: now(),
    };
    let mut added = 0i64;
    let mut changed_attributes = 0i64;
    for (value, display_name) in entries {
        let existing: Option<String> = tx.query_row("SELECT id FROM entities WHERE case_id=?1 AND kind=?2 AND label=?3 AND custom_type=?4", params![case_id, target_kind, value, custom_type], |r| r.get(0)).ok();
        let target_id = existing.unwrap_or_else(|| Uuid::new_v4().to_string());
        if tx
            .query_row(
                "SELECT COUNT(*) FROM entities WHERE id=?1",
                [&target_id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
            == 0
        {
            tx.execute("INSERT INTO entities(id,case_id,kind,label,display_name,custom_type) VALUES(?1,?2,?3,?4,?5,?6)", params![target_id, case_id, target_kind, value, display_name, custom_type]).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO import_batch_entities(batch_id,entity_id) VALUES(?1,?2)",
                params![batch.id, target_id],
            )
            .map_err(|e| e.to_string())?;
        }
        for (index, attribute) in entity_attributes.iter().enumerate() {
            let (inserted, _, updated) = import_plan_attribute(&tx, "entity_attributes", "import_batch_entity_attributes", &batch.id, &case_id, &target_id, attribute, index as i64, &batch.created_at)?;
            changed_attributes += inserted + updated;
        }
        let existing_relation: Option<String> = tx.query_row("SELECT id FROM relations WHERE case_id=?1 AND source_id=?2 AND target_id=?3 AND label=?4", params![case_id, source_id, target_id, label], |r| r.get(0)).ok();
        let relation_id = existing_relation.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
        if existing_relation.is_none() {
            tx.execute("INSERT INTO relations(id,case_id,source_id,target_id,label,spread,note) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![relation_id, case_id, source_id, target_id, label, spread, note]).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO import_batch_relations(batch_id,relation_id) VALUES(?1,?2)",
                params![batch.id, relation_id],
            )
            .map_err(|e| e.to_string())?;
            added += 1;
        }
        for (index, attribute) in relation_attributes.iter().enumerate() {
            let (inserted, _, updated) = import_plan_attribute(&tx, "relation_attributes", "import_batch_relation_attributes", &batch.id, &case_id, &relation_id, attribute, index as i64, &batch.created_at)?;
            changed_attributes += inserted + updated;
        }
    }
    if added == 0 && changed_attributes == 0 {
        tx.rollback().map_err(|e| e.to_string())?;
        return Ok(AddRelationsResult {
            candidate_count,
            added_count: 0,
            skipped_count: candidate_count,
            attribute_count: 0,
            batch: None,
        });
    }
    batch.relation_count = added;
    tx.execute("INSERT INTO import_batches(id,case_id,source_id,target_kind,relation_label,relation_spread,relation_count,source_summary,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![batch.id,batch.case_id,batch.source_id,batch.target_kind,batch.relation_label,batch.relation_spread,batch.relation_count,batch.source_summary,batch.created_at]).map_err(|e| e.to_string())?;
    touch_tx(
        &tx,
        &case_id,
        "add_relations",
        &format!("批量导入新增 {added} 条关联"),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(AddRelationsResult {
        candidate_count,
        added_count: added,
        skipped_count: candidate_count - added,
        attribute_count: changed_attributes,
        batch: Some(batch),
    })
}

fn import_plan_attribute(
    tx: &Transaction<'_>,
    table: &str,
    batch_table: &str,
    batch_id: &str,
    case_id: &str,
    subject_id: &str,
    value: &PlannedAttributeInput,
    sort_order: i64,
    timestamp: &str,
) -> CoreResult<(i64, i64, i64)> {
    let record = AttributeRecord {
        id: Uuid::new_v4().to_string(),
        case_id: case_id.into(),
        subject_id: subject_id.into(),
        field_key: value.field_key.trim().into(),
        value_type: value.value_type.clone(),
        value_text: value.value_text.clone(),
        value_number: value.value_number,
        value_time: value.value_time.clone(),
        sort_order,
        created_at: timestamp.into(),
        updated_at: timestamp.into(),
    };
    validate_attribute(&record)?;
    let existing: Option<AttributeRecord> = tx.query_row(
        &format!("SELECT id,case_id,subject_id,field_key,value_type,value_text,value_number,value_time,sort_order,created_at,updated_at FROM {table} WHERE case_id=?1 AND subject_id=?2 AND field_key=?3 ORDER BY updated_at DESC,rowid DESC LIMIT 1"),
        params![case_id, subject_id, record.field_key],
        |r| Ok(AttributeRecord { id:r.get(0)?, case_id:r.get(1)?, subject_id:r.get(2)?, field_key:r.get(3)?, value_type:r.get(4)?, value_text:r.get(5)?, value_number:r.get(6)?, value_time:r.get(7)?, sort_order:r.get(8)?, created_at:r.get(9)?, updated_at:r.get(10)? }),
    ).ok();
    if let Some(before) = existing {
        let unchanged = before.value_type == record.value_type && before.value_text == record.value_text && before.value_number == record.value_number && before.value_time == record.value_time;
        if unchanged { return Ok((0, 1, 0)); }
        tx.execute(
            "INSERT OR IGNORE INTO import_batch_attribute_updates(batch_id,table_name,attribute_id,before_value) VALUES(?1,?2,?3,?4)",
            params![batch_id, table, before.id, serde_json::to_string(&before).map_err(|e| e.to_string())?],
        ).map_err(|e| e.to_string())?;
        tx.execute(
            &format!("UPDATE {table} SET value_type=?1,value_text=?2,value_number=?3,value_time=?4,sort_order=?5,updated_at=?6 WHERE id=?7"),
            params![record.value_type,record.value_text,record.value_number,record.value_time,sort_order,timestamp,before.id],
        ).map_err(|e| e.to_string())?;
        return Ok((0, 0, 1));
    }
    tx.execute(
        &format!("INSERT INTO {table}(id,case_id,subject_id,field_key,value_type,value_text,value_number,value_time,sort_order,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)"),
        params![record.id,case_id,subject_id,record.field_key,record.value_type,record.value_text,record.value_number,record.value_time,sort_order,timestamp],
    ).map_err(|e| e.to_string())?;
    tx.execute(
        &format!("INSERT INTO {batch_table}(batch_id,attribute_id) VALUES(?1,?2)"),
        params![batch_id, record.id],
    ).map_err(|e| e.to_string())?;
    Ok((1, 0, 0))
}

#[derive(Default)]
struct StrictRebuild {
    query_origin: Option<QueryOriginInput>,
    overlap_candidates: Vec<String>,
    parent_selection_reason: Option<String>,
    entities: Vec<PlannedEntityInput>,
    relations: Vec<PlannedRelationInput>,
    decisions: Vec<serde_json::Value>,
    duplicates: i64,
}

fn sort_planned_entities(entities: &mut [PlannedEntityInput]) {
    entities.sort_by(|a, b| (&a.kind, a.key.trim()).cmp(&(&b.kind, b.key.trim())));
}

fn sort_planned_relations(relations: &mut [PlannedRelationInput]) {
    relations.sort_by(|a, b| {
        (&a.source_kind, a.source_key.trim(), &a.label, &a.target_kind, a.target_key.trim())
            .cmp(&(&b.source_kind, b.source_key.trim(), &b.label, &b.target_kind, b.target_key.trim()))
    });
}

fn strict_attr(column: &str, field: &str, value_type: &str, row: &HashMap<String, String>) -> Option<PlannedAttributeInput> {
    let value = row.get(column)?.trim();
    if value.is_empty() { return None; }
    let value_number = if value_type == "number" { value.trim_end_matches('%').parse::<f64>().ok().map(|n| if value.ends_with('%') { n / 100.0 } else { n }) } else { None };
    Some(PlannedAttributeInput { field_key: field.into(), value_type: value_type.into(), value_text: value.into(), value_number, value_time: if value_type == "datetime" { Some(value.into()) } else { None } })
}

fn strict_digest(rows: &[Vec<String>]) -> String {
    let encoded = rows.iter().map(|row| row.iter().map(|cell| format!("{}:{}", cell.as_bytes().len(), cell)).collect::<Vec<_>>().join("|")).collect::<Vec<_>>().join("\n");
    let mut hash: u32 = 2166136261;
    for byte in encoded.as_bytes() { hash ^= *byte as u32; hash = hash.wrapping_mul(16777619); }
    format!("fnv1a32:{hash:08x}")
}

fn valid_url_or_empty(value: &str) -> bool { value.is_empty() || value.starts_with("http://") || value.starts_with("https://") }
fn valid_cipher_or_empty(value: &str) -> bool { value.is_empty() || (!valid_strict_key("qq", value) && !valid_strict_key("phone", value) && !value.starts_with("http://") && !value.starts_with("https://")) }
fn valid_qq_or_cipher_or_empty(value: &str) -> bool { valid_strict_key("qq", value) || valid_cipher_or_empty(value) }
fn validate_positional_contract(template: &str, rows: &[Vec<String>]) -> bool {
    if rows.is_empty() { return false; }
    match template {
        "group-list" => {
            let sources=rows.iter().filter_map(|r|r.get(4)).filter(|v|!v.is_empty()).collect::<HashSet<_>>();
            sources.len()==1 && rows.iter().all(|r| valid_strict_key("group",&r[1]) && r[3]=="【Success】成功" && valid_strict_key("qq",&r[4]) && valid_qq_or_cipher_or_empty(&r[5]) && (r[7].starts_with('【') || ["群主","管理员","成员","普通成员","创建者"].contains(&r[7].as_str())) && valid_url_or_empty(&r[10]) && (r[12].is_empty() || r[12].parse::<f64>().is_ok()))
        },
        "friend-list" => {
            let sources=rows.iter().filter_map(|r|r.get(4)).filter(|v|!v.is_empty()).collect::<HashSet<_>>();
            sources.len()==1 && rows.iter().all(|r| valid_strict_key("qq",&r[1]) && valid_qq_or_cipher_or_empty(&r[4]) && valid_url_or_empty(&r[7]) && valid_cipher_or_empty(&r[9]) && valid_cipher_or_empty(&r[10]) && (r[3].is_empty() || r[3]=="【Success】成功"))
        },
        "qq-device" => rows.iter().all(|r| { let percent=r[1].ends_with('%'); let value=r[1].trim_end_matches('%').parse::<f64>().ok(); valid_strict_key("qq",&r[0]) && value.is_some_and(|number| number>=0.0 && if percent { number<=100.0 } else { number<=1.0 }) && !r[2].is_empty() }),
        "qq-phone-binding" => {
            let sources=rows.iter().filter_map(|r|r.get(1)).filter(|v|!v.is_empty()).collect::<HashSet<_>>();
            sources.len()==1 && rows.iter().all(|r| valid_strict_key("qq",&r[0]) && valid_strict_key("phone",&normalize_phone_key(&r[1])) && r[3]=="【Success】成功" && valid_cipher_or_empty(&r[4]) && valid_cipher_or_empty(&r[5]))
        },
        "group-member" => {
            let sources=rows.iter().filter_map(|r|r.get(0)).filter(|v|!v.is_empty()).collect::<HashSet<_>>();
            sources.len()==1 && rows.iter().all(|r| valid_strict_key("group",&r[0]) && valid_strict_key("qq",&r[1]) && valid_qq_or_cipher_or_empty(&r[2]) && valid_cipher_or_empty(&r[5]) && valid_cipher_or_empty(&r[7]) && r[10].starts_with('【') && r[11].starts_with('【') && (r[4]=="Success" || r[4]=="【Success】成功"))
        },
        "qq-phone-lookup" => {
            let sources=rows.iter().filter_map(|r|r.get(1)).filter(|v|!v.is_empty()).collect::<HashSet<_>>();
            sources.len()==1 && rows.iter().all(|r| valid_strict_key("qq",&r[1]) && valid_strict_key("phone",&normalize_phone_key(&r[0])) && valid_qq_or_cipher_or_empty(&r[2]) && r[4]=="【Success】成功" && valid_cipher_or_empty(&r[5]) && valid_cipher_or_empty(&r[6]))
        }, _ => false
    }
}

fn rebuild_strict_plan(input: &ImportPlanInput, existing_qq_keys: &HashSet<String>) -> CoreResult<StrictRebuild> {
    if input.raw_table.is_empty() || input.raw_table.len() > 10001 { return Err("原始表格必须为 1 至 10001 行".into()); }
    if input.raw_table.iter().any(|row| row.len() > 64 || row.iter().any(|cell| cell.len() > 65536)) { return Err("原始表格超过 64 列或单元格长度上限".into()); }
    let bytes: usize = input.raw_table.iter().flatten().map(|cell| cell.len()).sum();
    if bytes > 10 * 1024 * 1024 { return Err("原始表格超过 10MB 上限".into()); }
    let (required, source_kind, target_kind, label, source_column, target_column) = strict_import_contract(&input.template).ok_or("导入模板无效或不再支持宽松模板")?;
    let headers = &input.raw_table[0];
    if input.raw_table.iter().skip(1).any(|row| row.len() != headers.len()) {
        return Err("原始表格数据行列数必须与表头完全一致".into());
    }
    if headers.len() != required.len() || headers.iter().map(String::as_str).ne(required.iter().copied()) { return Err("严格导入表头缺失、重复、顺序错误或包含额外列".into()); }
    if input.header_fingerprint != headers.join("\u{1f}") { return Err("表头指纹与原始表格不一致".into()); }
    if input.input_digest != strict_digest(&input.raw_table) { return Err("输入摘要与原始表格不一致".into()); }
    match input.template_mode.as_str() {
        "strict-header" if validate_positional_contract(&input.template, &input.raw_table[1..]) => {},
        "strict-header" => return Err("数据内容未通过模板字段语义复验".into()),
        "strict-positional" if validate_positional_contract(&input.template, &input.raw_table[1..]) => {},
        "strict-positional" => return Err("无表头数据未通过模板位置合同复验".into()),
        _ => return Err("导入模板模式无效".into()),
    }
    let records = input.raw_table.iter().skip(1).map(|values| headers.iter().enumerate().map(|(i,h)| (h.clone(), values.get(i).map(|v| v.trim()).unwrap_or("").to_string())).collect::<HashMap<_,_>>()).collect::<Vec<_>>();
    if records.is_empty() || records.iter().any(|row| row.len() != headers.len()) { return Err("原始表格没有数据或行宽错误".into()); }
    let mut overlap_candidates = Vec::<String>::new();
    let mut parent_selection_reason = None;
    let source = if input.template == "qq-device" {
        let selected=input.current_source.as_ref().filter(|current|current.kind=="qq"&&valid_strict_key("qq",current.value.trim())).map(|current|current.value.trim().to_string());
        let mut file_origins=records.iter().filter(|row|row.get("关系").map(|value|value.trim())==Some("原号码")).filter_map(|row|row.get(target_column)).map(|value|value.trim()).filter(|value|valid_strict_key("qq",value)).map(str::to_string).collect::<Vec<_>>();
        file_origins.sort();file_origins.dedup();
        let fallback=if let Some(selected)=selected.as_ref(){selected.clone()}else if file_origins.len()==1{file_origins[0].clone()}else if file_origins.len()>1{return Err("同机文件包含多个原号码，请先选择实际用于查询的QQ号".into());}else{return Err("同机文件没有唯一原号码，请先选择实际用于查询的QQ号".into());};
        let mut candidates=records.iter().filter_map(|row|row.get(target_column)).map(|value|value.trim()).filter(|value|*value!=fallback&&valid_strict_key("qq",value)&&existing_qq_keys.contains(*value)).map(str::to_string).collect::<Vec<_>>();
        candidates.sort();candidates.dedup();overlap_candidates=candidates;
        match overlap_candidates.as_slice() {
            [] => { parent_selection_reason=Some(if selected.is_some(){"fallback-current-selection"}else{"file-origin"}.into()); fallback },
            [only] => { parent_selection_reason=Some("unique-existing-overlap".into()); only.clone() },
            _ => {
                let explicit=input.explicit_parent_key.as_deref().unwrap_or("").trim();
                if explicit.is_empty(){return Err(format!("检测到多个案件已有QQ与同机结果重合，请选择本批父节点：{}",overlap_candidates.join("、")));}
                if !overlap_candidates.iter().any(|key|key==explicit){return Err("选择的同机父节点不属于案件重合候选".into());}
                parent_selection_reason=Some("explicit-existing-overlap".into());explicit.to_string()
            }
        }
    } else {
        let normalize_source = |v: &String| -> String { if source_kind == "phone" { normalize_phone_key(v) } else { v.clone() } };
        let values = records.iter().filter_map(|row| row.get(source_column)).filter(|v| !v.is_empty()).map(&normalize_source).collect::<std::collections::HashSet<_>>();
        let primary_ok = values.len()==1 && valid_strict_key(source_kind, values.iter().next().unwrap());
        if primary_ok { values.into_iter().next().unwrap() }
        else if let Some(fallback_column) = strict_fallback_source_column(&input.template) {
            let fallbacks = records.iter().filter_map(|row| row.get(fallback_column)).filter(|v| !v.is_empty()).map(&normalize_source).collect::<std::collections::HashSet<_>>();
            if fallbacks.len()==1 && valid_strict_key(source_kind, fallbacks.iter().next().unwrap()) { fallbacks.into_iter().next().unwrap() }
            else { return Err(format!("严格导入查询起点不唯一或格式无效（含回退列）")); }
        }
        else { return Err("严格导入查询起点不唯一".into()); }
    };
    let mut rebuilt = StrictRebuild::default();
    rebuilt.query_origin=Some(QueryOriginInput{kind:source_kind.into(),key:source.clone(),display_name:if input.template=="qq-device"&&input.current_source.as_ref().map(|v|v.value.trim()==source).unwrap_or(false){input.current_source.as_ref().map(|v|v.display_name.clone()).unwrap_or_default()}else{String::new()}});
    rebuilt.overlap_candidates=overlap_candidates;
    rebuilt.parent_selection_reason=parent_selection_reason;
    let mut entity_indexes = HashMap::<(String,String),usize>::new();
    let mut relation_indexes = HashMap::<(String,String,String,String,String),usize>::new();
    for (index, row) in records.iter().enumerate() {
        // 行级起点统一使用已解析的查询起点（密文起点列回退后、手机号已规范化），与前端 sourceValue=originKey 对齐
        let source_value: &str = source.as_str();
        let raw_target = row.get(target_column).map(String::as_str).unwrap_or("");
        let target_value_owned: String;
        let target_value: &str = if target_kind == "phone" { target_value_owned = normalize_phone_key(raw_target); target_value_owned.as_str() } else { raw_target };
        let phone_hint = "手机号（大陆 1[3-9]… 或国际 +852… / +1… 格式）";
        let code = row.get("错误码类型").map(String::as_str).unwrap_or("");
        let code_ok = input.template == "qq-device" || code == "【Success】成功" || (input.template == "friend-list" && code.is_empty()) || (input.template == "group-member" && (code == "Success" || code == "【Success】成功"));
        if !code_ok || !valid_strict_key(source_kind, source_value) || !valid_strict_key(target_kind, target_value) || (input.template == "group-list" && row.get("QQ号").map(String::as_str).is_some_and(|v| valid_strict_key("qq", v) && v != source_value)) {
            let reason = if !code_ok { format!("「错误码类型」列应为【Success】成功，实际：{}", if code.is_empty() { "(空)".into() } else { code.to_string() }) }
            else if !valid_strict_key(source_kind, source_value) { format!("查询起点「{source_column}」应为{}格式，实际：{}", if source_kind=="phone" { phone_hint } else { source_kind }, source_value) }
            else if !valid_strict_key(target_kind, target_value) { format!("「{target_column}」列应为{}格式，实际：{}", if target_kind=="phone" { phone_hint } else { target_kind }, target_value) }
            else { format!("「QQ号」列与查询起点不一致：{}", row.get("QQ号").cloned().unwrap_or_default()) };
            return Err(format!("第 {} 行不符合严格合同：{}", index + 2, reason));
        }
        let (left_kind,left,right_kind,right) = (source_kind,source_value,target_kind,target_value);
        let target_fields: &[(&str,&str,&str)] = match input.template.as_str() {
            "group-list" => &[("群名称","group_name","text"),("群头像","avatar","text"),("最新群公告","announcement","text"),("群人数","member_count","number"),("最后群消息时间","last_message_at","datetime"),("群创建时间","created_at","datetime"),("群简介","description","text"),("标识id","identifier","text")],
            "friend-list" => &[("昵称","nickname","text"),("头像","avatar","text"),("标识id","identifier","text")],
            "qq-device" => &[("头像","avatar","text"),("昵称","nickname","text"),("注册时间","registered_at","datetime"),("注册地","registration","text"),("账号状态","account_status","enum"),("一年内被封次数","ban_count","number"),("一年内被举报次数","report_count","number"),("一年内被举报成功次数","report_success_count","number"),("最后一次登录时间","last_login_at","datetime"),("QQ信用分","qq_credit","number"),("空间信用分","space_credit","enum"),("空间状态","space_status","enum"),("频道资格","channel_status","enum")],
            "group-member" => &[("QQ账号昵称","nickname","text"),("标识id","identifier","text")],
            _ => &[] };
        let relation_fields: &[(&str,&str,&str)] = match input.template.as_str() { "group-list"=>&[("查询人角色","query_role","enum"),("群备注","group_remark","text")], "friend-list"=>&[("分组","friend_group","text"),("好友备注","friend_remark","text")], "qq-device"=>&[("关系","device_signal","list"),("相似度","similarity","number")], "qq-phone-binding"=>&[("手机号类型","phone_type","enum"),("设置时间","set_at","datetime"),("修改时间","modified_at","datetime"),("验证时间","verified_at","datetime")], "qq-phone-lookup"=>&[("手机号类型","phone_type","enum"),("设置时间","set_at","datetime"),("修改时间","modified_at","datetime"),("验证时间","verified_at","datetime")], "group-member"=>&[("成员角色","member_role","enum"),("群成员昵称","member_nickname","text")], _=>&[] };
        let target_attrs=target_fields.iter().filter_map(|(c,f,t)|strict_attr(c,f,t,row)).collect::<Vec<_>>();
        if input.template=="qq-device" && target_value==source_value {
            let ek=("qq".into(),source_value.into()); if !entity_indexes.contains_key(&ek) { entity_indexes.insert(ek.clone(),rebuilt.entities.len()); rebuilt.entities.push(PlannedEntityInput{kind:ek.0,key:ek.1,display_name:row.get("昵称").cloned().unwrap_or_default(),attributes:target_attrs}); }
            rebuilt.decisions.push(serde_json::json!({"valid":true,"decision":"source_only"}));
            continue;
        }
        for (kind,key,name,attrs) in [(left_kind,left,"",vec![]),(right_kind,right,row.get("群名称").or_else(||row.get("昵称")).or_else(||row.get("QQ账号昵称")).map(String::as_str).unwrap_or(""),if input.template=="qq-phone-binding"||input.template=="qq-phone-lookup"{vec![]}else{target_attrs})] {
            // 方向合同 v2：全部模板统一为"查询起点 → 结果"，绑定表为 phone → qq（与前端 smart-table.ts 同步）
            let ek=(kind.into(),key.into()); if !entity_indexes.contains_key(&ek) { entity_indexes.insert(ek.clone(),rebuilt.entities.len()); rebuilt.entities.push(PlannedEntityInput{kind:ek.0,key:ek.1,display_name:name.into(),attributes:attrs}); }
        }
        let rk=(left_kind.into(),left.into(),label.into(),right_kind.into(),right.into());
        let attrs=relation_fields.iter().filter_map(|(c,f,t)|strict_attr(c,f,t,row)).collect::<Vec<_>>();
        let duplicate=relation_indexes.get(&rk).copied();
        if let Some(i)=duplicate { rebuilt.relations[i].attributes.extend(attrs); rebuilt.duplicates+=1; rebuilt.decisions.push(serde_json::json!({"valid":true,"decision":"duplicate_merged"})); }
        else { relation_indexes.insert(rk.clone(),rebuilt.relations.len()); rebuilt.relations.push(PlannedRelationInput{source_kind:rk.0,source_key:rk.1,label:rk.2,target_kind:rk.3,target_key:rk.4,attributes:attrs}); rebuilt.decisions.push(serde_json::json!({"valid":true,"decision":"accepted"})); }
    }
    if rebuilt.relations.is_empty() { return Err("导入计划没有有效关系".into()); }
    Ok(rebuilt)
}

fn strict_import_contract(template: &str) -> Option<(&'static [&'static str], &'static str, &'static str, &'static str, &'static str, &'static str)> {
    match template {
        "group-list" => Some((&["QQ账号(解密)","QQ群账号(解密)","错误备注","错误码类型","命中结果","QQ号","群号","查询人角色","群备注","群名称","群头像","最新群公告","群人数","最后群消息时间","群创建时间","群简介","标识id"], "qq", "group", "加入群", "命中结果", "QQ群账号(解密)")),
        "friend-list" => Some((&["查询账号(解密)","QQ账号(解密)","错误备注","错误码类型","查询账号","分组","昵称","头像","好友备注","QQ账号","标识id"], "qq", "qq", "好友", "查询账号", "QQ账号(解密)")),
        "qq-device" => Some((&["UIN","相似度","关系","头像","昵称","注册时间","注册地","账号状态","一年内被封次数","一年内被举报次数","一年内被举报成功次数","最后一次登录时间","QQ信用分","空间信用分","空间状态","频道资格"], "qq", "qq", "同机", "当前选中QQ", "UIN")),
        "qq-phone-binding" => Some((&["QQ账号(解密)","命中查询内容","错误备注","错误码类型","QQ账号","手机号","手机号类型","设置时间","修改时间","验证时间"], "phone", "qq", "绑定手机号", "命中查询内容", "QQ账号(解密)")),
        "group-member" => Some((&["QQ群账号(解密)","QQ账号(解密)","命中查询内容","异常说明","错误码类型","QQ群账号(加密)","群状态","QQ账号(加密)","群成员昵称","QQ账号昵称","成员角色","是否机器人","标识id"], "group", "qq", "群成员", "QQ群账号(解密)", "QQ账号(解密)")),
        "qq-phone-lookup" => Some((&["手机号(解密)","QQ账号(解密)","命中查询内容","错误备注","错误码类型","QQ账号","手机号","手机号类型","设置时间","修改时间","验证时间"], "qq", "phone", "绑定手机号", "QQ账号(解密)", "手机号(解密)")),
        _ => None,
    }
}

// 各模板的回退起点列（主起点列密文时回退解密列），无则 None
fn strict_fallback_source_column(template: &str) -> Option<&'static str> {
    match template { "friend-list" => Some("查询账号(解密)"), _ => None }
}

fn valid_strict_key(kind: &str, key: &str) -> bool {
    match kind { "qq" | "group" => (5..=12).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_digit()), "phone" => valid_canonical_phone(key), _ => false }
}

// 手机号规范化 v2（国际号码合同，与前端 smart-table.ts normalizePhone 逐字节同构，黄金夹具 phone-fixtures.json 双端校验）。
// 清洗：空白/连字符/破折号/括号/点/中点，全角数字与全角＋转半角；00 国际拨号前缀视为 +。
// 规则按序：①大陆 (?:86)?1[3-9]… → 裸11位（与存量数据去重）②带 +/00 且 7-15 位数字 → "+"+数字
// ③裸号 8-15 位且前缀命中 ITU E.164 区号表 → "+"+数字（不拆国家码与本地号）④其余原样返回由调用方拒绝。
fn valid_canonical_phone(key: &str) -> bool {
    let bytes = key.as_bytes();
    if key.len() == 11 && bytes[0] == b'1' && (b'3'..=b'9').contains(&bytes[1]) { return bytes.iter().all(|b| b.is_ascii_digit()); }
    key.len() >= 8 && key.len() <= 16 && bytes[0] == b'+' && bytes[1..].iter().all(|b| b.is_ascii_digit())
}

const CC_RANGES: &[(u16, u16)] = &[(1,1),(7,7),(20,20),(27,27),(30,34),(36,36),(39,39),(40,49),(51,58),(60,66),(81,81),(82,82),(84,84),(86,86),(90,95),(98,98),(211,219),(220,235),(236,249),(250,258),(260,269),(290,290),(291,291),(297,299),(350,359),(370,383),(385,389),(420,420),(421,421),(423,423),(500,509),(590,599),(670,683),(685,692),(850,850),(852,852),(853,853),(855,855),(856,856),(870,870),(878,878),(880,883),(886,886),(960,979),(992,998)];

fn matches_country_code(digits: &str) -> bool {
    // 长度门槛在调用方；这里要求前 1-3 位命中区号且不与更长命中冲突（最长前缀优先）
    for size in [3usize, 2, 1] {
        if digits.len() < size { continue; }
        if let Ok(code) = digits[..size].parse::<u16>() {
            if CC_RANGES.iter().any(|&(lo, hi)| code >= lo && code <= hi) { return true; }
        }
    }
    false
}

fn normalize_phone_key(value: &str) -> String {
    let mut cleaned = String::with_capacity(value.len());
    for c in value.trim().chars() {
        match c {
            '０'..='９' => cleaned.push((c as u32 - 0xFF10 + 0x30) as u8 as char),
            '＋' => cleaned.push('+'),
            c if c.is_whitespace() || matches!(c, '-' | '(' | ')' | '·' | '.' | '．' | '—' | '–') => {}
            c => cleaned.push(c),
        }
    }
    if cleaned.is_empty() { return cleaned; }
    let has_plus = cleaned.starts_with('+');
    let digits_owned;
    let digits: &str = if has_plus { &cleaned[1..] } else { &cleaned };
    let mut implied_plus = has_plus;
    let mut bare_digits: &str = digits;
    if !has_plus && digits.starts_with("00") && digits.len() >= 9 && digits[2..].bytes().any(|b| b != b'0') {
        digits_owned = digits[2..].to_string();
        implied_plus = true;
        bare_digits = &digits_owned;
    }
    if !bare_digits.bytes().all(|b| b.is_ascii_digit()) || bare_digits.is_empty() { return cleaned; }
    let len = bare_digits.len();
    let explicit_plus = has_plus || implied_plus;
    // 86 前缀 13 位：无论是否带 +，均为大陆手机 → 裸 11 位（与存量数据去重）
    if len == 13 && bare_digits.starts_with("86") && valid_canonical_phone(&bare_digits[2..]) { return bare_digits[2..].to_string(); }
    // 裸 11 位 1 开头：大陆手机（带 + 的 11 位 1 开头是 NANP 国际形态，走国际分支）
    if !explicit_plus && len == 11 && bare_digits.as_bytes()[0] == b'1' && valid_canonical_phone(bare_digits) { return bare_digits.to_string(); }
    // 国际：带 +/00 且 7-15 位 → "+"+数字
    if explicit_plus && (7..=15).contains(&len) { return format!("+{}", bare_digits); }
    // 裸号国际：8-15 位且前缀命中 ITU 区号表 → "+"+数字
    if !explicit_plus && (8..=15).contains(&len) && matches_country_code(bare_digits) { return format!("+{}", bare_digits); }
    cleaned
}

fn valid_manual_key(kind: &str, key: &str) -> bool {
    match kind { "qq" | "group" => valid_strict_key(kind,key), "phone" => valid_strict_key("phone", &normalize_phone_key(key)), "ip" => { let p=key.split('.').collect::<Vec<_>>(); p.len()==4 && p.iter().all(|x|!x.is_empty()&&x.parse::<u8>().is_ok()) }, "custom" => !key.trim().is_empty(), _ => false }
}
// 手工映射端点键规范化：仅手机号剥离 86-/+86- 前缀
fn manual_canonical_key(kind: &str, key: &str) -> String { if kind == "phone" { normalize_phone_key(key) } else { key.to_string() } }
fn rebuild_manual_plan(input: &ImportPlanInput) -> CoreResult<StrictRebuild> {
    if input.template_version!="manual-mapped-v1"||input.template_mode!="manual-mapped"||input.template!="custom"||input.bridge_relation_count>1{return Err("手工映射合同无效或包含额外桥接".into());}
    let m=input.mapping.as_ref().ok_or("缺少手工映射合同")?; let has_header=m.get("hasHeader").and_then(|v|v.as_bool()).ok_or("映射缺少表头设置")?;
    let si=m.get("sourceIndex").and_then(|v|v.as_u64()).ok_or("来源列索引无效")? as usize; let ti=m.get("targetIndex").and_then(|v|v.as_u64()).ok_or("目标列索引无效")? as usize; let di=m.get("displayNameIndex").and_then(|v|v.as_u64()).map(|v|v as usize);
    let sk=m.get("sourceKind").and_then(|v|v.as_str()).ok_or("来源类型无效")?; let tk=m.get("targetKind").and_then(|v|v.as_str()).ok_or("目标类型无效")?; let label=m.get("relationLabel").and_then(|v|v.as_str()).unwrap_or("").trim();
    if !["qq","group","phone","ip","custom"].contains(&sk)||!["qq","group","phone","ip","custom"].contains(&tk)||label.is_empty(){return Err("映射类型或关系名称无效".into());}
    if input.raw_table.len()<2||input.raw_table.len()>10001{return Err("原始表格必须包含表头和数据".into());} let width=input.raw_table[0].len();
    if width==0||width>64||si>=width||ti>=width||di.map(|i|i>=width).unwrap_or(false)||si==ti{return Err("映射索引超出范围或端点列相同".into());}
    if input.raw_table.iter().any(|r|r.len()!=width||r.iter().any(|c|c.len()>65536)){return Err("原始表格行宽或单元格长度无效".into());}
    let bytes=input.raw_table.iter().flatten().try_fold(0usize,|total,cell|total.checked_add(cell.len()).ok_or("原始表格大小无效"))?;
    if bytes>10*1024*1024{return Err("原始表格超过 10MB 上限".into());}
    if has_header&&(input.raw_table[0].iter().any(|header|header.trim().is_empty())||input.raw_table[0].iter().map(|header|header.trim()).collect::<HashSet<_>>().len()!=width){return Err("手工映射表头不能为空或重复".into());}
    if !has_header&&input.raw_table[0].iter().enumerate().any(|(i,h)|h!=&format!("第{}列",i+1)){return Err("无表头模式合成列名无效".into());}
    if input.input_digest!=strict_digest(&input.raw_table)||input.header_fingerprint!=input.raw_table[0].join("\u{1f}"){return Err("输入摘要或表头指纹不一致".into());}
    let mut out=StrictRebuild::default();let mut ei=HashMap::new();let mut ri=HashMap::new();let mut sources=HashSet::new();
    for (i,row) in input.raw_table.iter().skip(1).enumerate(){let source=manual_canonical_key(sk,row[si].trim());let target=manual_canonical_key(tk,row[ti].trim());if !valid_manual_key(sk,&source)||!valid_manual_key(tk,&target){return Err(format!("第 {} 行端点格式无效",i+2));}if sk==tk&&source==target{return Err(format!("第 {} 行不允许自环",i+2));}sources.insert(source.clone());let display=di.map(|x|row[x].trim()).unwrap_or("");for(kind,key,name)in[(sk,&source,""),(tk,&target,display)]{let k=(kind.into(),key.into());if !ei.contains_key(&k){ei.insert(k.clone(),out.entities.len());out.entities.push(PlannedEntityInput{kind:k.0,key:k.1,display_name:name.into(),attributes:vec![]});}}let k=(sk.into(),source.clone(),label.into(),tk.into(),target.clone());if ri.contains_key(&k){out.duplicates+=1;out.decisions.push(serde_json::json!({"valid":true,"decision":"duplicate_merged"}));}else{ri.insert(k.clone(),out.relations.len());out.relations.push(PlannedRelationInput{source_kind:k.0,source_key:k.1,label:k.2,target_kind:k.3,target_key:k.4,attributes:vec![]});out.decisions.push(serde_json::json!({"valid":true,"decision":"accepted"}));}}
    if sources.len()!=1{return Err("手工映射来源必须全批唯一".into());}if out.relations.is_empty(){return Err("导入计划没有有效关系".into());}
    let origin_key=sources.into_iter().next().ok_or("缺少查询起点")?;
    out.query_origin=Some(QueryOriginInput{kind:sk.into(),key:origin_key.clone(),display_name:String::new()});
    if input.bridge_relation_count==1{
        let current=input.current_source.as_ref().ok_or("查询起点接入缺少当前选中对象")?;
        if !valid_manual_key(&current.kind,current.value.trim())&&current.kind!="subject"&&current.kind!="organization"&&!allowed_kind(&current.kind){return Err("接入对象类型无效".into());}
        if current.kind==sk&&current.value.trim()==origin_key{return Err("接入对象不能就是查询起点".into());}
    }
    Ok(out)
}

pub fn import_plan(mut input: ImportPlanInput) -> CoreResult<ImportPlanResult> {
    let manual = input.template_version == "manual-mapped-v1" || input.template_mode == "manual-mapped";
    let existing_qq_keys = if !manual && input.template == "qq-device" {
        let conn = open()?;
        let mut statement = conn.prepare("SELECT label FROM entities WHERE case_id=?1 AND kind='qq'").map_err(|e| e.to_string())?;
        let keys=statement.query_map(params![input.case_id], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?.collect::<Result<HashSet<_>,_>>().map_err(|e|e.to_string())?;
        keys
    } else { HashSet::new() };
    let rebuilt = if manual { rebuild_manual_plan(&input)? } else { rebuild_strict_plan(&input, &existing_qq_keys)? };
    let canonical_entity_count = rebuilt.entities.len() as i64;
    let canonical_relation_count = rebuilt.relations.len() as i64;
    if input.raw_row_count != rebuilt.decisions.len() as i64 || input.valid_row_count != rebuilt.decisions.len() as i64 || input.duplicate_relations != rebuilt.duplicates || input.relation_count != canonical_relation_count || input.entity_count != canonical_entity_count || input.row_decisions != rebuilt.decisions {
        return Err("前端导入计划摘要与后端重算不一致".into());
    }
    let canonical_entity_keys = rebuilt.entities.iter().map(|e| (e.kind.clone(), e.key.trim().to_string())).collect::<std::collections::HashSet<_>>();
    let canonical_relation_keys = rebuilt.relations.iter().map(|r| (r.source_kind.clone(), r.source_key.trim().to_string(), r.label.clone(), r.target_kind.clone(), r.target_key.trim().to_string())).collect::<std::collections::HashSet<_>>();
    let mut submitted_entities = input.entities.iter().filter(|e| canonical_entity_keys.contains(&(e.kind.clone(), e.key.trim().to_string()))).cloned().collect::<Vec<_>>();
    let mut submitted_relations = input.relations.iter().filter(|r| canonical_relation_keys.contains(&(r.source_kind.clone(), r.source_key.trim().to_string(), r.label.clone(), r.target_kind.clone(), r.target_key.trim().to_string()))).cloned().collect::<Vec<_>>();
    let mut canonical_entities = rebuilt.entities.clone();
    let mut canonical_relations = rebuilt.relations.clone();
    sort_planned_entities(&mut submitted_entities);
    sort_planned_entities(&mut canonical_entities);
    sort_planned_relations(&mut submitted_relations);
    sort_planned_relations(&mut canonical_relations);
    if submitted_entities != canonical_entities || submitted_relations != canonical_relations {
        return Err("前端关系、实体或属性与原始表格不一致".into());
    }
    if input.query_origin != rebuilt.query_origin { return Err("查询起点与原始表格及当前选择不一致".into()); }
    if !manual && input.template=="qq-device" && (input.overlap_candidates!=rebuilt.overlap_candidates || input.parent_selection_reason!=rebuilt.parent_selection_reason) { return Err("同机重合候选或本批父节点原因与案件数据不一致".into()); }
    let extra_entities = input.entities.iter().filter(|e| !canonical_entity_keys.contains(&(e.kind.clone(), e.key.trim().to_string()))).cloned().collect::<Vec<_>>();
    let extra_relations = input.relations.iter().filter(|r| !canonical_relation_keys.contains(&(r.source_kind.clone(), r.source_key.trim().to_string(), r.label.clone(), r.target_kind.clone(), r.target_key.trim().to_string()))).cloned().collect::<Vec<_>>();
    if input.bridge_relation_count == 0 && (!extra_entities.is_empty() || !extra_relations.is_empty()) { return Err("未明确启用查询起点接入却包含额外对象或关系".into()); }
    if input.bridge_relation_count == 1 {
        // 桥接实体可能与 canonical 实体重合（当前选中对象恰为本批结果之一）：此时前端只追加关系不重复追加实体（与 smart-table.ts withCurrentClueBridge 同步）
        if input.template=="qq-device" || extra_relations.len()!=1 || extra_entities.len()>1 { return Err("查询起点接入必须且仅能增加一条关系，最多一个对象".into()); }
        let bridge=&extra_relations[0]; let current=input.current_source.as_ref().ok_or("查询起点接入缺少当前选中对象")?; let origin=rebuilt.query_origin.as_ref().ok_or("缺少查询起点")?;
        if bridge.source_kind!=current.kind || bridge.source_key.trim()!=current.value.trim() || bridge.target_kind!=origin.kind || bridge.target_key.trim()!=origin.key || bridge.label!="查询号码" || !bridge.attributes.is_empty() { return Err("查询起点接入方向或标签不符合严格合同".into()); }
        if let Some(extra)=extra_entities.first() { if extra.kind!=current.kind || extra.key.trim()!=current.value.trim() { return Err("查询起点接入对象与当前选中对象不一致".into()); } }
    } else if input.bridge_relation_count != 0 { return Err("查询起点接入关系数量无效".into()); }
    input.entities = rebuilt.entities;
    input.relations = rebuilt.relations;
    input.entities.extend(extra_entities.clone());
    input.relations.extend(extra_relations);
    if manual {
        if input.error_count!=0||!input.batch_errors.is_empty(){return Err("手工映射存在行错误或批级错误".into());}
    } else {
        let (required, source_kind, target_kind, label, source_column, target_column)=strict_import_contract(&input.template).ok_or("导入模板无效或不再支持宽松模板")?;
        if input.template_version!="strict-v1"||!matches!(input.template_mode.as_str(),"strict-header"|"strict-positional"){return Err("仅接受 strict-v1 已验证合同".into());}
        let headers:HashSet<&str>=input.header_fingerprint.split('\u{1f}').collect();if required.iter().any(|c|!headers.contains(c)){return Err("严格导入缺少必需表头".into());}
        let endpoint=&input.endpoint_contract;if endpoint.get("sourceColumn").and_then(|v|v.as_str())!=Some(source_column)||endpoint.get("targetColumn").and_then(|v|v.as_str())!=Some(target_column)||endpoint.get("relationLabel").and_then(|v|v.as_str())!=Some(label){return Err("端点合同与模板不一致".into());}
        if input.relations.iter().filter(|r|r.label!="查询号码").any(|r|r.source_kind!=source_kind||r.target_kind!=target_kind||r.label!=label){return Err("关系端点、方向或标签不符合严格合同".into());}    }
    let accepted=input.row_decisions.iter().filter(|r|r.get("decision").and_then(|v|v.as_str())==Some("accepted")).count() as i64;let duplicate=input.row_decisions.iter().filter(|r|r.get("decision").and_then(|v|v.as_str())==Some("duplicate_merged")).count() as i64;
    if input.raw_row_count!=input.row_decisions.len() as i64||input.valid_row_count!=input.raw_row_count||input.duplicate_relations!=duplicate||input.relation_count!=accepted||input.relation_count as usize+input.bridge_relation_count as usize!=input.relations.len(){return Err("导入计划行、重复或关系摘要不一致".into());}
    let unique_entities=input.entities.iter().map(|e|(&e.kind,e.key.trim())).collect::<HashSet<_>>().len();
    // 桥接实体复用（当前选中对象已在 canonical 中）时 unique 数不加一；只有真实新增对象才 +1
    let bridge_entity_is_new = input.bridge_relation_count == 1 && extra_entities.len() == 1;
    let expected_unique = input.entity_count as usize + if bridge_entity_is_new { 1 } else { 0 };
    if expected_unique != unique_entities { return Err("导入计划对象摘要不一致".into()); }
    if input.entities.len() > 10000 || input.relations.len() > 10000 {
        return Err("单次最多导入 10000 个对象或关系".into());
    }
    if input.entities.is_empty() || input.relations.is_empty() {
        return Err("导入计划没有有效数据".into());
    }
    for entity in &input.entities {
        if !allowed_kind(&entity.kind) || entity.key.trim().is_empty() {
            return Err("导入计划包含无效对象主键".into());
        }
    }
    for relation in &input.relations {
        if !allowed_kind(&relation.source_kind)
            || !allowed_kind(&relation.target_kind)
            || relation.source_key.trim().is_empty()
            || relation.target_key.trim().is_empty()
            || relation.label.trim().is_empty()
        {
            return Err("导入计划包含无效关系".into());
        }
    }
    let history_payload = history_payload(&input.case_id)?;
    let mut conn = open()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    save_history_tx(&tx, &input.case_id, false, &history_payload)?;
    clear_redos_tx(&tx, &input.case_id)?;
    let timestamp = now();
    let batch_id = Uuid::new_v4().to_string();
    let mut ids: HashMap<(String, String), String> = HashMap::new();
    let (
        mut added_entities,
        mut reused_entities,
        mut added_relations,
        mut reused_relations,
        mut added_attributes,
        mut reused_attributes,
        mut updated_attributes,
    ) = (0, 0, 0, 0, 0, 0, 0);
    for entity in &input.entities {
        let key = entity.key.trim();
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM entities WHERE case_id=?1 AND kind=?2 AND label=?3",
                params![input.case_id, entity.kind, key],
                |r| r.get(0),
            )
            .ok();
        let id = existing
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        if existing.is_some() {
            reused_entities += 1;
            if !entity.display_name.trim().is_empty() {
                tx.execute("UPDATE entities SET display_name=CASE WHEN TRIM(display_name)='' THEN ?1 ELSE display_name END WHERE id=?2",params![entity.display_name.trim(),id]).map_err(|e|e.to_string())?;
            }
        } else {
            tx.execute(
                "INSERT INTO entities(id,case_id,kind,label,display_name) VALUES(?1,?2,?3,?4,?5)",
                params![
                    id,
                    input.case_id,
                    entity.kind,
                    key,
                    entity.display_name.trim()
                ],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO import_batch_entities(batch_id,entity_id) VALUES(?1,?2)",
                params![batch_id, id],
            )
            .map_err(|e| e.to_string())?;
            added_entities += 1;
        }
        ids.insert((entity.kind.clone(), key.into()), id.clone());
        for (index, a) in entity.attributes.iter().enumerate() {
            let (added, reused, updated) = import_plan_attribute(
                &tx,
                "entity_attributes",
                "import_batch_entity_attributes",
                &batch_id,
                &input.case_id,
                &id,
                a,
                index as i64,
                &timestamp,
            )?;
            added_attributes += added; reused_attributes += reused; updated_attributes += updated;
        }
    }
    for relation in &input.relations {
        let source = ids
            .get(&(
                relation.source_kind.clone(),
                relation.source_key.trim().into(),
            ))
            .ok_or("关系来源对象未包含在导入计划")?;
        let target = ids
            .get(&(
                relation.target_kind.clone(),
                relation.target_key.trim().into(),
            ))
            .ok_or("关系目标对象未包含在导入计划")?;
        let existing:Option<String>=tx.query_row("SELECT id FROM relations WHERE case_id=?1 AND source_id=?2 AND target_id=?3 AND label=?4",params![input.case_id,source,target,relation.label.trim()],|r|r.get(0)).ok();
        let relation_id = existing
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        if existing.is_some() {
            reused_relations += 1;
        } else {
            tx.execute("INSERT INTO relations(id,case_id,source_id,target_id,label,spread) VALUES(?1,?2,?3,?4,?5,'智能导入')",params![relation_id,input.case_id,source,target,relation.label.trim()]).map_err(|e|e.to_string())?;
            tx.execute(
                "INSERT INTO import_batch_relations(batch_id,relation_id) VALUES(?1,?2)",
                params![batch_id, relation_id],
            )
            .map_err(|e| e.to_string())?;
            added_relations += 1;
        }
        for (index, a) in relation.attributes.iter().enumerate() {
            let (added, reused, updated) = import_plan_attribute(
                &tx,
                "relation_attributes",
                "import_batch_relation_attributes",
                &batch_id,
                &input.case_id,
                &relation_id,
                a,
                index as i64,
                &timestamp,
            )?;
            added_attributes += added; reused_attributes += reused; updated_attributes += updated;
        }
    }
    let batch = ImportBatch {
        id: batch_id.clone(),
        case_id: input.case_id.clone(),
        source_id: String::new(),
        target_kind: "smart".into(),
        relation_label: "智能表格".into(),
        relation_spread: "智能导入".into(),
        relation_count: added_relations,
        source_summary: input.source_summary.trim().into(),
        created_at: timestamp,
    };
    tx.execute("INSERT INTO import_batches(id,case_id,source_id,target_kind,relation_label,relation_spread,relation_count,source_summary,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![batch.id,batch.case_id,batch.source_id,batch.target_kind,batch.relation_label,batch.relation_spread,batch.relation_count,batch.source_summary,batch.created_at]).map_err(|e|e.to_string())?;
    touch_tx(
        &tx,
        &input.case_id,
        "import_plan",
        &format!("智能导入新增 {added_entities} 个对象、{added_relations} 条关系"),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(ImportPlanResult {
        added_entities,
        reused_entities,
        added_relations,
        reused_relations,
        added_attributes,
        reused_attributes,
        updated_attributes,
        attribute_count: added_attributes + reused_attributes + updated_attributes,
        error_count: input.error_count,
        batch: Some(batch),
    })
}

pub fn list_import_batches(case_id: &str) -> CoreResult<Vec<ImportBatch>> {
    let conn = open()?;
    let mut statement = conn.prepare("SELECT id,case_id,source_id,target_kind,relation_label,relation_spread,relation_count,source_summary,created_at FROM import_batches WHERE case_id=?1 AND undone=0 ORDER BY created_at DESC,rowid DESC LIMIT 20").map_err(|e| e.to_string())?;
    let batches = statement
        .query_map([case_id], |row| {
            Ok(ImportBatch {
                id: row.get(0)?,
                case_id: row.get(1)?,
                source_id: row.get(2)?,
                target_kind: row.get(3)?,
                relation_label: row.get(4)?,
                relation_spread: row.get(5)?,
                relation_count: row.get(6)?,
                source_summary: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(batches)
}

pub fn undo_import_batch(case_id: &str, batch_id: &str) -> CoreResult<usize> {
    let conn = open()?;
    let batch_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM import_batches WHERE id=?1 AND case_id=?2 AND undone=0",
            params![batch_id, case_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if batch_exists != 1 {
        return Err("未找到可撤销的导入批次".into());
    }
    let latest_batch_id: String = conn
        .query_row(
            "SELECT id FROM import_batches WHERE case_id=?1 AND undone=0 ORDER BY created_at DESC,rowid DESC LIMIT 1",
            [case_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if latest_batch_id != batch_id {
        return Err("只能撤销最新活动导入批次".into());
    }
    drop(conn);
    save_history(case_id, false)?;
    clear_redos(case_id)?;
    let mut conn = open()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let updates = {
        let mut statement = tx.prepare("SELECT table_name,before_value FROM import_batch_attribute_updates WHERE batch_id=?1").map_err(|e| e.to_string())?;
        let rows = statement.query_map([batch_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        rows
    };
    for (table, value) in updates {
        if !matches!(table.as_str(), "entity_attributes" | "relation_attributes") { return Err("批次属性快照类型无效".into()); }
        let before: AttributeRecord = serde_json::from_str(&value).map_err(|e| e.to_string())?;
        tx.execute(
            &format!("UPDATE {table} SET value_type=?1,value_text=?2,value_number=?3,value_time=?4,sort_order=?5,created_at=?6,updated_at=?7 WHERE id=?8 AND case_id=?9"),
            params![before.value_type,before.value_text,before.value_number,before.value_time,before.sort_order,before.created_at,before.updated_at,before.id,case_id],
        ).map_err(|e| e.to_string())?;
    }
    tx.execute("DELETE FROM relation_attributes WHERE id IN (SELECT attribute_id FROM import_batch_relation_attributes WHERE batch_id=?1)", [batch_id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM entity_attributes WHERE id IN (SELECT attribute_id FROM import_batch_entity_attributes WHERE batch_id=?1)", [batch_id]).map_err(|e| e.to_string())?;
    tx.execute("UPDATE attachments SET relation_id=NULL WHERE case_id=?1 AND relation_id IN (SELECT relation_id FROM import_batch_relations WHERE batch_id=?2)", params![case_id, batch_id]).map_err(|e| e.to_string())?;
    let removed = tx.execute("DELETE FROM relations WHERE id IN (SELECT relation_id FROM import_batch_relations WHERE batch_id=?1)", [batch_id]).map_err(|e| e.to_string())?;
    tx.execute("UPDATE attachments SET entity_id=NULL WHERE case_id=?1 AND entity_id IN (SELECT entity_id FROM import_batch_entities WHERE batch_id=?2) AND NOT EXISTS (SELECT 1 FROM relations WHERE relations.case_id=?1 AND (relations.source_id=attachments.entity_id OR relations.target_id=attachments.entity_id))", params![case_id, batch_id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM entities WHERE case_id=?1 AND id IN (SELECT entity_id FROM import_batch_entities WHERE batch_id=?2) AND NOT EXISTS (SELECT 1 FROM relations WHERE relations.case_id=?1 AND (relations.source_id=entities.id OR relations.target_id=entities.id))", params![case_id, batch_id]).map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE import_batches SET undone=1 WHERE id=?1 AND case_id=?2",
        params![batch_id, case_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    touch(
        &conn,
        case_id,
        "undo_import_batch",
        &format!("撤销导入批次，删除 {removed} 条关联"),
    )?;
    Ok(removed)
}

fn save_history_tx(tx: &Transaction<'_>, case_id: &str, redo: bool, payload: &str) -> CoreResult<()> {
    if redo {
        tx.execute(
            "INSERT INTO case_redos(id,case_id,payload,created_at) VALUES(?1,?2,?3,?4)",
            params![Uuid::new_v4().to_string(), case_id, payload, now()],
        )
        .map_err(|e| e.to_string())?;
    } else {
        tx.execute("INSERT INTO case_snapshots(id,case_id,reason,payload,created_at) VALUES(?1,?2,'mutation',?3,?4)", params![Uuid::new_v4().to_string(), case_id, payload, now()]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn clear_redos_tx(tx: &Transaction<'_>, case_id: &str) -> CoreResult<()> {
    tx.execute("DELETE FROM case_redos WHERE case_id=?1", [case_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn history_payload(case_id: &str) -> CoreResult<String> {
    let conn = open()?;
    let mut statement = conn
        .prepare("SELECT id FROM import_batches WHERE case_id=?1 AND undone=0 ORDER BY rowid")
        .map_err(|e| e.to_string())?;
    let active_import_batch_ids = statement
        .query_map([case_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&HistorySnapshot {
        detail: get_case_detail(case_id)?,
        active_import_batch_ids: Some(active_import_batch_ids),
    })
    .map_err(|e| e.to_string())
}

fn save_history(case_id: &str, redo: bool) -> CoreResult<()> {
    let payload = history_payload(case_id)?;
    let mut conn = open()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    save_history_tx(&tx, case_id, redo, &payload)?;
    tx.commit().map_err(|e| e.to_string())
}

fn clear_redos(case_id: &str) -> CoreResult<()> {
    let mut conn = open()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    clear_redos_tx(&tx, case_id)?;
    tx.commit().map_err(|e| e.to_string())
}

fn restore_history(case_id: &str, redo: bool) -> CoreResult<HistoryRestoreResult> {
    let conn = open()?;
    let table = if redo { "case_redos" } else { "case_snapshots" };
    let row: Option<(String, String)> = conn.query_row(&format!("SELECT id,payload FROM {table} WHERE case_id=?1 ORDER BY created_at DESC,rowid DESC LIMIT 1"), [case_id], |row| Ok((row.get(0)?, row.get(1)?))).ok();
    let (snapshot_id, payload) = row.ok_or_else(|| {
        if redo {
            "没有可重做操作".to_string()
        } else {
            "没有可撤销操作".to_string()
        }
    })?;
    let snapshot: HistorySnapshot = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    save_history(case_id, !redo)?;
    let HistorySnapshot {
        detail: snapshot,
        active_import_batch_ids,
    } = snapshot;
    let entity_count = snapshot.entities.len();
    let relation_count = snapshot.relations.len();
    let mut write_conn = open()?;
    let tx = write_conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE attachments SET relation_id=NULL WHERE case_id=?1",
        [case_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE attachments SET entity_id=NULL WHERE case_id=?1",
        [case_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM relation_attributes WHERE case_id=?1",
        [case_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM entity_attributes WHERE case_id=?1", [case_id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM relations WHERE case_id=?1", [case_id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM entities WHERE case_id=?1", [case_id])
        .map_err(|e| e.to_string())?;
    for entity in snapshot.entities {
        tx.execute("INSERT INTO entities(id,case_id,kind,label,display_name,status,role,note,accent,pinned,custom_type) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)", params![entity.id,entity.case_id,entity.kind,entity.label,entity.display_name,entity.status,entity.role,entity.note,entity.accent,entity.pinned as i64,entity.custom_type]).map_err(|e| e.to_string())?;
    }
    for relation in snapshot.relations {
        tx.execute("INSERT INTO relations(id,case_id,source_id,target_id,label,spread,status,note,emphasis) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![relation.id,relation.case_id,relation.source_id,relation.target_id,relation.label,relation.spread,relation.status,relation.note,relation.emphasis as i64]).map_err(|e| e.to_string())?;
    }
    for attribute in snapshot.entity_attributes {
        insert_attribute_tx(&tx, "entity_attributes", &attribute, case_id)?;
    }
    for attribute in snapshot.relation_attributes {
        insert_attribute_tx(&tx, "relation_attributes", &attribute, case_id)?;
    }
    for attachment in snapshot.attachments {
        tx.execute(
            "UPDATE attachments SET entity_id=?1,relation_id=?2 WHERE id=?3 AND case_id=?4",
            params![attachment.entity_id, attachment.relation_id, attachment.id, case_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute("UPDATE cases SET root_id=?1,archive_folder=?2,background=?3,police_disposal=?4,current_status=?5,path_lanes=?6,updated_at=?7 WHERE id=?8", params![snapshot.root_id,snapshot.case.archive_folder,snapshot.case.background,snapshot.case.police_disposal,snapshot.case.current_status,snapshot.case.path_lanes,now(),case_id]).map_err(|e| e.to_string())?;
    tx.execute("UPDATE import_batches SET undone=1 WHERE case_id=?1", [case_id])
        .map_err(|e| e.to_string())?;
    if let Some(active_ids) = active_import_batch_ids {
        for batch_id in active_ids {
            tx.execute(
                "UPDATE import_batches SET undone=0 WHERE id=?1 AND case_id=?2",
                params![batch_id, case_id],
            )
            .map_err(|e| e.to_string())?;
        }
    } else {
        tx.execute(
            "UPDATE import_batches SET undone=0 WHERE case_id=?1 AND (EXISTS(SELECT 1 FROM import_batch_relations br JOIN relations r ON r.id=br.relation_id AND r.case_id=?1 WHERE br.batch_id=import_batches.id) OR EXISTS(SELECT 1 FROM import_batch_entities be JOIN entities e ON e.id=be.entity_id AND e.case_id=?1 WHERE be.batch_id=import_batches.id) OR EXISTS(SELECT 1 FROM import_batch_entity_attributes ba JOIN entity_attributes a ON a.id=ba.attribute_id AND a.case_id=?1 WHERE ba.batch_id=import_batches.id) OR EXISTS(SELECT 1 FROM import_batch_relation_attributes ba JOIN relation_attributes a ON a.id=ba.attribute_id AND a.case_id=?1 WHERE ba.batch_id=import_batches.id) OR EXISTS(SELECT 1 FROM import_batch_attribute_updates u LEFT JOIN entity_attributes ea ON u.table_name='entity_attributes' AND ea.id=u.attribute_id AND ea.case_id=?1 LEFT JOIN relation_attributes ra ON u.table_name='relation_attributes' AND ra.id=u.attribute_id AND ra.case_id=?1 WHERE u.batch_id=import_batches.id AND (ea.id IS NOT NULL OR ra.id IS NOT NULL)))",
            [case_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    let delete_conn = open()?;
    delete_conn
        .execute(&format!("DELETE FROM {table} WHERE id=?1"), [snapshot_id])
        .map_err(|e| e.to_string())?;
    touch(
        &delete_conn,
        case_id,
        if redo { "redo_case" } else { "undo_case" },
        "恢复案件图快照",
    )?;
    Ok(HistoryRestoreResult {
        entity_count,
        relation_count,
    })
}

pub fn undo_case(case_id: &str) -> CoreResult<HistoryRestoreResult> {
    restore_history(case_id, false)
}
pub fn redo_case(case_id: &str) -> CoreResult<HistoryRestoreResult> {
    restore_history(case_id, true)
}

pub fn delete_entity(case_id: &str, entity_id: &str) -> CoreResult<()> {
    let detail = get_case_detail(case_id)?;
    if detail.root_id == entity_id {
        return Err("主体簇不能删除；请先删除或归档整个案件".into());
    }
    if !detail.entities.iter().any(|entity| entity.id == entity_id) {
        return Err("未找到可删除对象".into());
    }
    save_history(case_id, false)?;
    clear_redos(case_id)?;
    let mut conn = open()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("UPDATE attachments SET relation_id=NULL WHERE case_id=?1 AND relation_id IN (SELECT id FROM relations WHERE case_id=?1 AND (source_id=?2 OR target_id=?2))", params![case_id, entity_id]).map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE attachments SET entity_id=NULL WHERE case_id=?1 AND entity_id=?2",
        params![case_id, entity_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM relations WHERE case_id=?1 AND (source_id=?2 OR target_id=?2)",
        params![case_id, entity_id],
    )
    .map_err(|e| e.to_string())?;
    let changed = tx
        .execute(
            "DELETE FROM entities WHERE case_id=?1 AND id=?2",
            params![case_id, entity_id],
        )
        .map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("删除对象失败".into());
    }
    tx.commit().map_err(|e| e.to_string())?;
    touch(&conn, case_id, "delete_entity", "删除对象及关联关系")
}

pub fn update_entity(entity: Entity) -> CoreResult<()> {
    save_history(&entity.case_id, false)?;
    clear_redos(&entity.case_id)?;
    let conn = open()?;
    let changed = conn.execute("UPDATE entities SET display_name=?1,status=?2,role=?3,note=?4,accent=?5,pinned=?6 WHERE id=?7 AND case_id=?8", params![entity.display_name,entity.status,entity.role,entity.note,entity.accent,entity.pinned as i64,entity.id,entity.case_id]).map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("未找到可更新对象".into());
    }
    touch(&conn, &entity.case_id, "update_entity", "更新对象标注")
}

pub fn update_relation(relation: Relation) -> CoreResult<()> {
    save_history(&relation.case_id, false)?;
    clear_redos(&relation.case_id)?;
    let conn = open()?;
    let changed = conn.execute("UPDATE relations SET label=?1,spread=?2,status=?3,note=?4,emphasis=?5 WHERE id=?6 AND case_id=?7", params![relation.label, relation.spread, relation.status, relation.note, relation.emphasis as i64, relation.id, relation.case_id]).map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("未找到可更新关系".into());
    }
    touch(&conn, &relation.case_id, "update_relation", "更新关系标注")
}

pub fn update_case_overview(input: CaseOverviewInput) -> CoreResult<()> {
    save_history(&input.id, false)?;
    clear_redos(&input.id)?;
    let lanes: Vec<String> = input
        .path_lanes
        .into_iter()
        .map(|lane| lane.trim().to_string())
        .filter(|lane| !lane.is_empty())
        .collect();
    let path_lanes = serde_json::to_string(&lanes).map_err(|e| e.to_string())?;
    let conn = open()?;
    let changed = conn.execute("UPDATE cases SET background=?1,police_disposal=?2,current_status=?3,path_lanes=?4 WHERE id=?5", params![input.background.trim(),input.police_disposal.trim(),input.current_status.trim(),path_lanes,input.id]).map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("未找到可更新案件".into());
    }
    touch(
        &conn,
        &input.id,
        "update_case_overview",
        "更新案件概览与路径分栏",
    )
}

pub fn archive_case(
    id: &str,
    archive_title: &str,
    note: &str,
    folder_id: Option<&str>,
) -> CoreResult<()> {
    let conn = open()?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let folder_name: Option<String> = match folder_id.filter(|value| !value.trim().is_empty()) {
        Some(folder_id) => Some(
            tx.query_row(
                "SELECT name FROM archive_folders WHERE id=?1",
                [folder_id],
                |r| r.get(0),
            )
            .map_err(|_| "找不到归档文件夹".to_string())?,
        ),
        None => None,
    };
    let changed = tx.execute("UPDATE cases SET status='archived',archive_title=?1,archive_folder=?2,archive_folder_id=?3,archive_note=?4,archived_at=?5,updated_at=?5 WHERE id=?6 AND status!='trash'", params![archive_title.trim(),folder_name.as_deref().unwrap_or(""),folder_id.filter(|value| !value.trim().is_empty()),note.trim(),now(),id]).map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("未找到可归档案件".into());
    }
    touch_tx(&tx, id, "archive_case", "归档案件")?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn restore_case(id: &str) -> CoreResult<()> {
    let conn = open()?;
    let changed = conn.execute(
        "UPDATE cases SET status='active',trashed_at=NULL,archive_title=NULL,archive_folder='',archive_folder_id=NULL,archive_note='',archived_at=NULL,updated_at=?1 WHERE id=?2",
        params![now(), id],
    )
    .map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("未找到可恢复案件".into());
    }
    touch(&conn, id, "restore_case", "恢复案件")
}

pub fn trash_case(id: &str) -> CoreResult<()> {
    let conn = open()?;
    let changed = conn.execute(
        "UPDATE cases SET status='trash',trashed_at=?1,archive_title=NULL,archive_folder='',archive_folder_id=NULL,archive_note='',archived_at=NULL,updated_at=?1 WHERE id=?2",
        params![now(), id],
    )
    .map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("未找到可移入回收站案件".into());
    }
    touch(&conn, id, "trash_case", "移入回收站")
}

pub fn permanently_delete_case(id: &str, confirmed_title: &str) -> CoreResult<()> {
    let mut conn=open()?;
    let title:String=conn.query_row("SELECT title FROM cases WHERE id=?1 AND status='trash'",[id],|row|row.get(0)).map_err(|_|"只能永久删除回收站内案件".to_string())?;
    if title!=confirmed_title{return Err("案件名称不匹配".into());}
    let attachment_dir=data_root()?.join("attachments").join(id);
    let staged_dir=attachment_dir.with_extension(format!("delete-{}",Uuid::new_v4()));
    if attachment_dir.exists(){fs::rename(&attachment_dir,&staged_dir).map_err(|e|format!("无法暂存案件附件：{e}"))?;}
    let result:CoreResult<()>= (||{let tx=conn.transaction().map_err(|e|e.to_string())?;
        for table in ["import_batch_relations","import_batch_entities","import_batch_entity_attributes","import_batch_relation_attributes","import_batch_attribute_updates"] {tx.execute(&format!("DELETE FROM {table} WHERE batch_id IN (SELECT id FROM import_batches WHERE case_id=?1)"),[id]).map_err(|e|e.to_string())?;}
        for table in ["attachments","relation_attributes","entity_attributes","relations","entities","import_batches","case_operations","case_snapshots","case_redos","cases"] {tx.execute(&format!("DELETE FROM {table} WHERE {}=?1",if table=="cases"{"id"}else{"case_id"}),[id]).map_err(|e|e.to_string())?;}
        tx.commit().map_err(|e|e.to_string())?;Ok(())})();
    if result.is_err()&&staged_dir.exists(){let _=fs::rename(&staged_dir,&attachment_dir);}
    result?;
    if staged_dir.exists()&&fs::remove_dir_all(&staged_dir).is_err(){let cleanup_conn=open()?;cleanup_conn.execute("INSERT OR IGNORE INTO attachment_cleanup(path,created_at) VALUES(?1,?2)",params![staged_dir.to_string_lossy(),now()]).map_err(|e|e.to_string())?;}
    Ok(())
}

// v1 导出死代码清理（0.7.16）：以下两个转义工具不再被活代码调用，保留供单测守护
// 与未来导出格式复用（csv 防 Excel 公式注入，xml 防注入与非法控制字符）。
#[allow(dead_code)]
fn xml(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .filter(|&c| {
            matches!(c, '\t' | '\n' | '\r')
                || ('\u{20}'..='\u{D7FF}').contains(&c)
                || ('\u{E000}'..='\u{FFFD}').contains(&c)
                || c >= '\u{10000}'
        })
        .collect();
    cleaned
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[allow(dead_code)]
fn csv(text: &str) -> String {
    let safe = if matches!(
        text.trim_start().chars().next(),
        Some('=' | '+' | '-' | '@')
    ) {
        format!("'{text}")
    } else {
        text.to_owned()
    };
    format!("\"{}\"", safe.replace('"', "\"\""))
}

fn validate_package_manifest(package_path: &Path) -> CoreResult<()> {
    let Some(parent) = package_path.parent() else {
        return Ok(());
    };
    let manifest_path = parent.join("manifest.json");
    if !manifest_path.is_file() {
        return Ok(());
    }
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(&manifest_path).map_err(|e| format!("无法读取 manifest：{e}"))?,
    )
    .map_err(|e| format!("manifest 格式无效：{e}"))?;
    let expected = manifest
        .get("files")
        .and_then(|files| files.as_array())
        .and_then(|files| {
            files
                .iter()
                .find(|file| file.get("path").and_then(|path| path.as_str()) == Some("案件包.json"))
        })
        .and_then(|file| file.get("sha256"))
        .and_then(|hash| hash.as_str())
        .ok_or("manifest 缺少案件包.json 的 SHA-256 校验值")?;
    let actual = sha256(&fs::read(package_path).map_err(|e| format!("无法读取案件包：{e}"))?);
    if expected != actual {
        return Err("案件包 SHA-256 校验失败，已拒绝导入".into());
    }
    Ok(())
}

fn attachment_relative_path(
    case_id: &str,
    attachment_id: &str,
    extension: Option<&str>,
) -> CoreResult<PathBuf> {
    if Uuid::parse_str(case_id).is_err() || Uuid::parse_str(attachment_id).is_err() {
        return Err("附件路径标识无效".into());
    }
    let name = match extension.filter(|value| !value.is_empty()) {
        Some(value) => format!("{attachment_id}.{value}"),
        None => attachment_id.to_string(),
    };
    Ok(PathBuf::from(case_id).join(name))
}

fn safe_attachment_path(relative_path: &str) -> CoreResult<PathBuf> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err("附件路径不安全".into());
    }
    let path = data_root()?.join("attachments").join(relative);
    if !path.starts_with(data_root()?.join("attachments")) {
        return Err("附件路径越界".into());
    }
    Ok(path)
}

fn mime_type_for(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "txt" | "log" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _ => "application/octet-stream",
    }
    .into()
}

fn sha256_file(path: &Path) -> CoreResult<String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(sha256(&bytes))
}

pub fn add_attachment(
    case_id: &str,
    source_path: &str,
    note: &str,
    entity_id: Option<&str>,
    relation_id: Option<&str>,
) -> CoreResult<Attachment> {
    let source = Path::new(source_path);
    if !source.is_absolute() || !source.is_file() {
        return Err("请选择一个可读取的本地文件".into());
    }
    let source_size = fs::metadata(source)
        .map_err(|e| format!("无法读取附件大小：{e}"))?
        .len();
    if source_size > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "附件超过 {} MB 上限，请压缩或拆分后再固定",
            MAX_ATTACHMENT_BYTES / 1024 / 1024
        ));
    }
    let conn = open()?;
    case_record(&conn, case_id)?;
    if let Some(entity_id) = entity_id.filter(|value| !value.trim().is_empty()) {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM entities WHERE id=?1 AND case_id=?2",
                params![entity_id, case_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists == 0 {
            return Err("关联对象不属于当前案件".into());
        }
    }
    if let Some(relation_id) = relation_id.filter(|value| !value.trim().is_empty()) {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM relations WHERE id=?1 AND case_id=?2",
                params![relation_id, case_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists == 0 {
            return Err("关联关系不属于当前案件".into());
        }
    }
    let id = Uuid::new_v4().to_string();
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| value.len() <= 16 && value.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|value| value.to_ascii_lowercase());
    let relative = attachment_relative_path(case_id, &id, extension.as_deref())?;
    let destination = safe_attachment_path(relative.to_str().ok_or("附件路径编码无效")?)?;
    fs::create_dir_all(destination.parent().ok_or("附件目录无效")?).map_err(|e| e.to_string())?;
    fs::copy(source, &destination).map_err(|e| e.to_string())?;
    let result: CoreResult<Attachment> = (|| {
        let metadata = fs::metadata(&destination).map_err(|e| e.to_string())?;
        let attachment = Attachment {
            id,
            case_id: case_id.into(),
            original_name: source
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or("文件名无效")?
                .into(),
            relative_path: relative.to_string_lossy().into(),
            sha256: sha256_file(&destination)?,
            mime_type: mime_type_for(source),
            size_bytes: metadata.len() as i64,
            collected_at: now(),
            note: note.trim().into(),
            entity_id: entity_id
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string),
            relation_id: relation_id
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string),
            created_at: now(),
        };
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO attachments(id,case_id,original_name,relative_path,sha256,mime_type,size_bytes,collected_at,note,entity_id,relation_id,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)", params![attachment.id,attachment.case_id,attachment.original_name,attachment.relative_path,attachment.sha256,attachment.mime_type,attachment.size_bytes,attachment.collected_at,attachment.note,attachment.entity_id,attachment.relation_id,attachment.created_at]).map_err(|e| e.to_string())?;
        touch_tx(&tx, case_id, "add_attachment", "添加案件附件")?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(attachment)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&destination);
    }
    result
}

pub fn attachment_path(case_id: &str, attachment_id: &str) -> CoreResult<PathBuf> {
    let conn = open()?;
    case_record(&conn, case_id)?;
    let relative: String = conn
        .query_row(
            "SELECT relative_path FROM attachments WHERE id=?1 AND case_id=?2",
            params![attachment_id, case_id],
            |row| row.get(0),
        )
        .map_err(|_| "附件不存在".to_string())?;
    let path = safe_attachment_path(&relative)?;
    if !path.is_file() {
        return Err("附件本地副本不存在".into());
    }
    let root = data_root()?.join("attachments").canonicalize().map_err(|e| e.to_string())?;
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(root) {
        return Err("附件路径越界".into());
    }
    Ok(canonical)
}

pub fn update_attachment_note(case_id: &str, attachment_id: &str, note: &str) -> CoreResult<()> {
    let mut conn = open()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let count = tx
        .execute(
            "UPDATE attachments SET note=?1 WHERE id=?2 AND case_id=?3",
            params![note.trim(), attachment_id, case_id],
        )
        .map_err(|e| e.to_string())?;
    if count == 0 {
        return Err("附件不存在".into());
    }
    touch_tx(&tx, case_id, "update_attachment_note", "更新附件说明")?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_attachment(case_id: &str, attachment_id: &str) -> CoreResult<()> {
    let mut conn = open()?;
    let relative: String = conn
        .query_row(
            "SELECT relative_path FROM attachments WHERE id=?1 AND case_id=?2",
            params![attachment_id, case_id],
            |row| row.get(0),
        )
        .map_err(|_| "附件不存在".to_string())?;
    let path = safe_attachment_path(&relative)?;
    let staged = path.with_extension(format!("delete-{}", Uuid::new_v4()));
    if path.exists() {
        fs::rename(&path, &staged).map_err(|e| e.to_string())?;
    }
    let result: CoreResult<()> = (|| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM attachments WHERE id=?1 AND case_id=?2",
            params![attachment_id, case_id],
        )
        .map_err(|e| e.to_string())?;
        touch_tx(&tx, case_id, "delete_attachment", "删除案件附件")?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() && staged.exists() {
        let _ = fs::rename(&staged, &path);
    }
    result?;
    if staged.exists() && fs::remove_file(&staged).is_err() {
        let cleanup_conn = open()?;
        cleanup_conn
            .execute(
                "INSERT OR IGNORE INTO attachment_cleanup(path,created_at) VALUES(?1,?2)",
                params![staged.to_string_lossy(), now()],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut data = bytes.to_vec();
    let bit_len = (data.len() as u64) * 8;
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&bit_len.to_be_bytes());
    let mut h = [
        0x6a09e667u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];
    for chunk in data.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes(chunk[i * 4..i * 4 + 4].try_into().unwrap());
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }
    h.iter().map(|value| format!("{value:08x}")).collect()
}

#[derive(Serialize, Deserialize)]
struct PackageManifest {
    format: String,
    version: u32,
    files: Vec<PackageFile>,
}
#[derive(Serialize, Deserialize)]
struct PackageFile {
    path: String,
    sha256: String,
    size_bytes: u64,
}

fn safe_package_name(name: &str) -> CoreResult<()> {
    let path = Path::new(name);
    if name.is_empty()
        || path.is_absolute()
        || path.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("案件包包含不安全路径".into());
    }
    if !V2_PACKAGE_FILES.contains(&name)
        && !(name.starts_with("attachments/")
            && name[12..]
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_'))
    {
        return Err("案件包包含不允许的文件".into());
    }
    Ok(())
}

fn read_v2_package(path: &Path) -> CoreResult<(HashMap<String, Vec<u8>>, u32)> {
    let file = fs::File::open(path).map_err(|e| format!("无法读取案件包：{e}"))?;
    let mut zip = ZipArchive::new(file).map_err(|e| format!("案件包不是有效 ZIP：{e}"))?;
    if zip.len() > MAX_PACKAGE_FILES {
        return Err("案件包文件数量超限".into());
    }
    let mut total = 0u64;
    let mut files = HashMap::new();
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        safe_package_name(&name)?;
        if entry.is_dir()
            || entry.size() > MAX_PACKAGE_FILE_BYTES
            || entry
                .unix_mode()
                .map(|mode| mode & 0o170000 == 0o120000)
                .unwrap_or(false)
        {
            return Err("案件包包含不安全或过大的条目".into());
        }
        total = total.checked_add(entry.size()).ok_or("案件包大小无效")?;
        if total > MAX_PACKAGE_TOTAL_BYTES {
            return Err("案件包解压总大小超限".into());
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if files.insert(name, bytes).is_some() {
            return Err("案件包包含重复文件".into());
        }
    }
    for required in V2_PACKAGE_FILES {
        if !files.contains_key(required) {
            return Err(format!("案件包缺少 {required}"));
        }
    }
    let manifest: PackageManifest = serde_json::from_slice(files.get("manifest.json").unwrap())
        .map_err(|e| format!("manifest 格式无效：{e}"))?;
    if manifest.format != "clue-workbench-case" || !matches!(manifest.version, 2 | 3) {
        return Err("不是受支持的 v2/v3 案件包".into());
    }
    let actual: HashSet<&str> = files
        .keys()
        .filter(|name| name.as_str() != "manifest.json")
        .map(String::as_str)
        .collect();
    let mut listed = HashSet::new();
    for item in &manifest.files {
        safe_package_name(&item.path)?;
        if item.path == "manifest.json" || !listed.insert(item.path.as_str()) {
            return Err("manifest 包含重复或非法路径".into());
        }
        let bytes = files.get(&item.path).ok_or("manifest 引用了不存在的文件")?;
        if item.size_bytes != bytes.len() as u64 || item.sha256 != sha256(bytes) {
            return Err(format!("案件包校验失败：{}", item.path));
        }
    }
    if listed != actual {
        return Err("manifest 文件清单与案件包内容不完全一致".into());
    }
    let version = manifest.version;
    Ok((files, version))
}

fn safe_export_title(title: &str) -> String {
    let value: String = title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if value.trim_matches('_').is_empty() {
        "案件".into()
    } else {
        value
    }
}

fn entity_name(entity: &Entity) -> &str {
    if entity.display_name.trim().is_empty() {
        &entity.label
    } else {
        &entity.display_name
    }
}

fn entity_kind_label(kind: &str) -> &str {
    match kind {
        "subject" => "主体簇",
        "wechat" => "微信号",
        "qq" => "QQ号",
        "phone" => "手机号",
        "ip" => "IP",
        "location" => "活跃位置",
        "datacenter" => "机房信息",
        "device" => "设备",
        "group" => "群聊",
        "platform" => "平台账号",
        "organization" => "个人/团伙",
        _ => "自定义对象",
    }
}

fn text_or_unknown(text: &str) -> &str {
    if text.trim().is_empty() {
        "未填写"
    } else {
        text
    }
}

fn markdown_escape(text: &str) -> String {
    text.replace('\r', "").replace('\n', " ")
}

fn markdown_table_cell(text: &str) -> String {
    markdown_escape(text).replace('|', "\\|")
}

fn attribute_field_label(field_key: &str) -> &str {
    match field_key {
        "group_name" => "群名称", "member_count" => "群人数", "last_message_at" => "最后消息时间",
        "created_at" => "创建时间", "description" => "简介", "announcement" => "公告",
        "query_role" => "查询人角色", "group_remark" => "群备注", "nickname" => "昵称",
        "friend_group" => "好友分组", "friend_remark" => "好友备注", "registration" => "注册地",
        "account_status" => "账号状态", "risk_status" => "风险状态", "similarity" => "相似度",
        "device_signal" => "同机说明", "phone_type" => "手机号类型", "set_at" => "设置时间",
        "modified_at" => "修改时间", "verified_at" => "验证时间", "title" => "标题",
        "display_name" => "显示名称", "platform" => "平台", "organization_name" => "组织名称",
        "model" => "型号", "device_id" => "设备标识", "ip_address" => "IP 地址",
        _ => field_key,
    }
}

fn attribute_display_value(attribute: &AttributeRecord) -> String {
    match attribute.value_type.as_str() {
        "number" => attribute
            .value_number
            .map(|v| v.to_string())
            .unwrap_or_default(),
        "datetime" => attribute
            .value_time
            .clone()
            .unwrap_or_else(|| attribute.value_text.clone()),
        _ => attribute.value_text.clone(),
    }
}

fn key_attribute_notes(attributes: &[AttributeRecord], subject_id: &str) -> String {
    attributes
        .iter()
        .filter(|item| item.subject_id == subject_id)
        .take(5)
        .map(|item| format!("{}：{}", attribute_field_label(&item.field_key), attribute_display_value(item)))
        .collect::<Vec<_>>()
        .join("\n")
}

fn xmind_sidecar_dir() -> CoreResult<PathBuf> {
    // node 可执行文件名：Windows 为 node.exe，其他平台为 node
    #[cfg(target_os = "windows")]
    let node_name = "node.exe";
    #[cfg(not(target_os = "windows"))]
    let node_name = "node";
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("CLUE_WORKBENCH_XMIND_SIDECAR") {
        candidates.push(PathBuf::from(path));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/xmind"));
    if let Ok(exe) = env::current_exe() {
        if let Some(mac_os) = exe.parent() {
            if let Some(contents) = mac_os.parent() {
                // macOS 包结构：Contents/Resources/resources/xmind
                candidates.push(contents.join("Resources/resources/xmind"));
            }
        }
        // Windows NSIS/MSI 安装结构：<安装目录>\resources\xmind（exe 同级或 resources 子目录）
        #[cfg(target_os = "windows")]
        {
            if let Some(install_dir) = exe.parent() {
                candidates.push(install_dir.join("resources").join("xmind"));
                if let Some(parent) = install_dir.parent() {
                    candidates.push(parent.join("resources").join("xmind"));
                }
            }
        }
    }
    candidates
        .into_iter()
        .find(|dir| dir.join(node_name).is_file() && dir.join("export-xmind.cjs").is_file())
        .ok_or_else(|| "XMind 官方生成组件未随应用安装，请使用最新安装包".into())
}

fn xmind_visible_text(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | '&' | '=') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let normalized = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    match normalized.as_str() {
        "" | "undefined" | "null" => "未填写".into(),
        _ => normalized,
    }
}

fn xmind_entity_note(entity: &Entity) -> String {
    format!(
        "对象 ID：{}\n原始标签：{}\n对象类型：{}\n自定义类型：{}\n颜色：{}\n状态：{}\n角色：{}\n备注：{}",
        entity.id,
        entity.label,
        entity_kind_label(&entity.kind),
        text_or_unknown(&entity.custom_type),
        text_or_unknown(&entity.accent),
        text_or_unknown(&entity.status),
        text_or_unknown(&entity.role),
        text_or_unknown(&entity.note),
    )
}

fn xmind_entity_title(entity: &Entity) -> String {
    // 主体簇名称本身已含类型，避免导出为“主体簇 · 主体簇 · …”。
    let title = if entity.kind == "subject" {
        entity_name(entity).to_string()
    } else {
        format!("{} · {}", entity_kind_label(&entity.kind), entity_name(entity))
    };
    xmind_visible_text(&format!("{}{}", title, if entity.pinned { " ◆ 重点" } else { "" }))
}

fn xmind_relation_node(relation: &Relation, target_node: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "id": format!("relation_{}", relation.id),
        "title": xmind_visible_text(&format!("{}{}", text_or_unknown(&relation.label), if relation.emphasis { " ◆ 重点" } else { "" })),
        "note": format!("关系 ID：{}\n源对象：{}\n目标对象：{}\n标签：{}\n范围：{}\n状态：{}\n备注：{}", relation.id, relation.source_id, relation.target_id, text_or_unknown(&relation.label), text_or_unknown(&relation.spread), text_or_unknown(&relation.status), text_or_unknown(&relation.note)),
        "children": [target_node]
    })
}

fn xmind_entity_node(
    entity_id: &str,
    entities: &HashMap<&str, &Entity>,
    outgoing: &HashMap<&str, Vec<&Relation>>,
    expanded: &mut HashSet<String>,
    emitted_relations: &mut HashSet<String>,
    ancestors: &mut Vec<String>,
) -> serde_json::Value {
    let entity = entities.get(entity_id).expect("实体必须存在");
    expanded.insert(entity_id.to_string());
    ancestors.push(entity_id.to_string());
    let mut children = Vec::new();
    for relation in outgoing.get(entity_id).into_iter().flatten() {
        if !emitted_relations.insert(relation.id.clone()) {
            continue;
        }
        let target_node = match entities.get(relation.target_id.as_str()) {
            None => serde_json::json!({
                "id": format!("missing_target_{}", relation.id),
                "title": "缺失目标对象",
                "note": format!("目标对象 ID：{}", relation.target_id),
                "children": []
            }),
            Some(target) if ancestors.iter().any(|id| id == &relation.target_id) => {
                serde_json::json!({
                    "id": format!("cycle_reference_{}", relation.id),
                    "title": xmind_visible_text(&format!("↻ 环引用：{}", entity_name(target))),
                    "note": format!("对象 ID：{}\n说明：当前祖先链已出现该对象，停止展开", target.id),
                    "children": []
                })
            }
            Some(target) if expanded.contains(&relation.target_id) => serde_json::json!({
                "id": format!("reference_{}", relation.id),
                "title": xmind_visible_text(&format!("↗ 引用：{}", entity_name(target))),
                "note": format!("对象 ID：{}\n说明：该对象已在首次出现处展开", target.id),
                "children": []
            }),
            Some(_) => xmind_entity_node(
                &relation.target_id,
                entities,
                outgoing,
                expanded,
                emitted_relations,
                ancestors,
            ),
        };
        children.push(xmind_relation_node(relation, target_node));
    }
    ancestors.pop();
    serde_json::json!({
        "id": format!("entity_{}", entity.id),
        "title": xmind_entity_title(entity),
        "note": xmind_entity_note(entity),
        "children": children
    })
}

fn append_xmind_attribute_notes(node: &mut serde_json::Value, detail: &CaseDetail) {
    if let Some(id) = node.get("id").and_then(|value| value.as_str()) {
        let notes = if let Some(subject_id) = id.strip_prefix("entity_") {
            key_attribute_notes(&detail.entity_attributes, subject_id)
        } else if let Some(subject_id) = id.strip_prefix("relation_") {
            key_attribute_notes(&detail.relation_attributes, subject_id)
        } else {
            String::new()
        };
        if !notes.is_empty() {
            if let Some(note) = node.get_mut("note") {
                let current = note.as_str().unwrap_or_default();
                *note = serde_json::Value::String(format!("{current}\n关键属性：\n{notes}"));
            }
        }
    }
    if let Some(children) = node
        .get_mut("children")
        .and_then(|value| value.as_array_mut())
    {
        for child in children {
            append_xmind_attribute_notes(child, detail);
        }
    }
}

fn write_xmind(detail: &CaseDetail, path: &Path) -> CoreResult<()> {
    let entities: HashMap<&str, &Entity> = detail
        .entities
        .iter()
        .map(|entity| (entity.id.as_str(), entity))
        .collect();
    let mut outgoing: HashMap<&str, Vec<&Relation>> = HashMap::new();
    for relation in &detail.relations {
        outgoing
            .entry(relation.source_id.as_str())
            .or_default()
            .push(relation);
    }
    let mut expanded = HashSet::new();
    let mut emitted_relations = HashSet::new();
    let mut branches = Vec::new();
    if entities.contains_key(detail.root_id.as_str()) {
        branches.push(xmind_entity_node(
            &detail.root_id,
            &entities,
            &outgoing,
            &mut expanded,
            &mut emitted_relations,
            &mut vec![],
        ));
    }
    let mut disconnected = Vec::new();
    for entity in &detail.entities {
        if !expanded.contains(&entity.id) {
            disconnected.push(xmind_entity_node(
                &entity.id,
                &entities,
                &outgoing,
                &mut expanded,
                &mut emitted_relations,
                &mut vec![],
            ));
        }
    }
    for relation in &detail.relations {
        if emitted_relations.insert(relation.id.clone()) {
            let target_node = entities.get(relation.target_id.as_str()).map(|target| serde_json::json!({
                "id": format!("reference_{}", relation.id), "title": xmind_visible_text(&format!("引用对象：[{}] {}", entity_kind_label(&target.kind), entity_name(target))), "note": format!("对象 ID：{}\n引用说明：关系源对象缺失，未展开", target.id), "children": []
            })).unwrap_or_else(|| serde_json::json!({"id": format!("missing_target_{}", relation.id), "title": "缺失目标对象", "note": format!("目标对象 ID：{}", relation.target_id), "children": []}));
            disconnected.push(serde_json::json!({"id": format!("missing_source_{}", relation.id), "title": "缺失源对象", "note": format!("源对象 ID：{}", relation.source_id), "children": [xmind_relation_node(relation, target_node)]}));
        }
    }
    if !disconnected.is_empty() {
        branches.push(serde_json::json!({"id": "unconnected_objects", "title": "未连接对象", "note": "不从根对象经有向关系可达的对象或分量", "children": disconnected}));
    }
    for branch in &mut branches {
        append_xmind_attribute_notes(branch, detail);
    }
    let input = serde_json::json!({
        "format": "clue-workbench-xmind",
        "version": 1,
        "case": { "title": xmind_visible_text(&detail.case.title) },
        "branches": branches
    });
    let sidecar = xmind_sidecar_dir()?;
    let input_path = path.with_extension(format!("{}.json", Uuid::new_v4()));
    let temp_path = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    fs::write(
        &input_path,
        serde_json::to_vec(&input).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("无法准备 XMind 数据：{e}"))?;
    #[cfg(target_os = "windows")]
    let node_executable = sidecar.join("node.exe");
    #[cfg(not(target_os = "windows"))]
    let node_executable = sidecar.join("node");
    let result = std::process::Command::new(node_executable)
        .arg(sidecar.join("export-xmind.cjs"))
        .arg(&input_path)
        .arg(&temp_path)
        .output()
        .map_err(|e| format!("无法启动 XMind 官方生成组件：{e}"));
    let _ = fs::remove_file(&input_path);
    let output = result?;
    if !output.status.success() {
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "XMind 官方生成失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let mut zip = ZipArchive::new(fs::File::open(&temp_path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("XMind 官方生成文件无效：{e}"))?;
    for entry in [
        "content.json",
        "content.xml",
        "metadata.json",
        "manifest.json",
    ] {
        zip.by_name(entry)
            .map_err(|_| format!("XMind 官方生成文件缺少 {entry}"))?;
    }
    drop(zip);
    fs::rename(&temp_path, path).map_err(|e| format!("无法完成 XMind 导出：{e}"))
}

fn write_markdown(detail: &CaseDetail, path: &Path) -> CoreResult<()> {
    let entities: HashMap<&str, &Entity> = detail
        .entities
        .iter()
        .map(|entity| (entity.id.as_str(), entity))
        .collect();
    let root = entities
        .get(detail.root_id.as_str())
        .map(|entity| entity_name(entity))
        .unwrap_or("未找到初始线索");
    let mut entity_counts = HashMap::<String, usize>::new();
    for entity in &detail.entities { *entity_counts.entry(entity_kind_label(&entity.kind).to_string()).or_default() += 1; }
    let mut relation_counts = HashMap::<String, usize>::new();
    for relation in &detail.relations { *relation_counts.entry(text_or_unknown(&relation.label).to_string()).or_default() += 1; }
    let mut entity_summary = entity_counts.into_iter().collect::<Vec<_>>();
    entity_summary.sort_by(|a,b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let mut relation_summary = relation_counts.into_iter().collect::<Vec<_>>();
    relation_summary.sort_by(|a,b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let entity_summary = entity_summary.into_iter().map(|(label,count)| format!("{} {}", markdown_escape(&label), count)).collect::<Vec<_>>().join("；");
    let relation_summary = relation_summary.into_iter().map(|(label,count)| format!("{} {}", markdown_escape(&label), count)).collect::<Vec<_>>().join("；");
    let mut output = format!("---\ntitle: \"{}\"\nexported_at: \"{}\"\nformat: \"clue-workbench-ai-readable-v1\"\nentity_count: {}\nrelation_count: {}\nattachment_count: {}\n---\n\n# {}：案情说明\n\n> 本文档仅转述软件中已录入信息；状态、备注及“待核实”均非事实确认。\n\n## 案件背景\n{}\n\n## 处置情况\n{}\n\n## 当前现状\n{}\n\n## 摘要\n- 起始线索：{}\n- 已录入对象：{} 个；关系：{} 条；附件：{} 个。\n- 对象类型：{}。\n- 关系类型：{}。\n- 关系、备注和状态均保留其原始语义，不将推测表述为事实。\n\n## 主结构\n", markdown_escape(&detail.case.title), now(), detail.entities.len(), detail.relations.len(), detail.attachments.len(), markdown_escape(&detail.case.title), markdown_escape(text_or_unknown(&detail.case.background)), markdown_escape(text_or_unknown(&detail.case.police_disposal)), markdown_escape(text_or_unknown(&detail.case.current_status)), markdown_escape(root), detail.entities.len(), detail.relations.len(), detail.attachments.len(), entity_summary, relation_summary);
    for entity in &detail.entities {
        let priority = if entity.pinned { "；重点" } else { "" };
        output.push_str(&format!(
            "- [{}] {}（状态：{}；角色：{}{}）\n",
            entity_kind_label(&entity.kind),
            markdown_escape(entity_name(entity)),
            markdown_escape(text_or_unknown(&entity.status)),
            markdown_escape(text_or_unknown(&entity.role)),
            priority
        ));
    }
    output.push_str("\n## 重点与待核实\n");
    let mut findings = Vec::new();
    for entity in &detail.entities {
        if entity.pinned || entity.status.contains("待核实") || entity.note.contains("待核实")
        {
            findings.push(format!(
                "- 对象：{}；状态：{}；备注：{}",
                markdown_escape(entity_name(entity)),
                markdown_escape(text_or_unknown(&entity.status)),
                markdown_escape(text_or_unknown(&entity.note))
            ));
        }
    }
    for relation in &detail.relations {
        if relation.emphasis
            || relation.status.contains("待核实")
            || relation.note.contains("待核实")
        {
            let source = entities
                .get(relation.source_id.as_str())
                .map(|entity| entity_name(entity))
                .unwrap_or("未知对象");
            let target = entities
                .get(relation.target_id.as_str())
                .map(|entity| entity_name(entity))
                .unwrap_or("未知对象");
            findings.push(format!(
                "- 关系：{} —[{}]→ {}；状态：{}；备注：{}",
                markdown_escape(source),
                markdown_escape(&relation.label),
                markdown_escape(target),
                markdown_escape(text_or_unknown(&relation.status)),
                markdown_escape(text_or_unknown(&relation.note))
            ));
        }
    }
    if findings.is_empty() {
        output.push_str("- 未标记重点或待核实项。\n");
    } else {
        output.push_str(&findings.join("\n"));
        output.push('\n');
    }
    output.push_str(&format!(
        "\n## 归档与路径\n- 归档标题：{}\n- 归档目录：{}\n- 路径车道：{}\n\n",
        markdown_escape(detail.case.archive_title.as_deref().unwrap_or("未填写")),
        markdown_escape(text_or_unknown(&detail.case.archive_folder)),
        markdown_escape(text_or_unknown(&detail.case.path_lanes))
    ));
    output.push_str("## 对象全清单\n\n| 类型 | 原始标签 | 显示名称 | 自定义类型 | 颜色 | 状态 | 角色 | 重点标记 | 备注 |\n|---|---|---|---|---|---|---|---|---|\n");
    for entity in &detail.entities {
        output.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} | {} | {} |\n",
            entity_kind_label(&entity.kind),
            markdown_table_cell(&entity.label),
            markdown_table_cell(text_or_unknown(&entity.display_name)),
            markdown_table_cell(text_or_unknown(&entity.custom_type)),
            markdown_table_cell(text_or_unknown(&entity.accent)),
            markdown_table_cell(text_or_unknown(&entity.status)),
            markdown_table_cell(text_or_unknown(&entity.role)),
            if entity.pinned { "重点" } else { "" },
            markdown_table_cell(text_or_unknown(&entity.note))
        ));
    }
    output
        .push_str("\n## 对象属性\n\n| 对象 | 字段 | 类型 | 值 | 排序 |\n|---|---|---|---|---:|\n");
    for attribute in &detail.entity_attributes {
        let subject = entities
            .get(attribute.subject_id.as_str())
            .map(|entity| entity_name(entity))
            .unwrap_or("未知对象");
        output.push_str(&format!(
            "| {} | {} | {} | {} | {} |\n",
            markdown_table_cell(subject),
            markdown_table_cell(attribute_field_label(&attribute.field_key)),
            markdown_table_cell(&attribute.value_type),
            markdown_table_cell(&attribute_display_value(attribute)),
            attribute.sort_order
        ));
    }
    output.push_str("\n## 关系全清单\n\n| 来源 | 关系标签 | 目标 | 范围 | 状态 | 重点标记 | 备注 |\n|---|---|---|---|---|---|---|\n");
    for relation in &detail.relations {
        let source = entities
            .get(relation.source_id.as_str())
            .map(|entity| entity_name(entity))
            .unwrap_or("未知对象");
        let target = entities
            .get(relation.target_id.as_str())
            .map(|entity| entity_name(entity))
            .unwrap_or("未知对象");
        output.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} |\n",
            markdown_table_cell(source),
            markdown_table_cell(&relation.label),
            markdown_table_cell(target),
            markdown_table_cell(text_or_unknown(&relation.spread)),
            markdown_table_cell(text_or_unknown(&relation.status)),
            if relation.emphasis { "重点" } else { "" },
            markdown_table_cell(text_or_unknown(&relation.note))
        ));
    }
    output.push_str(
        "\n## 关系属性\n\n| 关系 | 字段 | 类型 | 值 | 排序 |\n|---|---|---|---|---:|\n",
    );
    for attribute in &detail.relation_attributes {
        let relation_subject = detail.relations.iter().find(|relation| relation.id == attribute.subject_id).map(|relation| {
            let source = entities.get(relation.source_id.as_str()).map(|entity| entity_name(entity)).unwrap_or("未知对象");
            let target = entities.get(relation.target_id.as_str()).map(|entity| entity_name(entity)).unwrap_or("未知对象");
            format!("{}—{}—{}", source, relation.label, target)
        }).unwrap_or_else(|| "未知关系".into());
        output.push_str(&format!(
            "| {} | {} | {} | {} | {} |\n",
            markdown_table_cell(&relation_subject),
            markdown_table_cell(attribute_field_label(&attribute.field_key)),
            markdown_table_cell(&attribute.value_type),
            markdown_table_cell(&attribute_display_value(attribute)),
            attribute.sort_order
        ));
    }
    output.push_str("\n## 附件清单\n\n| 文件名 | SHA-256 | MIME | 大小（字节） | collected_at | created_at | 关联对象 | 关联关系 | 说明 |\n|---|---|---|---:|---|---|---|---|---|\n");
    for attachment in &detail.attachments {
        let entity = attachment
            .entity_id
            .as_deref()
            .and_then(|id| entities.get(id))
            .map(|entity| entity_name(entity))
            .unwrap_or("未关联");
        let relation = attachment
            .relation_id
            .as_deref()
            .and_then(|id| detail.relations.iter().find(|relation| relation.id == id))
            .map(|relation| relation.label.as_str())
            .unwrap_or("未关联");
        output.push_str(&format!(
            "| {} | `{}` | {} | {} | {} | {} | {} | {} | {} |\n",
            markdown_table_cell(&attachment.original_name),
            attachment.sha256,
            markdown_table_cell(&attachment.mime_type),
            attachment.size_bytes,
            markdown_table_cell(text_or_unknown(&attachment.collected_at)),
            markdown_table_cell(text_or_unknown(&attachment.created_at)),
            markdown_table_cell(entity),
            markdown_table_cell(relation),
            markdown_table_cell(text_or_unknown(&attachment.note))
        ));
    }
    output.push_str("\n## 数据语义\n- **对象**：案件中录入的账号、联系方式、设备、网络、位置、组织或自定义线索。\n- **关系**：录入者给出的连接及其标签、范围、状态和备注；不等同于已证实结论。\n- **重点**：用户标记的关注项；**待核实**：尚需验证的记录。\n- **附件哈希**：用于识别所记录附件内容，未在本文中嵌入附件二进制。\n\n## 导入包说明\n配套的 `.cluecase` 是可导入 Workbench 的完整 ZIP 包，包含案件数据、附件副本和完整性清单；本 Markdown 与 `.xmind` 为便于阅读、复制与继续研判的派生材料。\n");
    fs::write(path, output).map_err(|e| e.to_string())
}

fn export_case_v2(detail: &CaseDetail, root: &Path) -> CoreResult<ExportResult> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let title = safe_export_title(&detail.case.title);
    let export_id = Uuid::new_v4();
    let stamp = Local::now().format("%Y%m%d-%H%M%S%.3f");
    let dir = root.join(format!("{}-{}-{}", title, stamp, export_id));
    if dir.exists() {
        return Err("导出目标已存在，已拒绝覆盖".into());
    }
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let base = format!("{}-{}-{}", title, stamp, export_id);
    let path = dir.join(format!("{base}.cluecase"));
    let result: CoreResult<ExportResult> = (|| {
        let mut payloads = HashMap::new();
        let case = CasePackage {
            format: "clue-workbench-case".into(),
            version: 3,
            exported_at: now(),
            detail: CasePackageDetail::from(detail),
        };
        payloads.insert(
            "case.json".to_string(),
            serde_json::to_vec_pretty(&case).map_err(|e| e.to_string())?,
        );
        let mut attachments = detail.attachments.clone();
        if attachments.len()+V2_PACKAGE_FILES.len()>MAX_PACKAGE_FILES{return Err("附件数量过多，无法生成可重新导入的案件包".into());}
        let mut attachment_sources=Vec::with_capacity(attachments.len());
        let mut attachment_total=0u64;
        for attachment in &mut attachments {
            let source=safe_attachment_path(&attachment.relative_path)?;
            if !source.is_file(){return Err(format!("附件副本缺失：{}",attachment.original_name));}
            let attachment_root=data_root()?.join("attachments").canonicalize().map_err(|e|e.to_string())?;
            let source=source.canonicalize().map_err(|e|e.to_string())?;
            if !source.starts_with(&attachment_root){return Err("附件路径越界".into());}
            let size=fs::metadata(&source).map_err(|e|e.to_string())?.len();
            if size>MAX_PACKAGE_FILE_BYTES{return Err(format!("附件超过案件包单文件上限：{}",attachment.original_name));}
            attachment_total=attachment_total.checked_add(size).ok_or("附件总大小无效")?;
            if attachment_total>MAX_PACKAGE_TOTAL_BYTES{return Err("附件总大小超过案件包上限".into());}
            let name = format!("attachments/{}", attachment.id);
            attachment.relative_path = name.clone();
            attachment_sources.push((name,source));
        }
        payloads.insert("attachments.json".to_string(),serde_json::to_vec_pretty(&attachments).map_err(|e| e.to_string())?);
        let metadata_total=payloads.values().try_fold(0u64,|total,bytes|total.checked_add(bytes.len() as u64).ok_or("案件包大小无效"))?;
        if metadata_total.checked_add(attachment_total).ok_or("案件包大小无效")?>MAX_PACKAGE_TOTAL_BYTES{return Err("案件包解压总大小超限".into());}
        for(name,source)in attachment_sources{payloads.insert(name,fs::read(source).map_err(|e|e.to_string())?);}
        let mut list: Vec<PackageFile> = payloads
            .iter()
            .map(|(path, bytes)| PackageFile {
                path: path.clone(),
                sha256: sha256(bytes),
                size_bytes: bytes.len() as u64,
            })
            .collect();
        list.sort_by(|a, b| a.path.cmp(&b.path));
        payloads.insert(
            "manifest.json".to_string(),
            serde_json::to_vec_pretty(&PackageManifest {
                format: "clue-workbench-case".into(),
                version: 3,
                files: list,
            })
            .map_err(|e| e.to_string())?,
        );
        if payloads.len()>MAX_PACKAGE_FILES||payloads.values().any(|bytes|bytes.len() as u64>MAX_PACKAGE_FILE_BYTES){return Err("案件包条目数量或单文件大小超限".into());}
        let package_total=payloads.values().try_fold(0u64,|total,bytes|total.checked_add(bytes.len() as u64).ok_or("案件包大小无效"))?;
        if package_total>MAX_PACKAGE_TOTAL_BYTES{return Err("案件包解压总大小超限".into());}
        let temp = path.with_extension("cluecase.tmp");
        let output = fs::File::create(&temp).map_err(|e| e.to_string())?;
        let mut writer = ZipWriter::new(output);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let mut names: Vec<_> = payloads.keys().cloned().collect();
        names.sort();
        for name in names {
            writer
                .start_file(&name, options)
                .map_err(|e| e.to_string())?;
            writer
                .write_all(payloads.get(&name).unwrap())
                .map_err(|e| e.to_string())?;
        }
        writer.finish().map_err(|e| e.to_string())?;
        fs::rename(&temp, &path).map_err(|e| e.to_string())?;
        let xmind_path = dir.join(format!("{base}.xmind"));
        let markdown_path = dir.join(format!("{base}_案情说明.md"));
        write_xmind(detail, &xmind_path)?;
        write_markdown(detail, &markdown_path)?;
        let xmind_metadata =
            fs::metadata(&xmind_path).map_err(|e| format!("无法读取 XMind 导出文件：{e}"))?;
        let xmind_path =
            fs::canonicalize(&xmind_path).map_err(|e| format!("无法解析 XMind 导出路径：{e}"))?;
        Ok(ExportResult {
            directory: fs::canonicalize(&dir)
                .map_err(|e| format!("无法解析导出目录：{e}"))?
                .display()
                .to_string(),
            summary_path: fs::canonicalize(&markdown_path)
                .map_err(|e| format!("无法解析 Markdown 路径：{e}"))?
                .display()
                .to_string(),
            graph_path: xmind_path.display().to_string(),
            data_path: String::new(),
            package_path: fs::canonicalize(&path)
                .map_err(|e| format!("无法解析案件包路径：{e}"))?
                .display()
                .to_string(),
            xmind_path: xmind_path.display().to_string(),
            markdown_path: fs::canonicalize(&markdown_path)
                .map_err(|e| format!("无法解析 Markdown 路径：{e}"))?
                .display()
                .to_string(),
            xmind_size_bytes: xmind_metadata.len(),
            xmind_generated_at: now(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&dir);
    }
    result
}

pub fn export_case(id: &str) -> CoreResult<ExportResult> {
    export_case_to(id, None)
}

pub fn export_case_to(id: &str, destination_root: Option<&str>) -> CoreResult<ExportResult> {
    let detail = get_case_detail(id)?;
    let portable_root = match destination_root {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value),
        _ => data_root()?.join("exports"),
    };
    let portable = export_case_v2(&detail, &portable_root)?;
    let conn = open()?;
    touch(&conn, id, "export_case", "导出可移植案件包 v2")?;
    Ok(portable)
}

pub fn import_case_package(package_path: &str) -> CoreResult<CaseRecord> {
    let path = Path::new(package_path);
    if path.extension().and_then(|v| v.to_str()) == Some("cluecase") {
        let (files, manifest_version) = read_v2_package(path)?;
        let package: CasePackage = serde_json::from_slice(files.get("case.json").unwrap())
            .map_err(|e| format!("case.json 格式无效：{e}"))?;
        let source_attachments: Vec<Attachment> =
            serde_json::from_slice(files.get("attachments.json").unwrap())
                .map_err(|e| format!("attachments.json 格式无效：{e}"))?;
        if package.format != "clue-workbench-case" || !matches!(package.version, 2 | 3) {
            return Err("不是受支持的 v2/v3 案件包".into());
        }
        if package.version != manifest_version {
            return Err("案件包 manifest 与 case.json 版本不一致".into());
        }
        let package_version = package.version;
        if package.detail.case.title.trim().is_empty() || package.detail.entities.is_empty() {
            return Err("案件包缺少案件名称或对象".into());
        }
        let case_id = Uuid::new_v4().to_string();
        let mut entity_ids = HashMap::new();
        for entity in &package.detail.entities {
            if !allowed_kind(&entity.kind) {
                return Err(format!("案件包包含不支持的对象类型：{}", entity.kind));
            }
            if entity_ids
                .insert(entity.id.clone(), Uuid::new_v4().to_string())
                .is_some()
            {
                return Err("案件包对象 ID 重复".into());
            }
        }
        let mut relation_ids = HashMap::new();
        for relation in &package.detail.relations {
            if relation_ids
                .insert(relation.id.clone(), Uuid::new_v4().to_string())
                .is_some()
            {
                return Err("案件包关系 ID 重复".into());
            }
            if !entity_ids.contains_key(&relation.source_id)
                || !entity_ids.contains_key(&relation.target_id)
            {
                return Err("关系关联对象缺失".into());
            }
        }
        let root_id = entity_ids
            .get(&package.detail.root_id)
            .ok_or("案件包缺少根对象")?
            .clone();
        let attachments_root = data_root()?.join("attachments");
        let stage = attachments_root.join(format!(".importing-{}", Uuid::new_v4()));
        let final_dir = attachments_root.join(&case_id);
        fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
        let result: CoreResult<CaseRecord> = (|| {
            let mut attachments = Vec::new();
            for source in &source_attachments {
                let bytes = files.get(&source.relative_path).ok_or("附件文件缺失")?;
                if sha256(bytes) != source.sha256 || bytes.len() as i64 != source.size_bytes {
                    return Err("附件校验失败".into());
                }
                let id = Uuid::new_v4().to_string();
                let relative = attachment_relative_path(
                    &case_id,
                    &id,
                    Path::new(&source.original_name)
                        .extension()
                        .and_then(|x| x.to_str()),
                )?;
                let entity_id = match &source.entity_id {
                    Some(old) => Some(entity_ids.get(old).ok_or("附件关联对象缺失")?.clone()),
                    None => None,
                };
                let relation_id = match &source.relation_id {
                    Some(old) => Some(relation_ids.get(old).ok_or("附件关联关系缺失")?.clone()),
                    None => None,
                };
                fs::write(
                    stage.join(relative.file_name().ok_or("附件路径无效")?),
                    bytes,
                )
                .map_err(|e| e.to_string())?;
                attachments.push(Attachment {
                    id,
                    case_id: case_id.clone(),
                    original_name: source.original_name.clone(),
                    relative_path: relative.to_string_lossy().to_string(),
                    sha256: source.sha256.clone(),
                    mime_type: source.mime_type.clone(),
                    size_bytes: source.size_bytes,
                    collected_at: source.collected_at.clone(),
                    note: source.note.clone(),
                    entity_id,
                    relation_id,
                    created_at: source.created_at.clone(),
                });
            }
            let mut conn = open()?;
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            let stamp = now();
            tx.execute("INSERT INTO cases(id,title,archive_title,background,police_disposal,current_status,path_lanes,status,sort_order,root_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'active',(SELECT COALESCE(MIN(sort_order),0)-1 FROM cases WHERE status='active'),?8,?9,?9)", params![case_id,package.detail.case.title.trim(),package.detail.case.archive_title,package.detail.case.background,package.detail.case.police_disposal,package.detail.case.current_status,package.detail.case.path_lanes,root_id,stamp]).map_err(|e|e.to_string())?;
            for entity in &package.detail.entities {
                tx.execute("INSERT INTO entities(id,case_id,kind,label,display_name,status,role,note,accent,pinned,custom_type) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![entity_ids.get(&entity.id).unwrap(),case_id,entity.kind,entity.label,entity.display_name,entity.status,entity.role,entity.note,entity.accent,entity.pinned as i64,entity.custom_type]).map_err(|e|e.to_string())?;
            }
            for relation in &package.detail.relations {
                tx.execute("INSERT INTO relations(id,case_id,source_id,target_id,label,spread,status,note,emphasis) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![relation_ids.get(&relation.id).unwrap(),case_id,entity_ids.get(&relation.source_id).unwrap(),entity_ids.get(&relation.target_id).unwrap(),relation.label,relation.spread,relation.status,relation.note,relation.emphasis as i64]).map_err(|e|e.to_string())?;
            }
            for attribute in &package.detail.entity_attributes {
                let mut mapped = attribute.clone();
                mapped.id = Uuid::new_v4().to_string();
                mapped.case_id = case_id.clone();
                mapped.subject_id = entity_ids
                    .get(&attribute.subject_id)
                    .ok_or("对象属性主体缺失")?
                    .clone();
                insert_attribute_tx(&tx, "entity_attributes", &mapped, &case_id)?;
            }
            for attribute in &package.detail.relation_attributes {
                let mut mapped = attribute.clone();
                mapped.id = Uuid::new_v4().to_string();
                mapped.case_id = case_id.clone();
                mapped.subject_id = relation_ids
                    .get(&attribute.subject_id)
                    .ok_or("关系属性主体缺失")?
                    .clone();
                insert_attribute_tx(&tx, "relation_attributes", &mapped, &case_id)?;
            }
            for attachment in &attachments {
                tx.execute("INSERT INTO attachments(id,case_id,original_name,relative_path,sha256,mime_type,size_bytes,collected_at,note,entity_id,relation_id,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",params![attachment.id,case_id,attachment.original_name,attachment.relative_path,attachment.sha256,attachment.mime_type,attachment.size_bytes,attachment.collected_at,attachment.note,attachment.entity_id,attachment.relation_id,attachment.created_at]).map_err(|e|e.to_string())?;
            }
            fs::rename(&stage, &final_dir).map_err(|e| format!("附件发布失败：{e}"))?;
            touch_tx(
                &tx,
                &case_id,
                "import_case_package",
                &format!("导入可移植案件包 v{package_version}"),
            )?;
            tx.commit().map_err(|e| e.to_string())?;
            case_record(&conn, &case_id)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&stage);
            // `final_dir` may already be committed and registered; never delete evidence after commit.
            let committed = open()
                .ok()
                .and_then(|conn| case_record(&conn, &case_id).ok())
                .is_some();
            if !committed {
                let _ = fs::remove_dir_all(&final_dir);
            }
        }
        return result;
    }
    validate_package_manifest(path)?;
    let raw = fs::read_to_string(path).map_err(|e| format!("无法读取案件包：{e}"))?;
    let package: CasePackage =
        serde_json::from_str(&raw).map_err(|e| format!("案件包格式无效：{e}"))?;
    if package.format != "clue-workbench-case" || package.version != 1 {
        return Err("不是受支持的线索研判案件包".into());
    }
    if package.detail.case.title.trim().is_empty() || package.detail.entities.is_empty() {
        return Err("案件包缺少案件名称或对象".into());
    }
    let mut conn = open()?;
    let new_case_id = Uuid::new_v4().to_string();
    let mut ids = HashMap::new();
    for entity in &package.detail.entities {
        ids.insert(entity.id.clone(), Uuid::new_v4().to_string());
    }
    let new_root_id = ids
        .get(&package.detail.root_id)
        .cloned()
        .ok_or("案件包缺少根对象")?;
    let timestamp = now();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO cases(id,title,archive_title,background,police_disposal,current_status,path_lanes,status,sort_order,root_id,created_at,updated_at) VALUES(?1,?2,NULL,?3,?4,?5,?6,'active',(SELECT COALESCE(MIN(sort_order),0)-1 FROM cases WHERE status='active'),?7,?8,?8)",params![new_case_id,package.detail.case.title.trim(),package.detail.case.background,package.detail.case.police_disposal,package.detail.case.current_status,package.detail.case.path_lanes,new_root_id,timestamp]).map_err(|e|e.to_string())?;
    for entity in &package.detail.entities {
        if !allowed_kind(&entity.kind) {
            return Err(format!("案件包包含不支持的对象类型：{}", entity.kind));
        }
        tx.execute("INSERT INTO entities(id,case_id,kind,label,display_name,status,role,note,accent,pinned,custom_type) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![ids.get(&entity.id).unwrap(),new_case_id,entity.kind,entity.label,entity.display_name,entity.status,entity.role,entity.note,entity.accent,entity.pinned as i64,entity.custom_type]).map_err(|e|e.to_string())?;
    }
    for relation in &package.detail.relations {
        tx.execute("INSERT INTO relations(id,case_id,source_id,target_id,label,spread,status,note,emphasis) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![Uuid::new_v4().to_string(),new_case_id,ids.get(&relation.source_id).ok_or("案件包关系源对象缺失")?,ids.get(&relation.target_id).ok_or("案件包关系目标对象缺失")?,relation.label,relation.spread,relation.status,relation.note,relation.emphasis as i64]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    touch(
        &conn,
        &new_case_id,
        "import_case_package",
        "导入案件包 v1（不含附件）",
    )?;
    case_record(&conn, &new_case_id)
}

#[cfg(test)]
#[path = "structured_attribute_tests.rs"]
mod structured_attribute_tests;

#[cfg(test)]
#[path = "strict_import_tests.rs"]
mod strict_import_tests;

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) struct TestDataRoot {
        path: PathBuf,
    }

    impl TestDataRoot {
        pub(super) fn new() -> Self {
            let path = env::temp_dir().join(format!("clue-workbench-test-{}", Uuid::new_v4()));
            TEST_DATA_ROOT.with(|root| {
                assert!(root.borrow().is_none(), "测试数据目录已初始化");
                *root.borrow_mut() = Some(path.clone());
            });
            Self { path }
        }
    }

    impl Drop for TestDataRoot {
        fn drop(&mut self) {
            TEST_DATA_ROOT.with(|root| *root.borrow_mut() = None);
            if self.path.exists() {
                fs::remove_dir_all(&self.path).unwrap_or_else(|error| {
                    panic!("无法清理测试数据目录 {}: {error}", self.path.display())
                });
            }
        }
    }

    #[test]
    fn attachment_lifecycle_uses_controlled_copy_path() {
        let data_root = TestDataRoot::new();
        let case = create_case(CreateCaseInput {
            title: "附件生命周期".into(),
            background: "".into(),
            seed_kind: "wechat".into(),
            seed_value: "seed-account".into(),
        })
        .unwrap();
        let source = data_root.path.join("source.txt");
        fs::create_dir_all(&data_root.path).unwrap();
        fs::write(&source, b"attachment bytes").unwrap();

        let attachment = add_attachment(
            &case.id,
            source.to_str().unwrap(),
            "原始说明",
            None,
            None,
        )
        .unwrap();
        let stored = attachment_path(&case.id, &attachment.id).unwrap();
        assert_ne!(stored, source);
        assert!(stored.starts_with(data_root.path.canonicalize().unwrap().join("attachments")));
        assert_eq!(fs::read(&stored).unwrap(), b"attachment bytes");
        assert!(attachment_path(&case.id, &Uuid::new_v4().to_string()).is_err());

        update_attachment_note(&case.id, &attachment.id, "修改说明").unwrap();
        assert_eq!(get_case_detail(&case.id).unwrap().attachments[0].note, "修改说明");
        delete_attachment(&case.id, &attachment.id).unwrap();
        assert!(!stored.exists());
        assert!(get_case_detail(&case.id).unwrap().attachments.is_empty());
    }

    #[test]
    fn permanently_delete_trash_case_removes_all_associated_rows_and_files() {
        let data_root = TestDataRoot::new();
        let case = create_case(CreateCaseInput {
            title: "彻底删除安全回归".into(),
            background: String::new(),
            seed_kind: "qq".into(),
            seed_value: "799999996".into(),
        }).unwrap();
        let source_id = get_case_detail(&case.id).unwrap().entities[0].id.clone();
        let attribute = PlannedAttributeInput {
            field_key: "security-marker".into(),
            value_type: "text".into(),
            value_text: "sensitive".into(),
            value_number: None,
            value_time: None,
        };
        let imported = add_relations(AddRelationsInput {
            case_id: case.id.clone(),
            source_id,
            target_kind: "wechat".into(),
            values: vec!["delete-me".into()],
            display_names: vec!["待删除对象".into()],
            label: "安全测试关系".into(),
            spread: "安全测试".into(),
            note: String::new(),
            custom_type: String::new(),
            source: "永久删除回归".into(),
            attributes: vec![],
            entity_attributes: vec![attribute.clone()],
            relation_attributes: vec![attribute],
        }).unwrap();
        let batch_id = imported.batch.unwrap().id;
        let relation_id = get_case_detail(&case.id).unwrap().relations[0].id.clone();
        let source = data_root.path.join("delete-source.txt");
        fs::create_dir_all(&data_root.path).unwrap();
        fs::write(&source, b"must be deleted").unwrap();
        add_attachment(&case.id, source.to_str().unwrap(), "", None, Some(&relation_id)).unwrap();
        let attachment_dir = data_root.path.join("attachments").join(&case.id);
        assert!(attachment_dir.is_dir());

        let conn = open().unwrap();
        conn.execute(
            "INSERT INTO import_batch_attribute_updates(batch_id,table_name,attribute_id,before_value) VALUES(?1,'entity_attributes','security-marker','{}')",
            [&batch_id],
        ).unwrap();
        drop(conn);

        trash_case(&case.id).unwrap();
        permanently_delete_case(&case.id, &case.title).unwrap();

        let conn = open().unwrap();
        for table in ["cases", "entities", "relations", "entity_attributes", "relation_attributes", "import_batches", "attachments"] {
            let count: i64 = conn.query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE {}=?1", if table == "cases" { "id" } else { "case_id" }),
                [&case.id],
                |row| row.get(0),
            ).unwrap();
            assert_eq!(count, 0, "{table} 仍有案件关联残留");
        }
        for table in ["import_batch_relations", "import_batch_entities", "import_batch_entity_attributes", "import_batch_relation_attributes", "import_batch_attribute_updates"] {
            let count: i64 = conn.query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE batch_id=?1"),
                [&batch_id],
                |row| row.get(0),
            ).unwrap();
            assert_eq!(count, 0, "{table} 仍有批次关联残留");
        }
        assert!(!attachment_dir.exists(), "案件附件目录仍然存在");
    }

    #[test]
    fn repeated_relation_import_does_not_create_empty_batch() {
        let _data_root = TestDataRoot::new();
        let case = create_case(CreateCaseInput {
            title: format!("批量导入测试-{}", Uuid::new_v4()),
            background: String::new(),
            seed_kind: "qq".into(),
            seed_value: format!("seed-{}", Uuid::new_v4()),
        })
        .unwrap();
        let detail = get_case_detail(&case.id).unwrap();
        let source_id = detail
            .entities
            .iter()
            .find(|entity| entity.kind == "qq")
            .unwrap()
            .id
            .clone();
        let input = || AddRelationsInput {
            case_id: case.id.clone(),
            source_id: source_id.clone(),
            target_kind: "wechat".into(),
            values: vec!["wx-one".into(), "wx-two".into()],
            display_names: vec![],
            label: "关联微信号".into(),
            spread: "账号链扩展".into(),
            note: String::new(),
            custom_type: String::new(),
            source: "测试".into(),
            attributes: vec![],
            entity_attributes: vec![],
            relation_attributes: vec![],
        };

        let first = add_relations(input()).unwrap();
        assert_eq!(first.candidate_count, 2);
        assert_eq!(first.added_count, 2);
        assert_eq!(first.skipped_count, 0);
        assert_eq!(first.batch.as_ref().unwrap().relation_count, 2);

        let repeated = add_relations(input()).unwrap();
        assert_eq!(repeated.candidate_count, 2);
        assert_eq!(repeated.added_count, 0);
        assert_eq!(repeated.skipped_count, 2);
        assert!(repeated.batch.is_none());

        let batches = list_import_batches(&case.id).unwrap();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].relation_count, 2);
        let conn = open().unwrap();
        let batch_relations: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM import_batch_relations WHERE batch_id=?1",
                [&batches[0].id],
                |row| row.get(0),
            )
            .unwrap();
        let batch_entities: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM import_batch_entities WHERE batch_id=?1",
                [&batches[0].id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(batch_relations, 2);
        assert_eq!(batch_entities, 2);
    }

    fn import_one(case_id: &str, source_id: &str, value: &str) {
        let result = add_relations(AddRelationsInput {
            case_id: case_id.into(),
            source_id: source_id.into(),
            target_kind: "wechat".into(),
            values: vec![value.into()],
            display_names: vec![],
            label: "关联微信号".into(),
            spread: "账号链扩展".into(),
            note: String::new(),
            custom_type: String::new(),
            source: value.into(),
            attributes: vec![],
            entity_attributes: vec![],
            relation_attributes: vec![],
        })
        .unwrap();
        assert_eq!(result.added_count, 1);
    }

    #[test]
    fn global_history_restores_import_batches_across_reopen_and_old_snapshots() {
        let _data_root = TestDataRoot::new();
        let case = create_case(CreateCaseInput {
            title: "全局历史批次一致性".into(),
            background: String::new(),
            seed_kind: "qq".into(),
            seed_value: "root".into(),
        })
        .unwrap();
        let initial = get_case_detail(&case.id).unwrap();
        let source_id = initial.root_id;
        let base_entity_count = initial.entities.len();
        let base_relation_count = initial.relations.len();
        for index in 1..=4 {
            import_one(&case.id, &source_id, &format!("wx-{index}"));
            drop(open().unwrap());
            assert_eq!(list_import_batches(&case.id).unwrap().len(), index);
            assert_eq!(get_case_detail(&case.id).unwrap().relations.len(), base_relation_count + index);
        }

        for expected in (0..4).rev() {
            let restored = undo_case(&case.id).unwrap();
            drop(open().unwrap());
            assert_eq!(restored.entity_count, base_entity_count + expected);
            assert_eq!(restored.relation_count, base_relation_count + expected);
            assert_eq!(list_import_batches(&case.id).unwrap().len(), expected);
            assert_eq!(get_case_detail(&case.id).unwrap().relations.len(), base_relation_count + expected);
        }
        for expected in 1..=4 {
            let restored = redo_case(&case.id).unwrap();
            drop(open().unwrap());
            assert_eq!(restored.entity_count, base_entity_count + expected);
            assert_eq!(restored.relation_count, base_relation_count + expected);
            assert_eq!(list_import_batches(&case.id).unwrap().len(), expected);
            assert_eq!(get_case_detail(&case.id).unwrap().relations.len(), base_relation_count + expected);
        }

        let mut legacy: serde_json::Value = serde_json::from_str(&history_payload(&case.id).unwrap()).unwrap();
        legacy.as_object_mut().unwrap().remove("activeImportBatchIds");
        let conn = open().unwrap();
        conn.execute("DELETE FROM case_snapshots WHERE case_id=?1", [&case.id]).unwrap();
        conn.execute(
            "INSERT INTO case_snapshots(id,case_id,reason,payload,created_at) VALUES(?1,?2,'legacy',?3,?4)",
            params![Uuid::new_v4().to_string(), case.id, legacy.to_string(), now()],
        )
        .unwrap();
        drop(conn);
        let restored = undo_case(&case.id).unwrap();
        assert_eq!(restored.relation_count, base_relation_count + 4);
        assert_eq!(list_import_batches(&case.id).unwrap().len(), 4);
    }

    #[test]
    fn sha256_matches_standard_vectors() {
        assert_eq!(
            sha256(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256(b"The quick brown fox jumps over the lazy dog"),
            "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"
        );
    }

    #[test]
    fn csv_quotes_formula_like_user_values_before_rfc4180_escaping() {
        assert_eq!(csv(" =SUM(1,1)"), "\"' =SUM(1,1)\"");
        assert_eq!(csv("\t@cmd"), "\"'\t@cmd\"");
        assert_eq!(csv("ordinary \"note\""), "\"ordinary \"\"note\"\"\"");
    }

    #[test]
    fn xml_removes_invalid_controls_and_escapes_special_characters() {
        assert_eq!(
            xml("a\u{0000}\u{0008}\u{FFFE}\t\n\r<&>\"'"),
            "a\t\n\r&lt;&amp;&gt;&quot;&apos;"
        );
        assert_eq!(xml("中文😀"), "中文😀");
    }

    #[test]
    fn case_package_v1_does_not_serialize_attachments() {
        let detail = CaseDetail {
            case: CaseRecord {
                id: "case".into(),
                title: "案件".into(),
                archive_title: None,
                archive_folder: "".into(),
                archive_folder_id: None,
                background: "".into(),
                police_disposal: "".into(),
                current_status: "".into(),
                path_lanes: "[]".into(),
                status: "active".into(),
                sort_order: 0,
                updated_at: "".into(),
                entity_count: 0,
                relation_count: 0,
            },
            root_id: "root".into(),
            entities: vec![],
            relations: vec![],
            entity_attributes: vec![],
            relation_attributes: vec![],
            attachments: vec![Attachment {
                id: "attachment".into(),
                case_id: "case".into(),
                original_name: "evidence.txt".into(),
                relative_path: "case/evidence.txt".into(),
                sha256: "hash".into(),
                mime_type: "text/plain".into(),
                size_bytes: 1,
                collected_at: "".into(),
                note: "".into(),
                entity_id: None,
                relation_id: None,
                created_at: "".into(),
            }],
        };
        let package = CasePackage {
            format: "clue-workbench-case".into(),
            version: 1,
            exported_at: "".into(),
            detail: CasePackageDetail::from(&detail),
        };
        let value = serde_json::to_value(package).unwrap();
        assert!(value["detail"].get("attachments").is_none());
    }

    #[test]
    fn xmind_export_is_valid_zip_with_core_branches() {
        let dir = env::temp_dir().join(format!("clue-workbench-xmind-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("案件.xmind");
        let detail = CaseDetail {
            case: CaseRecord {
                id: "case".into(),
                title: "测试案件".into(),
                archive_title: None,
                archive_folder: "".into(),
                archive_folder_id: None,
                background: "背景".into(),
                police_disposal: "".into(),
                current_status: "".into(),
                path_lanes: "".into(),
                status: "active".into(),
                sort_order: 0,
                updated_at: "".into(),
                entity_count: 2,
                relation_count: 1,
            },
            root_id: "root".into(),
            entities: vec![
                Entity {
                    id: "root".into(),
                    case_id: "case".into(),
                    kind: "subject".into(),
                    label: "主体".into(),
                    display_name: "".into(),
                    status: "已录入".into(),
                    role: "".into(),
                    note: "".into(),
                    accent: "".into(),
                    pinned: true,
                    custom_type: "".into(),
                },
                Entity {
                    id: "wechat".into(),
                    case_id: "case".into(),
                    kind: "wechat".into(),
                    label: "wxid".into(),
                    display_name: "".into(),
                    status: "待核实".into(),
                    role: "".into(),
                    note: "待核实关联".into(),
                    accent: "".into(),
                    pinned: false,
                    custom_type: "".into(),
                },
            ],
            relations: vec![Relation {
                id: "relation".into(),
                case_id: "case".into(),
                source_id: "root".into(),
                target_id: "wechat".into(),
                label: "使用".into(),
                spread: "人工关联".into(),
                status: "待核实".into(),
                note: "待核实".into(),
                emphasis: true,
            }],
            entity_attributes: vec![],
            relation_attributes: vec![],
            attachments: vec![],
        };
        write_xmind(&detail, &path).unwrap();
        let mut zip = ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
        for entry in [
            "content.json",
            "content.xml",
            "metadata.json",
            "manifest.json",
        ] {
            assert!(zip.by_name(entry).is_ok(), "官方 SDK 文件缺少 {entry}");
        }
        let mut content = String::new();
        zip.by_name("content.json")
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        for expected in [
            "测试案件",
            "主体",
            "wxid",
            "使用 ◆ 重点",
            "关系 ID：relation",
            "源对象：root",
            "目标对象：wechat",
        ] {
            assert!(content.contains(expected));
        }
        assert!(content.contains("svg:fill"));
        assert!(content.contains("org.xmind.ui.logic.right"));
        assert!(!content.contains("关系："));
        assert!(!content.contains("[微信]"));
        assert!(!content.contains("账号与联系方式"));
        assert!(!content.contains("交叉关联"));
        drop(zip);
        let markdown_path=dir.join("案件.md");
        write_markdown(&detail,&markdown_path).unwrap();
        let markdown=fs::read_to_string(markdown_path).unwrap();
        assert!(!markdown.contains("非重点"));
        assert!(!markdown.contains("| 否 |"));
        assert!(markdown.contains("；重点）"));
        assert!(markdown.contains("对象类型："));
        assert!(markdown.contains("关系类型："));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn xmind_export_preserves_directed_topology_with_references_cycles_and_orphans() {
        fn entity(id: &str, kind: &str) -> Entity {
            Entity {
                id: id.into(),
                case_id: "case".into(),
                kind: kind.into(),
                label: id.into(),
                display_name: id.into(),
                status: "已录入".into(),
                role: "".into(),
                note: "".into(),
                accent: "".into(),
                pinned: false,
                custom_type: "".into(),
            }
        }
        fn relation(id: &str, source: &str, target: &str) -> Relation {
            Relation {
                id: id.into(),
                case_id: "case".into(),
                source_id: source.into(),
                target_id: target.into(),
                label: format!("标签-{id}"),
                spread: format!("范围-{id}"),
                status: "待核实".into(),
                note: format!("备注-{id}"),
                emphasis: id == "r1",
            }
        }
        let detail = CaseDetail {
            case: CaseRecord {
                id: "case".into(),
                title: "拓扑测试".into(),
                archive_title: None,
                archive_folder: "".into(),
                archive_folder_id: None,
                background: "".into(),
                police_disposal: "".into(),
                current_status: "".into(),
                path_lanes: "".into(),
                status: "active".into(),
                sort_order: 0,
                updated_at: "".into(),
                entity_count: 5,
                relation_count: 6,
            },
            root_id: "root".into(),
            entities: vec![
                entity("root", "subject"),
                entity("b", "wechat"),
                entity("c", "location"),
                entity("d", "datacenter"),
                entity("orphan", "device"),
            ],
            relations: vec![
                relation("r1", "root", "b"),
                relation("r2", "root", "c"),
                relation("r3", "b", "d"),
                relation("r4", "c", "d"),
                relation("r5", "d", "root"),
                relation("r6", "orphan", "b"),
            ],
            entity_attributes: vec![],
            relation_attributes: vec![],
            attachments: vec![],
        };
        let dir = env::temp_dir().join(format!("clue-workbench-xmind-topology-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("拓扑.xmind");
        write_xmind(&detail, &path).unwrap();
        let mut zip = ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
        let mut content = String::new();
        zip.by_name("content.json")
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        let content_value: serde_json::Value = serde_json::from_str(&content).unwrap();
        fn relation_note_count(value: &serde_json::Value, relation_id: &str) -> usize {
            let here = value
                .get("notes")
                .and_then(|notes| notes.get("plain"))
                .and_then(|plain| plain.get("content"))
                .and_then(serde_json::Value::as_str)
                .map(|note| usize::from(note.contains(&format!("关系 ID：{relation_id}"))))
                .unwrap_or(0);
            match value {
                serde_json::Value::Object(map) => {
                    here + map
                        .values()
                        .map(|child| relation_note_count(child, relation_id))
                        .sum::<usize>()
                }
                serde_json::Value::Array(values) => {
                    here + values
                        .iter()
                        .map(|child| relation_note_count(child, relation_id))
                        .sum::<usize>()
                }
                _ => here,
            }
        }
        for id in ["r1", "r2", "r3", "r4", "r5", "r6"] {
            assert_eq!(
                relation_note_count(&content_value, id),
                1,
                "关系 {id} 应恰好出现一次"
            );
        }
        for expected in [
            "未连接对象",
            "↗ 引用",
            "↻ 环引用",
            "对象 ID：root",
            "对象 ID：b",
            "对象 ID：c",
            "对象 ID：d",
            "对象 ID：orphan",
            "范围-r1",
            "备注-r6",
        ] {
            assert!(content.contains(expected), "缺少 {expected}");
        }
        for forbidden in [
            "关系：",
            "[微信]",
            "[位置]",
            "账号与联系方式",
            "设备网络",
            "社交组织",
            "位置背景",
            "交叉关联",
        ] {
            assert!(!content.contains(forbidden), "不应按类型分组：{forbidden}");
        }
        drop(zip);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn xmind_exports_are_isolated_and_titles_are_plain_text() {
        fn detail(case_title: &str, entity_label: &str) -> CaseDetail {
            CaseDetail {
                case: CaseRecord {
                    id: case_title.into(),
                    title: case_title.into(),
                    archive_title: None,
                    archive_folder: "".into(),
                    archive_folder_id: None,
                    background: "".into(),
                    police_disposal: "".into(),
                    current_status: "".into(),
                    path_lanes: "".into(),
                    status: "active".into(),
                    sort_order: 0,
                    updated_at: "".into(),
                    entity_count: 1,
                    relation_count: 0,
                },
                root_id: "root".into(),
                entities: vec![Entity {
                    id: "root".into(),
                    case_id: case_title.into(),
                    kind: "subject".into(),
                    label: entity_label.into(),
                    display_name: "".into(),
                    status: "已录入".into(),
                    role: "".into(),
                    note: "".into(),
                    accent: "".into(),
                    pinned: false,
                    custom_type: "".into(),
                }],
                relations: vec![],
                entity_attributes: vec![],
                relation_attributes: vec![],
                attachments: vec![],
            }
        }
        let dir =
            env::temp_dir().join(format!("clue-workbench-xmind-isolation-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let first_path = dir.join("first.xmind");
        let second_path = dir.join("second.xmind");
        write_xmind(&detail("案件甲<SDK>=", "实体甲=内部标记"), &first_path).unwrap();
        write_xmind(&detail("案件乙", "实体乙"), &second_path).unwrap();
        let read_titles = |path: &Path| {
            let mut zip = ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
            let mut content = String::new();
            zip.by_name("content.json")
                .unwrap()
                .read_to_string(&mut content)
                .unwrap();
            fn collect(value: &serde_json::Value, titles: &mut Vec<String>) {
                match value {
                    serde_json::Value::Object(map) => {
                        if let Some(serde_json::Value::String(title)) = map.get("title") {
                            titles.push(title.clone());
                        }
                        for value in map.values() {
                            collect(value, titles);
                        }
                    }
                    serde_json::Value::Array(values) => {
                        for value in values {
                            collect(value, titles);
                        }
                    }
                    _ => {}
                }
            }
            let mut titles = vec![];
            collect(
                &serde_json::from_str::<serde_json::Value>(&content).unwrap(),
                &mut titles,
            );
            titles
        };
        let first = read_titles(&first_path).join("\n");
        let second = read_titles(&second_path).join("\n");
        assert!(first.contains("案件甲 SDK"));
        assert!(first.contains("实体甲 内部标记"));
        assert!(!first.contains("案件乙") && !first.contains("实体乙"));
        assert!(!first.contains('='));
        assert!(second.contains("案件乙") && second.contains("实体乙"));
        assert!(!second.contains("案件甲") && !second.contains("实体甲"));
        assert!(!second.contains('='));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn v2_export_import_roundtrip_preserves_attachment_and_associations() {
        let _data_root = TestDataRoot::new();
        let source_case = Uuid::new_v4().to_string();
        let root_id = Uuid::new_v4().to_string();
        let entity_id = Uuid::new_v4().to_string();
        let relation_id = Uuid::new_v4().to_string();
        let attachment_id = Uuid::new_v4().to_string();
        let bytes = b"roundtrip attachment bytes".to_vec();
        let relative = attachment_relative_path(&source_case, &attachment_id, Some("bin")).unwrap();
        let source = safe_attachment_path(&relative.to_string_lossy()).unwrap();
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, &bytes).unwrap();
        let detail = CaseDetail {
            case: CaseRecord {
                id: source_case.clone(),
                title: "Roundtrip".into(),
                archive_title: Some("归档标题".into()),
                archive_folder: "归档目录".into(),
                archive_folder_id: None,
                background: "背景".into(),
                police_disposal: "处置".into(),
                current_status: "状态".into(),
                path_lanes: "[\"路径\"]".into(),
                status: "active".into(),
                sort_order: 0,
                updated_at: "".into(),
                entity_count: 2,
                relation_count: 1,
            },
            root_id: root_id.clone(),
            entities: vec![
                Entity {
                    id: root_id.clone(),
                    case_id: source_case.clone(),
                    kind: "subject".into(),
                    label: "原始根标签".into(),
                    display_name: "根显示名".into(),
                    status: "已录入".into(),
                    role: "主体".into(),
                    note: "根备注".into(),
                    accent: "#ff0000".into(),
                    pinned: true,
                    custom_type: "根类型".into(),
                },
                Entity {
                    id: entity_id.clone(),
                    case_id: source_case.clone(),
                    kind: "wechat".into(),
                    label: "wx-label".into(),
                    display_name: "微信显示名".into(),
                    status: "待核实".into(),
                    role: "账号".into(),
                    note: "对象备注".into(),
                    accent: "#00ff00".into(),
                    pinned: false,
                    custom_type: "账号类型".into(),
                },
            ],
            relations: vec![Relation {
                id: relation_id.clone(),
                case_id: source_case.clone(),
                source_id: root_id,
                target_id: entity_id.clone(),
                label: "关联".into(),
                spread: "路径范围".into(),
                status: "待核实".into(),
                note: "关系备注".into(),
                emphasis: true,
            }],
            entity_attributes: vec![],
            relation_attributes: vec![],
            attachments: vec![Attachment {
                id: attachment_id,
                case_id: source_case.clone(),
                original_name: "evidence.bin".into(),
                relative_path: relative.to_string_lossy().to_string(),
                sha256: sha256(&bytes),
                mime_type: "application/octet-stream".into(),
                size_bytes: bytes.len() as i64,
                collected_at: "2026-01-02".into(),
                note: "附件备注".into(),
                entity_id: Some(entity_id),
                relation_id: Some(relation_id),
                created_at: "2026-01-03".into(),
            }],
        };
        let dir = env::temp_dir().join(format!("clue-workbench-roundtrip-{}", Uuid::new_v4()));
        let result = export_case_v2(&detail, &dir).unwrap();
        let imported = import_case_package(&result.package_path).unwrap();
        let restored = get_case_detail(&imported.id).unwrap();
        assert_eq!(restored.case.archive_title.as_deref(), Some("归档标题"));
        assert_eq!(restored.case.path_lanes, "[\"路径\"]");
        let restored_root = restored
            .entities
            .iter()
            .find(|entity| entity.pinned)
            .unwrap();
        assert_eq!(restored_root.accent, "#ff0000");
        assert!(restored_root.pinned);
        assert!(restored.relations[0].emphasis);
        assert_eq!(restored.attachments.len(), 1);
        let attachment = &restored.attachments[0];
        assert_eq!(attachment.sha256, sha256(&bytes));
        assert_eq!(
            fs::read(safe_attachment_path(&attachment.relative_path).unwrap()).unwrap(),
            bytes
        );
        assert!(attachment.entity_id.is_some() && attachment.relation_id.is_some());
        let conn = open().unwrap();
        conn.execute(
            "DELETE FROM attachments WHERE case_id=?1",
            params![imported.id],
        )
        .unwrap();
        conn.execute(
            "DELETE FROM relations WHERE case_id=?1",
            params![imported.id],
        )
        .unwrap();
        conn.execute(
            "DELETE FROM entities WHERE case_id=?1",
            params![imported.id],
        )
        .unwrap();
        conn.execute("DELETE FROM cases WHERE id=?1", params![imported.id])
            .unwrap();
        let _ = fs::remove_dir_all(data_root().unwrap().join("attachments").join(&imported.id));
        let _ = fs::remove_dir_all(data_root().unwrap().join("attachments").join(&source_case));
        let _ = fs::remove_dir_all(dir);
    }

    fn write_v2_zip(path: &Path, manifest_files: Vec<PackageFile>) {
        let case =
            serde_json::to_vec(&serde_json::json!({"format":"clue-workbench-case","version":2}))
                .unwrap();
        let attachments = b"[]".to_vec();
        let manifest = serde_json::to_vec(&PackageManifest {
            format: "clue-workbench-case".into(),
            version: 2,
            files: manifest_files,
        })
        .unwrap();
        let mut zip = ZipWriter::new(fs::File::create(path).unwrap());
        for (name, bytes) in [
            ("case.json", case),
            ("attachments.json", attachments),
            ("manifest.json", manifest),
        ] {
            zip.start_file(name, SimpleFileOptions::default()).unwrap();
            zip.write_all(&bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn v2_manifest_rejects_missing_and_duplicate_entries() {
        let dir = env::temp_dir().join(format!("clue-workbench-manifest-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let case =
            serde_json::to_vec(&serde_json::json!({"format":"clue-workbench-case","version":2}))
                .unwrap();
        let attachment = b"[]".to_vec();
        let item = |path: &str, bytes: &[u8]| PackageFile {
            path: path.into(),
            sha256: sha256(bytes),
            size_bytes: bytes.len() as u64,
        };
        let missing = dir.join("missing.cluecase");
        write_v2_zip(&missing, vec![item("case.json", &case)]);
        assert!(read_v2_package(&missing).is_err());
        let duplicate = dir.join("duplicate.cluecase");
        write_v2_zip(
            &duplicate,
            vec![
                item("case.json", &case),
                item("attachments.json", &attachment),
                item("attachments.json", &attachment),
            ],
        );
        assert!(read_v2_package(&duplicate).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn archive_folder_migration_and_lifecycle_are_safe() {
        let _data_root = TestDataRoot::new();
        let conn = open().unwrap();
        let legacy_id = Uuid::new_v4().to_string();
        let legacy_name = format!("旧归档-{}", Uuid::new_v4());
        let timestamp = now();
        conn.execute("INSERT INTO cases(id,title,archive_folder,status,root_id,created_at,updated_at) VALUES(?1,'旧归档案件',?2,'archived','root',?3,?3)", params![legacy_id,legacy_name,timestamp]).unwrap();
        drop(conn);
        drop(open().unwrap());
        let conn = open().unwrap();
        let migrated: (Option<String>, String) = conn
            .query_row(
                "SELECT archive_folder_id,archive_folder FROM cases WHERE id=?1",
                [&legacy_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!(migrated.0.is_some());
        assert_eq!(migrated.1, legacy_name);
        let table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='archive_folders'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 1);
        let folder = create_archive_folder(&format!("归档测试-{}", Uuid::new_v4())).unwrap();
        assert!(create_archive_folder(&folder.name.to_uppercase()).is_err());
        let case_id = Uuid::new_v4().to_string();
        let timestamp = now();
        conn.execute("INSERT INTO cases(id,title,status,root_id,created_at,updated_at) VALUES(?1,'归档选择测试','active','root',?2,?2)", params![case_id,timestamp]).unwrap();
        archive_case(&case_id, "归档选择测试", "", Some(&folder.id)).unwrap();
        let archived = case_record(&conn, &case_id).unwrap();
        assert_eq!(
            archived.archive_folder_id.as_deref(),
            Some(folder.id.as_str())
        );
        assert_eq!(archived.archive_folder, folder.name);
        assert!(delete_archive_folder(&folder.id)
            .unwrap_err()
            .contains("1 个案件"));
        rename_archive_folder(&folder.id, "重命名归档").unwrap();
        let renamed = case_record(&conn, &case_id).unwrap();
        assert_eq!(renamed.archive_folder, "重命名归档");
        conn.execute(
            "UPDATE cases SET archive_folder_id=NULL,archive_folder='' WHERE id=?1",
            [&case_id],
        )
        .unwrap();
        delete_archive_folder(&folder.id).unwrap();
        assert!(!list_archive_folders()
            .unwrap()
            .iter()
            .any(|item| item.id == folder.id));
    }

    #[test]
    fn manifest_validation_rejects_tampered_package() {
        let dir = env::temp_dir().join(format!("clue-workbench-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let package = dir.join("案件包.json");
        fs::write(&package, b"original").unwrap();
        let manifest =
            serde_json::json!({"files":[{"path":"案件包.json","sha256":sha256(b"original")}]});
        fs::write(
            dir.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        assert!(validate_package_manifest(&package).is_ok());
        fs::write(&package, b"tampered").unwrap();
        assert!(validate_package_manifest(&package).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    fn history_counts(case_id: &str) -> (i64, i64) {
        let conn = open().unwrap();
        let snapshots = conn.query_row("SELECT COUNT(*) FROM case_snapshots WHERE case_id=?1", [case_id], |r| r.get(0)).unwrap();
        let redos = conn.query_row("SELECT COUNT(*) FROM case_redos WHERE case_id=?1", [case_id], |r| r.get(0)).unwrap();
        (snapshots, redos)
    }

    #[test]
    fn failed_attribute_mutations_preserve_undo_and_redo_stacks() {
        let _data_root = TestDataRoot::new();
        let case = create_case(CreateCaseInput { title: "失败属性历史".into(), background: String::new(), seed_kind: "qq".into(), seed_value: "history-seed".into() }).unwrap();
        let seed = get_case_detail(&case.id).unwrap().entities.into_iter().find(|e| e.kind == "qq").unwrap().id;
        upsert_attributes(&case.id, "entity", vec![AttributeRecord { id: String::new(), case_id: case.id.clone(), subject_id: seed, field_key: "tag".into(), value_type: "text".into(), value_text: "ok".into(), value_number: None, value_time: None, sort_order: 0, created_at: String::new(), updated_at: String::new() }]).unwrap();
        undo_case(&case.id).unwrap();
        let before = history_counts(&case.id);
        let invalid = AttributeRecord { id: String::new(), case_id: case.id.clone(), subject_id: "missing".into(), field_key: "tag".into(), value_type: "text".into(), value_text: "bad".into(), value_number: None, value_time: None, sort_order: 0, created_at: String::new(), updated_at: String::new() };
        assert!(upsert_attributes(&case.id, "entity", vec![invalid]).is_err());
        assert_eq!(history_counts(&case.id), before);
        assert!(delete_attribute(&case.id, "entity", "missing").is_err());
        assert_eq!(history_counts(&case.id), before);
    }

    #[test]
    fn trash_restore_require_existing_case_and_clear_opposite_metadata() {
        let _data_root = TestDataRoot::new();
        assert!(trash_case("missing").is_err());
        assert!(restore_case("missing").is_err());
        let case = create_case(CreateCaseInput { title: "状态互斥".into(), background: String::new(), seed_kind: "qq".into(), seed_value: "state-seed".into() }).unwrap();
        archive_case(&case.id, "归档标题", "归档说明", None).unwrap();
        trash_case(&case.id).unwrap();
        let conn = open().unwrap();
        let trashed: (String, Option<String>, String, Option<String>) = conn.query_row("SELECT status,archive_title,archive_note,archived_at FROM cases WHERE id=?1", [&case.id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
        assert_eq!(trashed, ("trash".into(), None, String::new(), None));
        drop(conn);
        restore_case(&case.id).unwrap();
        let conn = open().unwrap();
        let restored: (String, Option<String>, Option<String>) = conn.query_row("SELECT status,trashed_at,archive_title FROM cases WHERE id=?1", [&case.id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(restored, ("active".into(), None, None));
    }

    #[test]
    fn history_restore_relinks_existing_snapshot_attachment() {
        let data_root = TestDataRoot::new();
        let case = create_case(CreateCaseInput { title: "附件关联快照".into(), background: String::new(), seed_kind: "qq".into(), seed_value: "attachment-seed".into() }).unwrap();
        let seed = get_case_detail(&case.id).unwrap().entities.into_iter().find(|e| e.kind == "qq").unwrap().id;
        let source = data_root.path.join("source.txt");
        fs::write(&source, b"attachment").unwrap();
        let attachment = add_attachment(&case.id, source.to_str().unwrap(), "", Some(&seed), None).unwrap();
        upsert_attributes(&case.id, "entity", vec![AttributeRecord { id: String::new(), case_id: case.id.clone(), subject_id: seed.clone(), field_key: "tag".into(), value_type: "text".into(), value_text: "change".into(), value_number: None, value_time: None, sort_order: 0, created_at: String::new(), updated_at: String::new() }]).unwrap();
        undo_case(&case.id).unwrap();
        let restored = get_case_detail(&case.id).unwrap().attachments.into_iter().find(|a| a.id == attachment.id).unwrap();
        assert_eq!(restored.entity_id.as_deref(), Some(seed.as_str()));
        assert!(attachment_path(&case.id, &attachment.id).unwrap().is_file());
    }

    #[test]
    fn attachment_size_limit_matches_package_entry_limit() {
        let data_root = TestDataRoot::new();
        assert_eq!(MAX_ATTACHMENT_BYTES, 128 * 1024 * 1024);
        let case = create_case(CreateCaseInput { title: "附件上限".into(), background: String::new(), seed_kind: "qq".into(), seed_value: "limit-seed".into() }).unwrap();
        let source = data_root.path.join("oversized.bin");
        let file = fs::File::create(&source).unwrap();
        file.set_len(MAX_ATTACHMENT_BYTES + 1).unwrap();
        let error = match add_attachment(&case.id, source.to_str().unwrap(), "", None, None) {
            Ok(_) => panic!("超限附件不应被接受"),
            Err(error) => error,
        };
        assert!(error.contains("128 MB"));
        assert!(get_case_detail(&case.id).unwrap().attachments.is_empty());
    }

}


#[cfg(test)]
mod phone_contract_tests {
    use super::*;

    // 共享黄金夹具：与前端 vitest 读同一份 phone-fixtures.json，任何分叉=bug
    #[test]
    fn normalize_matches_shared_golden_fixtures() {
        let raw = include_str!("../../src/features/import/phone-fixtures.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).expect("夹具JSON无效");
        let cases = parsed["cases"].as_array().expect("夹具缺少cases");
        assert!(cases.len() >= 60, "夹具用例过少：{}", cases.len());
        for case in cases {
            let input = case["input"].as_str().unwrap();
            let expected = case["expected"].as_str().unwrap();
            let valid = case["valid"].as_bool().unwrap();
            let actual = normalize_phone_key(input);
            assert_eq!(actual, expected, "normalize 分叉 input={:?} tag={:?}", input, case["tag"]);
            assert_eq!(valid_canonical_phone(&actual), valid, "valid 分叉 input={:?} actual={:?} tag={:?}", input, actual, case["tag"]);
        }
    }

    #[test]
    fn normalize_is_idempotent_on_fixtures() {
        let raw = include_str!("../../src/features/import/phone-fixtures.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).unwrap();
        for case in parsed["cases"].as_array().unwrap() {
            let once = normalize_phone_key(case["input"].as_str().unwrap());
            let twice = normalize_phone_key(&once);
            assert_eq!(once, twice, "规范化不幂等 input={:?}", case["input"]);
        }
    }

    #[test]
    fn manual_mapping_accepts_international_phone() {
        // 手工映射：852 裸号国际手机号列全批唯一可通过并规范化为 + 形态
        let _root = tests::TestDataRoot::new();
        let case = create_case(CreateCaseInput { title: "intl-phone".into(), background: String::new(), seed_kind: "qq".into(), seed_value: "10001".into() }).unwrap();
        let raw_table = vec![
            vec!["QQ".to_string(), "手机号".to_string()],
            vec!["7112345678".to_string(), "852-0000 0001".to_string()],
            vec!["7112345678".to_string(), "+1 (415) 555-0100".to_string()],
        ];
        let input = ImportPlanInput {
            case_id: case.id.clone(),
            source_summary: "test".into(),
            template: "custom".into(),
            template_version: "manual-mapped-v1".into(),
            template_mode: "manual-mapped".into(),
            raw_table: raw_table.clone(),
            mapping: Some(serde_json::json!({"hasHeader":true,"sourceIndex":0,"sourceKind":"qq","targetIndex":1,"targetKind":"phone","displayNameIndex":null,"relationLabel":"持有"})),
            header_fingerprint: raw_table[0].join("\u{1f}"),
            input_digest: strict_digest(&raw_table),
            query_origin: None,
            current_source: None,
            overlap_candidates: vec![],
            parent_selection_reason: None,
            explicit_parent_key: None,
            endpoint_contract: serde_json::json!({}),
            duplicate_relations: 0,
            raw_row_count: 2,
            valid_row_count: 2,
            relation_count: 2,
            entity_count: 3,
            row_decisions: vec![serde_json::json!({"valid":true,"decision":"accepted"}), serde_json::json!({"valid":true,"decision":"accepted"})],
            batch_errors: vec![],
            bridge_relation_count: 0,
            entities: vec![],
            relations: vec![],
            error_count: 0,
        };
        let rebuilt = rebuild_manual_plan(&input).expect("国际手机号手工映射应通过");
        assert_eq!(rebuilt.relations.len(), 2);
        assert!(rebuilt.relations.iter().all(|r| r.target_kind == "phone" && r.target_key.starts_with('+')));
        assert!(rebuilt.relations.iter().any(|r| r.target_key == "+85200000001"));
        assert!(rebuilt.relations.iter().any(|r| r.target_key == "+14155550100"));
    }

    #[test]
    fn strict_lookup_accepts_international_phone() {
        // 严格 qq-phone-lookup 模板行校验接受 +852 形态并保持规范形
        let _root = tests::TestDataRoot::new();
        let case = create_case(CreateCaseInput { title: "intl-strict".into(), background: String::new(), seed_kind: "qq".into(), seed_value: "10001".into() }).unwrap();
        let headers = ["手机号(解密)","QQ账号(解密)","命中查询内容","错误备注","错误码类型","QQ账号","手机号","手机号类型","设置时间","修改时间","验证时间"];
        let row = vec!["+852 0000 0001".to_string(),"7112345678".into(),"7112345678".into(),"".into(),"【Success】成功".into(),"c1".into(),"c2".into(),"【1】密保手机".into(),"".into(),"".into(),"".into()];
        let raw_table = vec![headers.iter().map(|h| h.to_string()).collect::<Vec<_>>(), row];
        let input = ImportPlanInput {
            case_id: case.id.clone(),
            source_summary: "test".into(),
            template: "qq-phone-lookup".into(),
            template_version: "strict-v1".into(),
            template_mode: "strict-header".into(),
            raw_table: raw_table.clone(),
            mapping: None,
            header_fingerprint: raw_table[0].join("\u{1f}"),
            input_digest: strict_digest(&raw_table),
            query_origin: None,
            current_source: None,
            overlap_candidates: vec![],
            parent_selection_reason: None,
            explicit_parent_key: None,
            endpoint_contract: serde_json::json!({}),
            duplicate_relations: 0,
            raw_row_count: 1,
            valid_row_count: 1,
            relation_count: 1,
            entity_count: 2,
            row_decisions: vec![serde_json::json!({"valid":true,"decision":"accepted"})],
            batch_errors: vec![],
            bridge_relation_count: 0,
            entities: vec![],
            relations: vec![],
            error_count: 0,
        };
        let rebuilt = rebuild_strict_plan(&input, &Default::default()).expect("国际手机号严格模板应通过");
        assert_eq!(rebuilt.relations[0].target_key, "+85200000001");
        assert_eq!(rebuilt.query_origin.as_ref().unwrap().key, "7112345678");
    }

    #[test]
    fn quick_add_normalizes_international_phone_label() {
        // 快捷录入：同一号码两种写法只生成一个 phone 实体
        let _root = tests::TestDataRoot::new();
        let case = create_case(CreateCaseInput { title: "intl-quick".into(), background: String::new(), seed_kind: "qq".into(), seed_value: "10001".into() }).unwrap();
        let detail = get_case_detail(&case.id).unwrap();
        let source = detail.entities.iter().find(|e| e.kind == "qq").unwrap();
        let input = || AddRelationsInput {
            case_id: case.id.clone(),
            source_id: source.id.clone(),
            target_kind: "phone".into(),
            values: vec!["+852 0000 0001".into(), "852-0000-0001".into()],
            display_names: vec![],
            label: "持有机".into(),
            spread: "同设备".into(),
            note: String::new(),
            custom_type: String::new(),
            source: "test".into(),
            attributes: vec![],
            entity_attributes: vec![],
            relation_attributes: vec![],
        };
        let result = add_relations(input()).unwrap();
        assert_eq!(result.added_count, 1, "两种写法应去重为一条关系");
        let after = get_case_detail(&case.id).unwrap();
        let phones: Vec<&str> = after.entities.iter().filter(|e| e.kind == "phone").map(|e| e.label.as_str()).collect();
        assert_eq!(phones, vec!["+85200000001"]);
    }
}


#[cfg(test)]
mod quick_add_attribute_tests {
    use super::*;

    fn attr(key:&str,value_type:&str,text:&str,number:Option<f64>)->PlannedAttributeInput{PlannedAttributeInput{field_key:key.into(),value_type:value_type.into(),value_text:text.into(),value_number:number,value_time:None}}

    #[test]
    fn quick_add_writes_entity_and_relation_attributes_and_updates_existing() {
        let _root=tests::TestDataRoot::new();
        let case=create_case(CreateCaseInput{title:"quick-fields".into(),background:String::new(),seed_kind:"qq".into(),seed_value:"10001".into()}).unwrap();
        let detail=get_case_detail(&case.id).unwrap();
        let source=detail.entities.iter().find(|entity|entity.kind=="qq").unwrap();
        let input=||AddRelationsInput{case_id:case.id.clone(),source_id:source.id.clone(),target_kind:"group".into(),values:vec!["20002".into()],display_names:vec!["测试群".into()],label:"加入群".into(),spread:"群聊扩散".into(),note:String::new(),custom_type:String::new(),source:"quick-test".into(),attributes:vec![],entity_attributes:vec![attr("group_name","text","测试群",None),attr("member_count","number","120",Some(120.0))],relation_attributes:vec![attr("query_role","enum","群主",None)]};
        let first=add_relations(input()).unwrap();
        assert_eq!(first.added_count,1);assert_eq!(first.attribute_count,3);
        let after=get_case_detail(&case.id).unwrap();
        let target=after.entities.iter().find(|entity|entity.kind=="group"&&entity.label=="20002").unwrap();
        let relation=after.relations.iter().find(|relation|relation.source_id==source.id&&relation.target_id==target.id).unwrap();
        assert!(after.entity_attributes.iter().any(|item|item.subject_id==target.id&&item.field_key=="member_count"&&item.value_number==Some(120.0)));
        assert!(after.relation_attributes.iter().any(|item|item.subject_id==relation.id&&item.field_key=="query_role"&&item.value_text=="群主"));
        let mut update=input();update.entity_attributes=vec![attr("member_count","number","150",Some(150.0))];update.relation_attributes=vec![];
        let second=add_relations(update).unwrap();assert_eq!(second.added_count,0);assert_eq!(second.attribute_count,1);assert!(second.batch.is_some());
        let updated=get_case_detail(&case.id).unwrap();assert!(updated.entity_attributes.iter().any(|item|item.subject_id==target.id&&item.field_key=="member_count"&&item.value_number==Some(150.0)));
        undo_import_batch(&case.id,&second.batch.unwrap().id).unwrap();
        let restored=get_case_detail(&case.id).unwrap();assert!(restored.entity_attributes.iter().any(|item|item.subject_id==target.id&&item.field_key=="member_count"&&item.value_number==Some(120.0)));
    }
}
