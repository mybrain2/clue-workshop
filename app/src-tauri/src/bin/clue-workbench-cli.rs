use clue_workbench::case_core::{
    self, AddRelationsInput, CaseOverviewInput, CreateCaseInput, Entity, ImportPlanInput, Relation,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::{env, fs, process::Command};

fn fail(message: impl Into<String>) -> ! {
    println!("{}", json!({"ok":false,"error":message.into()}));
    std::process::exit(2);
}

fn output<T: Serialize>(result: T) {
    println!("{}", json!({"ok":true,"result":result}));
}

fn value(flag: &str, args: &[String]) -> Option<String> {
    args.iter()
        .position(|arg| arg == flag)
        .and_then(|index| args.get(index + 1))
        .cloned()
}

fn json_input<T: DeserializeOwned>(args: &[String]) -> T {
    let raw = value("--json", args).unwrap_or_else(|| fail("缺少 --json 参数"));
    let content = if let Some(path) = raw.strip_prefix('@') {
        fs::read_to_string(path).unwrap_or_else(|error| fail(format!("无法读取 JSON 文件：{error}")))
    } else { raw };
    serde_json::from_str(&content).unwrap_or_else(|error| fail(format!("JSON 参数无效：{error}")))
}

fn required(flag: &str, args: &[String]) -> String {
    value(flag, args).unwrap_or_else(|| fail(format!("缺少 {flag} 参数")))
}

fn help() {
    println!(
        "{}",
        r#"线索研判 CLI

所有命令输出 JSON。推荐写入命令使用 --json。

命令：
  health
  revision
  case-list [--status active|archived|trash]
  case-get --id <case-id>
  case-create --json '{"title":...,"background":...,"seedKind":...,"seedValue":...}'
  case-overview-update --json '{"id":...,"background":...,"policeDisposal":...,"currentStatus":...,"pathLanes":[...]}'
  relation-add --json '{"caseId":...,"sourceId":...,"targetKind":...,"values":[...],"label":...,"spread":...,"note":...}'
  import-plan --json '@<plan.json>'
  import-batch-list --case-id <case-id>
  import-batch-undo --case-id <case-id> --batch-id <batch-id>
  entity-update --json '<Entity JSON>'
  entity-delete --case-id <case-id> --entity-id <entity-id>
  relation-update --json '<Relation JSON>'
  case-archive --json '{"id":...,"archiveTitle":...,"note":...}'
  case-restore --id <case-id>
  case-trash --id <case-id>
  case-purge --id <case-id> --title <案件名称>
  case-undo --id <case-id>
  case-redo --id <case-id>
  export --id <case-id> [--destination <directory>]
  backup-all --destination <directory> [--status active|archived|trash]
  case-import --path <案件包.json>
  app-open [--path <app-path>]
"#
    );
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let command = args.first().map(String::as_str).unwrap_or("help");
    let result: Result<Value, String> = match command {
        "help" | "--help" | "-h" => {
            help();
            return;
        }
        "health" => case_core::open()
            .and_then(|_| case_core::database_path())
            .map(|path| json!({"status":"ok","database":path.display().to_string()})),
        "revision" => case_core::revision().map(|revision| json!({"revision":revision})),
        "case-list" => case_core::list_cases(value("--status", &args).as_deref())
            .and_then(|items| serde_json::to_value(items).map_err(|e| e.to_string())),
        "case-get" => case_core::get_case_detail(&required("--id", &args))
            .and_then(|detail| serde_json::to_value(detail).map_err(|e| e.to_string())),
        "case-create" => {
            let input: CreateCaseInput = json_input(&args);
            case_core::create_case(input)
                .and_then(|item| serde_json::to_value(item).map_err(|e| e.to_string()))
        }
        "case-overview-update" => {
            let input: CaseOverviewInput = json_input(&args);
            case_core::update_case_overview(input).map(|_| json!({"updated":true}))
        }
        "relation-add" => {
            let input: AddRelationsInput = json_input(&args);
            case_core::add_relations(input).map(|added| json!({"added":added}))
        }
        "import-plan" => {
            let input: ImportPlanInput = json_input(&args);
            case_core::import_plan(input).and_then(|result| serde_json::to_value(result).map_err(|e|e.to_string()))
        }
        "import-batch-list" => case_core::list_import_batches(&required("--case-id", &args)).and_then(|items|serde_json::to_value(items).map_err(|e|e.to_string())),
        "import-batch-undo" => case_core::undo_import_batch(&required("--case-id", &args),&required("--batch-id", &args)).map(|removed|json!({"removed":removed})),
        "entity-update" => {
            let entity: Entity = json_input(&args);
            case_core::update_entity(entity).map(|_| json!({"updated":true}))
        }
        "entity-delete" => case_core::delete_entity(
            &required("--case-id", &args),
            &required("--entity-id", &args),
        )
        .map(|_| json!({"deleted":true})),
        "relation-update" => {
            let relation: Relation = json_input(&args);
            case_core::update_relation(relation).map(|_| json!({"updated":true}))
        }
        "case-archive" => {
            let payload: Value = json_input(&args);
            match payload.get("id").and_then(Value::as_str) {
                Some(id) => {
                    let title = payload
                        .get("archiveTitle")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let note = payload.get("note").and_then(Value::as_str).unwrap_or("");
                    let folder_id = payload.get("folderId").and_then(Value::as_str);
                    case_core::archive_case(id, title, note, folder_id)
                        .map(|_| json!({"archived":true}))
                }
                None => Err("归档缺少 id".into()),
            }
        }
        "case-restore" => {
            case_core::restore_case(&required("--id", &args)).map(|_| json!({"restored":true}))
        }
        "case-trash" => {
            case_core::trash_case(&required("--id", &args)).map(|_| json!({"trashed":true}))
        }
        "case-purge" => {
            case_core::permanently_delete_case(&required("--id", &args), &required("--title", &args)).map(|_| json!({"purged":true}))
        }
        "case-undo" => {
            case_core::undo_case(&required("--id", &args)).map(|_| json!({"undone":true}))
        }
        "case-redo" => {
            case_core::redo_case(&required("--id", &args)).map(|_| json!({"redone":true}))
        }
        "export" => {
            let id = required("--id", &args);
            case_core::export_case_to(&id, value("--destination", &args).as_deref())
                .and_then(|item| serde_json::to_value(item).map_err(|e| e.to_string()))
        }
        "backup-all" => {
            let destination=required("--destination",&args);
            case_core::list_cases(value("--status",&args).as_deref()).and_then(|cases|{
                let mut exports=Vec::with_capacity(cases.len());
                for case in cases { exports.push(case_core::export_case_to(&case.id,Some(&destination))?); }
                serde_json::to_value(json!({"destination":destination,"caseCount":exports.len(),"exports":exports})).map_err(|e|e.to_string())
            })
        }
        "case-import" => case_core::import_case_package(&required("--path", &args))
            .and_then(|item| serde_json::to_value(item).map_err(|e| e.to_string())),
        "app-open" => {
            #[cfg(target_os = "macos")]
            let default_app_path: String = "/Applications/线索研判.app".into();
            #[cfg(target_os = "windows")]
            let default_app_path: String = std::env::var_os("LOCALAPPDATA")
                .map(|base| {
                    std::path::PathBuf::from(base)
                        .join("线索研判")
                        .join("线索研判.exe")
                        .to_string_lossy()
                        .into_owned()
                })
                .unwrap_or_else(|| "线索研判.exe".into());
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let default_app_path: String = "clue-workbench".into();
            let path = value("--path", &args)
                .or_else(|| env::var("CLUE_WORKBENCH_APP_PATH").ok())
                .unwrap_or_else(|| default_app_path.clone());
            #[cfg(target_os = "macos")]
            let status = Command::new("open").args(["-n", &path]).status();
            #[cfg(target_os = "windows")]
            let status = Command::new("cmd").args(["/C", "start", "", "/D", &path]).status();
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let status = Command::new(&path).status();
            match status {
                Ok(status) if status.success() => Ok(json!({"opened":path})),
                Ok(status) => Err(format!("软件启动失败，退出码：{status}")),
                Err(error) => Err(format!("无法启动软件：{error}")),
            }
        }
        _ => Err(format!("未知命令：{command}；运行 help 查看可用命令")),
    };
    match result {
        Ok(value) => output(value),
        Err(error) => fail(error),
    }
}
