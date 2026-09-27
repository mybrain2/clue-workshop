use super::*;

struct IsolatedRoot(PathBuf);

impl IsolatedRoot {
    fn new() -> Self {
        let path = env::temp_dir().join(format!("clue-attributes-test-{}", Uuid::new_v4()));
        TEST_DATA_ROOT.with(|root| {
            assert!(root.borrow().is_none());
            *root.borrow_mut() = Some(path.clone());
        });
        Self(path)
    }
}

impl Drop for IsolatedRoot {
    fn drop(&mut self) {
        TEST_DATA_ROOT.with(|root| *root.borrow_mut() = None);
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn test_case(name: &str) -> (CaseRecord, CaseDetail, String) {
    let case = create_case(CreateCaseInput {
        title: name.into(),
        background: String::new(),
        seed_kind: "qq".into(),
        seed_value: format!("seed-{}", Uuid::new_v4()),
    })
    .unwrap();
    let detail = get_case_detail(&case.id).unwrap();
    let seed = detail
        .entities
        .iter()
        .find(|entity| entity.kind == "qq")
        .unwrap()
        .id
        .clone();
    (case, detail, seed)
}

fn attribute(case_id: &str, subject_id: &str, key: &str, value: &str) -> AttributeRecord {
    AttributeRecord {
        id: String::new(),
        case_id: case_id.into(),
        subject_id: subject_id.into(),
        field_key: key.into(),
        value_type: "text".into(),
        value_text: value.into(),
        value_number: None,
        value_time: None,
        sort_order: 0,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

fn add_one_relation(case_id: &str, source_id: &str, attributes: Vec<PlannedAttributeInput>) -> String {
    add_relations(AddRelationsInput {
        case_id: case_id.into(),
        source_id: source_id.into(),
        target_kind: "custom".into(),
        values: vec![format!("target-{}", Uuid::new_v4())],
        display_names: vec![],
        label: "测试关系".into(),
        spread: "测试扩散".into(),
        note: "测试备注".into(),
        custom_type: "测试类型".into(),
        source: "专项测试".into(),
        attributes,
        entity_attributes: vec![],
        relation_attributes: vec![],
    })
    .unwrap();
    get_case_detail(case_id).unwrap().relations.last().unwrap().id.clone()
}

fn table_count(conn: &Connection, table: &str, case_id: &str) -> i64 {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM {table} WHERE case_id=?1"),
        [case_id],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn attribute_upsert_updates_single_current_value_and_deletes() {
    let _root = IsolatedRoot::new();
    let (case, _, seed) = test_case("属性增删");
    let first = attribute(&case.id, &seed, "account.tag", "重点");
    let second = attribute(&case.id, &seed, "account.tag", "外围");
    let rows = upsert_attributes(
        &case.id,
        "entity",
        vec![first.clone(), first, second],
    )
    .unwrap();
    let values: Vec<_> = rows
        .iter()
        .filter(|row| row.subject_id == seed && row.field_key == "account.tag")
        .map(|row| row.value_text.as_str())
        .collect();
    assert_eq!(values, vec!["外围"]);
    assert_eq!(rows.len(), 1);

    delete_attribute(&case.id, "entity", &rows[0].id).unwrap();
    assert_eq!(get_case_detail(&case.id).unwrap().entity_attributes.len(), 0);
    assert!(delete_attribute(&case.id, "entity", &rows[0].id).is_err());
}

#[test]
fn deleting_entity_cascades_entity_relation_and_relation_attributes() {
    let _root = IsolatedRoot::new();
    let (case, _, seed) = test_case("属性级联");
    let relation_id = add_one_relation(
        &case.id,
        &seed,
        vec![PlannedAttributeInput {
            field_key: "evidence".into(),
            value_type: "text".into(),
            value_text: "同设备登录".into(),
            value_number: None,
            value_time: None,
        }],
    );
    let detail = get_case_detail(&case.id).unwrap();
    let target = detail
        .relations
        .iter()
        .find(|relation| relation.id == relation_id)
        .unwrap()
        .target_id
        .clone();
    upsert_attributes(
        &case.id,
        "entity",
        vec![attribute(&case.id, &target, "risk", "high")],
    )
    .unwrap();

    delete_entity(&case.id, &target).unwrap();
    let conn = open().unwrap();
    assert_eq!(table_count(&conn, "entity_attributes", &case.id), 0);
    assert_eq!(table_count(&conn, "relation_attributes", &case.id), 0);
    assert_eq!(table_count(&conn, "relations", &case.id), 1);
}

#[test]
fn cross_case_attributes_are_rejected_by_api_and_database_triggers() {
    let _root = IsolatedRoot::new();
    let (case_a, _, seed_a) = test_case("案件 A");
    let (case_b, _, _) = test_case("案件 B");
    let wrong_case = attribute(&case_b.id, &seed_a, "tag", "跨案件");
    assert!(upsert_attributes(&case_b.id, "entity", vec![wrong_case]).is_err());

    let conn = open().unwrap();
    let direct = conn.execute(
        "INSERT INTO entity_attributes(id,case_id,subject_id,field_key,value_type,value_text,sort_order,created_at,updated_at) VALUES(?1,?2,?3,'tag','text','跨案件',0,?4,?4)",
        params![Uuid::new_v4().to_string(), case_b.id, seed_a, now()],
    );
    assert!(direct.is_err());
    assert_eq!(table_count(&conn, "entity_attributes", &case_a.id), 0);
    assert_eq!(table_count(&conn, "entity_attributes", &case_b.id), 0);
}

#[test]
fn undo_and_redo_restore_attribute_snapshots() {
    let _root = IsolatedRoot::new();
    let (case, _, seed) = test_case("属性撤销重做");
    upsert_attributes(
        &case.id,
        "entity",
        vec![attribute(&case.id, &seed, "tag", "恢复值")],
    )
    .unwrap();
    assert_eq!(get_case_detail(&case.id).unwrap().entity_attributes.len(), 1);

    undo_case(&case.id).unwrap();
    assert!(get_case_detail(&case.id).unwrap().entity_attributes.is_empty());
    redo_case(&case.id).unwrap();
    let restored = get_case_detail(&case.id).unwrap();
    assert_eq!(restored.entity_attributes.len(), 1);
    assert_eq!(restored.entity_attributes[0].value_text, "恢复值");
}

fn write_package(path: &Path, case_json: Vec<u8>, manifest_version: u32) {
    let attachments = b"[]".to_vec();
    let files = vec![
        PackageFile {
            path: "case.json".into(),
            sha256: sha256(&case_json),
            size_bytes: case_json.len() as u64,
        },
        PackageFile {
            path: "attachments.json".into(),
            sha256: sha256(&attachments),
            size_bytes: attachments.len() as u64,
        },
    ];
    let manifest = serde_json::to_vec(&PackageManifest {
        format: "clue-workbench-case".into(),
        version: manifest_version,
        files,
    })
    .unwrap();
    let mut zip = ZipWriter::new(fs::File::create(path).unwrap());
    for (name, bytes) in [
        ("case.json", case_json),
        ("attachments.json", attachments),
        ("manifest.json", manifest),
    ] {
        zip.start_file(name, SimpleFileOptions::default()).unwrap();
        zip.write_all(&bytes).unwrap();
    }
    zip.finish().unwrap();
}

#[test]
fn cluecase_v3_roundtrip_restores_attributes_v2_defaults_empty_and_versions_must_match() {
    let _root = IsolatedRoot::new();
    let (case, _, seed) = test_case("v3 属性往返");
    let relation_id = add_one_relation(
        &case.id,
        &seed,
        vec![PlannedAttributeInput {
            field_key: "relation.note".into(),
            value_type: "text".into(),
            value_text: "关系属性".into(),
            value_number: None,
            value_time: None,
        }],
    );
    upsert_attributes(
        &case.id,
        "entity",
        vec![attribute(&case.id, &seed, "entity.note", "对象属性")],
    )
    .unwrap();
    let detail = get_case_detail(&case.id).unwrap();
    assert!(detail.relation_attributes.iter().any(|a| a.subject_id == relation_id));
    let export_root = data_root().unwrap().join("attribute-export");
    let package = export_case_v2(&detail, &export_root).unwrap();
    let imported = import_case_package(&package.package_path).unwrap();
    let restored = get_case_detail(&imported.id).unwrap();
    assert_eq!(restored.entity_attributes.len(), 1);
    assert_eq!(restored.relation_attributes.len(), 1);
    assert_eq!(restored.entity_attributes[0].value_text, "对象属性");
    assert_eq!(restored.relation_attributes[0].value_text, "关系属性");

    let mut v2 = serde_json::to_value(CasePackage {
        format: "clue-workbench-case".into(),
        version: 2,
        exported_at: now(),
        detail: CasePackageDetail::from(&detail),
    })
    .unwrap();
    v2["detail"].as_object_mut().unwrap().remove("entityAttributes");
    v2["detail"].as_object_mut().unwrap().remove("relationAttributes");
    let v2_path = data_root().unwrap().join("legacy-v2.cluecase");
    write_package(&v2_path, serde_json::to_vec(&v2).unwrap(), 2);
    let imported_v2 = import_case_package(v2_path.to_str().unwrap()).unwrap();
    let restored_v2 = get_case_detail(&imported_v2.id).unwrap();
    assert!(restored_v2.entity_attributes.is_empty());
    assert!(restored_v2.relation_attributes.is_empty());

    let mixed_path = data_root().unwrap().join("mixed-version.cluecase");
    write_package(&mixed_path, serde_json::to_vec(&v2).unwrap(), 3);
    let error = match import_case_package(mixed_path.to_str().unwrap()) {
        Ok(_) => panic!("混装版本应被拒绝"),
        Err(error) => error,
    };
    assert!(error.contains("版本不一致"));
}

