use clue_workbench::case_core::{
    self, AddRelationsInput, AddRelationsResult, ArchiveFolder, Attachment, AttributeRecord,
    CaseDetail, CaseOverviewInput, CaseRecord, CreateCaseInput, Entity, ExportResult,
    HistoryRestoreResult, ImportBatch, ImportPlanInput, ImportPlanResult, Relation,
};
use rusqlite::params;
use serde::Serialize;
use std::fs;
#[cfg(target_os = "macos")]
use std::{io::Read, process::{Command, Stdio}};
#[cfg(target_os = "windows")]
use std::process::Command;

const MAX_CLIPBOARD_BYTES: usize = 10 * 1024 * 1024;

#[cfg(target_os = "macos")]
fn read_clipboard_text_native_impl() -> Result<String, String> {
    let mut child = Command::new("/usr/bin/pbpaste")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法启动 /usr/bin/pbpaste: {error}"))?;
    let mut bytes = Vec::new();
    child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 /usr/bin/pbpaste 输出".to_string())?
        .take((MAX_CLIPBOARD_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取 /usr/bin/pbpaste 输出失败: {error}"))?;
    if bytes.len() > MAX_CLIPBOARD_BYTES {
        let _ = child.kill();
        let _ = child.wait();
        return clipboard_text_from_bytes(bytes, MAX_CLIPBOARD_BYTES);
    }
    let status = child
        .wait()
        .map_err(|error| format!("等待 /usr/bin/pbpaste 失败: {error}"))?;
    if !status.success() {
        return Err(format!(
            "/usr/bin/pbpaste 读取失败（退出码 {}）",
            status
                .code()
                .map_or_else(|| "未知".to_string(), |code| code.to_string())
        ));
    }
    clipboard_text_from_bytes(bytes, MAX_CLIPBOARD_BYTES)
}

#[cfg(target_os = "windows")]
fn read_clipboard_text_native_impl() -> Result<String, String> {
    // Windows：PowerShell Get-Clipboard 读纯文本（-Raw 保留换行原样）
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"])
        .output()
        .map_err(|error| format!("无法启动 PowerShell：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "PowerShell 剪贴板读取失败（退出码 {}）",
            output.status.code().unwrap_or(-1)
        ));
    }
    clipboard_text_from_windows_bytes(output.stdout, MAX_CLIPBOARD_BYTES)
}

#[tauri::command]
fn read_clipboard_text_native() -> Result<String, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        read_clipboard_text_native_impl()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("原生剪贴板回退仅支持 macOS / Windows".to_string())
    }
}
use tauri_plugin_opener::OpenerExt;

// 纯字节解码（macOS 运行时使用；Windows 走 clipboard_text_from_windows_bytes）
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn clipboard_text_from_bytes(bytes: Vec<u8>, max_bytes: usize) -> Result<String, String> {
    if bytes.len() > max_bytes {
        return Err(format!("剪贴板文本超过 {} 字节限制", max_bytes));
    }
    String::from_utf8(bytes).map_err(|_| "剪贴板文本不是有效 UTF-8".into())
}

// 纯字节解码，无平台依赖；全平台编译以便测试覆盖（Windows 运行时使用）
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn clipboard_text_from_windows_bytes(bytes: Vec<u8>, max_bytes: usize) -> Result<String, String> {
    if bytes.len() > max_bytes {
        return Err(format!("剪贴板文本超过 {} 字节限制", max_bytes));
    }
    // Windows PowerShell 5.1 stdout 重定向编码：UTF-16LE（带 FFFE BOM）或 OEM 代码页。
    // 有 BOM → 去 BOM 后按 UTF-16LE 解码；无 BOM → 先尝试 UTF-8，失败再按 UTF-16LE 兜底。
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return Ok(String::from_utf16_lossy(&units));
    }
    String::from_utf8(bytes.clone()).or_else(|_| {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        Ok(String::from_utf16_lossy(&units))
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageLayout {
    root: String,
    database: String,
    attachments: String,
    exports: String,
    backups: String,
    snapshots: String,
    logs: String,
}

fn log_event(message: &str) {
    if let Ok(root) = case_core::data_root() {
        let log_path = root.join("logs").join("desktop-runtime.log");
        let line = format!(
            "{} {}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
            message
        );
        let _ = fs::create_dir_all(root.join("logs"));
        use std::io::Write;
        if let Ok(mut file) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
        {
            let _ = file.write_all(line.as_bytes());
        }
    }
}

fn layout() -> Result<StorageLayout, String> {
    let root = case_core::data_root()?;
    for name in ["attachments", "exports", "backups", "snapshots", "logs"] {
        fs::create_dir_all(root.join(name)).map_err(|error| error.to_string())?;
    }
    Ok(StorageLayout {
        database: root.join("casework.sqlite3").display().to_string(),
        attachments: root.join("attachments").display().to_string(),
        exports: root.join("exports").display().to_string(),
        backups: root.join("backups").display().to_string(),
        snapshots: root.join("snapshots").display().to_string(),
        logs: root.join("logs").display().to_string(),
        root: root.display().to_string(),
    })
}

#[tauri::command]
fn initialize_storage() -> Result<StorageLayout, String> {
    log_event("initialize_storage:start");
    let result = case_core::open().and_then(|_| layout());
    log_event(if result.is_ok() {
        "initialize_storage:ok"
    } else {
        "initialize_storage:error"
    });
    result
}

#[tauri::command]
fn get_external_revision() -> Result<String, String> {
    case_core::revision()
}

#[tauri::command]
fn list_cases(status: Option<String>) -> Result<Vec<CaseRecord>, String> {
    log_event("list_cases:start");
    let result = case_core::list_cases(status.as_deref());
    match &result {
        Ok(items) => log_event(&format!("list_cases:ok count={}", items.len())),
        Err(error) => log_event(&format!("list_cases:error {error}")),
    }
    result
}

#[tauri::command]
fn list_archive_folders() -> Result<Vec<ArchiveFolder>, String> {
    case_core::list_archive_folders()
}
#[tauri::command]
fn create_archive_folder(name: String) -> Result<ArchiveFolder, String> {
    case_core::create_archive_folder(&name)
}
#[tauri::command]
fn rename_archive_folder(id: String, name: String) -> Result<(), String> {
    case_core::rename_archive_folder(&id, &name)
}
#[tauri::command]
fn delete_archive_folder(id: String) -> Result<(), String> {
    case_core::delete_archive_folder(&id)
}

#[tauri::command]
fn get_case_detail(id: String) -> Result<CaseDetail, String> {
    case_core::get_case_detail(&id)
}

#[tauri::command]
fn create_case(
    title: String,
    background: String,
    seed_kind: String,
    seed_value: String,
) -> Result<CaseRecord, String> {
    case_core::create_case(CreateCaseInput {
        title,
        background,
        seed_kind,
        seed_value,
    })
}

#[tauri::command]
fn add_relations(
    case_id: String,
    source_id: String,
    target_kind: String,
    values: Vec<String>,
    display_names: Option<Vec<String>>,
    label: String,
    spread: String,
    note: String,
    custom_type: String,
    source: Option<String>,
    attributes: Option<Vec<case_core::PlannedAttributeInput>>,
    entity_attributes: Option<Vec<case_core::PlannedAttributeInput>>,
    relation_attributes: Option<Vec<case_core::PlannedAttributeInput>>,
) -> Result<AddRelationsResult, String> {
    case_core::add_relations(AddRelationsInput {
        case_id,
        source_id,
        target_kind,
        values,
        display_names: display_names.unwrap_or_default(),
        label,
        spread,
        note,
        custom_type,
        source: source.unwrap_or_else(|| "手工录入".into()),
        attributes: attributes.unwrap_or_default(),
        entity_attributes: entity_attributes.unwrap_or_default(),
        relation_attributes: relation_attributes.unwrap_or_default(),
    })
}

#[tauri::command]
fn import_plan(input: ImportPlanInput) -> Result<ImportPlanResult, String> {
    case_core::import_plan(input)
}

#[tauri::command]
fn list_import_batches(case_id: String) -> Result<Vec<ImportBatch>, String> {
    case_core::list_import_batches(&case_id)
}

#[tauri::command]
fn undo_import_batch(case_id: String, batch_id: String) -> Result<usize, String> {
    case_core::undo_import_batch(&case_id, &batch_id)
}

#[tauri::command]
fn update_case_overview(input: CaseOverviewInput) -> Result<(), String> {
    case_core::update_case_overview(input)
}

#[tauri::command]
fn update_entity(entity: Entity) -> Result<(), String> {
    case_core::update_entity(entity)
}

#[tauri::command]
fn delete_entity(case_id: String, entity_id: String) -> Result<(), String> {
    case_core::delete_entity(&case_id, &entity_id)
}

#[tauri::command]
fn update_relation(relation: Relation) -> Result<(), String> {
    case_core::update_relation(relation)
}

#[tauri::command]
fn upsert_attributes(
    case_id: String,
    subject_kind: String,
    attributes: Vec<AttributeRecord>,
) -> Result<Vec<AttributeRecord>, String> {
    case_core::upsert_attributes(&case_id, &subject_kind, attributes)
}

#[tauri::command]
fn delete_attribute(
    case_id: String,
    subject_kind: String,
    attribute_id: String,
) -> Result<(), String> {
    case_core::delete_attribute(&case_id, &subject_kind, &attribute_id)
}

#[tauri::command]
fn undo_case(case_id: String) -> Result<HistoryRestoreResult, String> {
    case_core::undo_case(&case_id)
}

#[tauri::command]
fn redo_case(case_id: String) -> Result<HistoryRestoreResult, String> {
    case_core::redo_case(&case_id)
}

#[tauri::command]
fn reorder_cases(ids: Vec<String>) -> Result<(), String> {
    let conn = case_core::open()?;
    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    for (index, id) in ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE cases SET sort_order=?1 WHERE id=?2",
                params![index as i64, id],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn archive_case(
    id: String,
    archive_title: String,
    note: String,
    folder_id: Option<String>,
) -> Result<(), String> {
    case_core::archive_case(&id, &archive_title, &note, folder_id.as_deref())
}

#[tauri::command]
fn restore_case(id: String) -> Result<(), String> {
    case_core::restore_case(&id)
}

#[tauri::command]
fn trash_case(id: String) -> Result<(), String> {
    case_core::trash_case(&id)
}

#[tauri::command]
fn permanently_delete_case(id: String, confirmed_title: String) -> Result<(), String> {
    case_core::permanently_delete_case(&id,&confirmed_title)
}

#[tauri::command]
fn add_attachment(
    case_id: String,
    source_path: String,
    note: String,
    entity_id: Option<String>,
    relation_id: Option<String>,
) -> Result<Attachment, String> {
    case_core::add_attachment(
        &case_id,
        &source_path,
        &note,
        entity_id.as_deref(),
        relation_id.as_deref(),
    )
}

#[tauri::command]
fn update_attachment_note(
    case_id: String,
    attachment_id: String,
    note: String,
) -> Result<(), String> {
    case_core::update_attachment_note(&case_id, &attachment_id, &note)
}

#[tauri::command]
fn delete_attachment(case_id: String, attachment_id: String) -> Result<(), String> {
    case_core::delete_attachment(&case_id, &attachment_id)
}

#[tauri::command]
fn open_attachment(
    app: tauri::AppHandle,
    case_id: String,
    attachment_id: String,
) -> Result<(), String> {
    let path = case_core::attachment_path(&case_id, &attachment_id)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<String>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn export_case(id: String) -> Result<ExportResult, String> {
    case_core::export_case(&id)
}

#[tauri::command]
fn export_case_to(id: String, destination_root: String) -> Result<ExportResult, String> {
    case_core::export_case_to(&id, Some(&destination_root))
}

#[tauri::command]
fn import_case_package(package_path: String) -> Result<CaseRecord, String> {
    case_core::import_case_package(&package_path)
}

#[cfg(test)]
mod clipboard_tests {
    use super::*;

    #[test]
    fn utf8_preserves_tabs_and_newlines() {
        let text = "来源QQ\t目标QQ\n10001\t20002\n";
        assert_eq!(
            clipboard_text_from_bytes(text.as_bytes().to_vec(), MAX_CLIPBOARD_BYTES).unwrap(),
            text
        );
    }

    #[test]
    fn rejects_output_over_limit() {
        let error = clipboard_text_from_bytes(vec![b'a'; 5], 4).unwrap_err();
        assert!(error.contains("超过 4 字节限制"));
    }

    #[test]
    fn rejects_non_utf8_output() {
        let error = clipboard_text_from_bytes(vec![0xff, 0xfe], MAX_CLIPBOARD_BYTES).unwrap_err();
        assert!(error.contains("不是有效 UTF-8"));
    }

    #[test]
    fn windows_bytes_utf16le_with_bom_decodes() {
        // PowerShell 5.1 重定向输出：FF FE BOM + UTF-16LE
        let text = "来源QQ\t目标QQ\n10001\t20002\n";
        let mut bytes = vec![0xFF, 0xFE];
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(
            clipboard_text_from_windows_bytes(bytes, MAX_CLIPBOARD_BYTES).unwrap(),
            text
        );
    }

    #[test]
    fn windows_bytes_utf8_without_bom_decodes() {
        // PowerShell 7+ 或显式 UTF-8 输出：无 BOM UTF-8
        let text = "线索研判\t导入测试\n";
        assert_eq!(
            clipboard_text_from_windows_bytes(text.as_bytes().to_vec(), MAX_CLIPBOARD_BYTES).unwrap(),
            text
        );
    }

    #[test]
    fn windows_bytes_rejects_over_limit() {
        let error = clipboard_text_from_windows_bytes(vec![b'a'; 5], 4).unwrap_err();
        assert!(error.contains("超过 4 字节限制"));
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            log_event("desktop:setup");
            case_core::open().map_err(std::io::Error::other)?;
            let _ = app.handle();
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            read_clipboard_text_native,
            initialize_storage,
            get_external_revision,
            list_cases,
            list_archive_folders,
            create_archive_folder,
            rename_archive_folder,
            delete_archive_folder,
            get_case_detail,
            create_case,
            add_relations,
            import_plan,
            list_import_batches,
            undo_import_batch,
            update_case_overview,
            update_entity,
            delete_entity,
            update_relation,
            upsert_attributes,
            delete_attribute,
            undo_case,
            redo_case,
            reorder_cases,
            archive_case,
            restore_case,
            trash_case,
            permanently_delete_case,
            add_attachment,
            update_attachment_note,
            delete_attachment,
            open_attachment,
            export_case,
            export_case_to,
            import_case_package
        ])
        .run(tauri::generate_context!())
        .expect("桌面程序启动失败");
}
