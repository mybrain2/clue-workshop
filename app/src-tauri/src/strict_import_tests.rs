use super::*;
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};

const SUCCESS: &str = "【Success】成功";
const GROUP: &[&str] = &["QQ账号(解密)","QQ群账号(解密)","错误备注","错误码类型","命中结果","QQ号","群号","查询人角色","群备注","群名称","群头像","最新群公告","群人数","最后群消息时间","群创建时间","群简介","标识id"];
const FRIEND: &[&str] = &["查询账号(解密)","QQ账号(解密)","错误备注","错误码类型","查询账号","分组","昵称","头像","好友备注","QQ账号","标识id"];
const DEVICE: &[&str] = &["UIN","相似度","关系","头像","昵称","注册时间","注册地","账号状态","一年内被封次数","一年内被举报次数","一年内被举报成功次数","最后一次登录时间","QQ信用分","空间信用分","空间状态","频道资格"];
const PHONE: &[&str] = &["QQ账号(解密)","命中查询内容","错误备注","错误码类型","QQ账号","手机号","手机号类型","设置时间","修改时间","验证时间"];
const MEMBER: &[&str] = &["QQ群账号(解密)","QQ账号(解密)","命中查询内容","异常说明","错误码类型","QQ群账号(加密)","群状态","QQ账号(加密)","群成员昵称","QQ账号昵称","成员角色","是否机器人","标识id"];
const LOOKUP: &[&str] = &["手机号(解密)","QQ账号(解密)","命中查询内容","错误备注","错误码类型","QQ账号","手机号","手机号类型","设置时间","修改时间","验证时间"];

struct TestDataRoot(PathBuf);
impl TestDataRoot {
    fn new() -> Self {
        let path = env::temp_dir().join(format!("clue-workbench-strict-test-{}", Uuid::new_v4()));
        TEST_DATA_ROOT.with(|root| { assert!(root.borrow().is_none()); *root.borrow_mut() = Some(path.clone()); });
        Self(path)
    }
}
impl Drop for TestDataRoot {
    fn drop(&mut self) {
        TEST_DATA_ROOT.with(|root| *root.borrow_mut() = None);
        if self.0.exists() { fs::remove_dir_all(&self.0).unwrap(); }
    }
}

fn row(values: &[&str]) -> Vec<String> { values.iter().map(|v| (*v).into()).collect() }
fn canonical_plan(template: &str, headers: &[&str], rows: Vec<Vec<String>>) -> ImportPlanInput {
    let raw_table = std::iter::once(row(headers)).chain(rows).collect::<Vec<_>>();
    let (required, source_kind, target_kind, label, source_column, target_column) = strict_import_contract(template).unwrap();
    assert_eq!(required, headers);
    let mut input = ImportPlanInput {
        case_id: String::new(), source_summary: "strict-test".into(), template: template.into(),
        template_version: "strict-v1".into(), template_mode: "strict-header".into(),
        header_fingerprint: raw_table[0].join("\u{1f}"), input_digest: strict_digest(&raw_table), raw_table, query_origin: None, current_source: None,
        overlap_candidates:vec![],parent_selection_reason:None,explicit_parent_key:None,
        mapping: None, endpoint_contract: json!({"sourceColumn":source_column,"sourceKind":source_kind,"targetColumn":target_column,"targetKind":target_kind,"relationLabel":label}),
        duplicate_relations: 0, raw_row_count: 0, valid_row_count: 0, relation_count: 0, entity_count: 0,
        row_decisions: vec![], batch_errors: vec![], bridge_relation_count: 0, entities: vec![], relations: vec![], error_count: 0,
    };
    if template=="qq-device" { input.current_source=Some(CurrentImportSourceInput{kind:"qq".into(),value:"730000001".into(),display_name:String::new()}); }
    let rebuilt = rebuild_strict_plan(&input, &HashSet::new()).unwrap();
    input.query_origin=rebuilt.query_origin.clone();
    input.overlap_candidates=rebuilt.overlap_candidates.clone();
    input.parent_selection_reason=rebuilt.parent_selection_reason.clone();
    input.duplicate_relations = rebuilt.duplicates;
    input.raw_row_count = rebuilt.decisions.len() as i64;
    input.valid_row_count = input.raw_row_count;
    input.relation_count = rebuilt.relations.len() as i64;
    input.entity_count = rebuilt.entities.len() as i64;
    input.row_decisions = rebuilt.decisions;
    input.entities = rebuilt.entities;
    input.relations = rebuilt.relations;
    input
}

fn four_plans() -> Vec<ImportPlanInput> {
    let group = canonical_plan("group-list", GROUP, vec![row(&["","880000001","",SUCCESS,"710000001","710000001","cipher-group","管理员","备注","测试群","","公告","20","2026-09-01","2020-01-01","简介","id-1"])]);
    let friend = canonical_plan("friend-list", FRIEND, vec![row(&["","880000002","","","720000001","同事","好友","","备注","cipher-qq","id-2"])]);
    let device = canonical_plan("qq-device", DEVICE, vec![row(&["730000001","1","原号码","","源","","","正常","0","0","0","","","","",""]),row(&["880000003","0.9","同设备IMEI","","目标","","广东","正常","0","0","0","","","","",""])]);
    let phone_rows = (0..11).map(|i| row(&[&format!("{}", 880000010 + i % 8),"13800138000","",SUCCESS,&format!("cipher-{i}"),&format!("phone-cipher-{i}"),&format!("类型{i}"),&format!("2026-09-{:02}",i+1),"",""])).collect();
    let phone = canonical_plan("qq-phone-binding", PHONE, phone_rows);
    vec![group, friend, device, phone]
}

fn assert_rejected(mut plan: ImportPlanInput, mutate: impl FnOnce(&mut ImportPlanInput)) {
    mutate(&mut plan);
    plan.case_id = "not-opened".into();
    assert!(import_plan(plan).is_err());
}

#[test]
fn friend_cipher_falls_back_to_decrypted_column() {
    // 查询账号列全密文 → 回退"查询账号(解密)"明文起点（头像列必须URL或空）
    let plan = canonical_plan("friend-list", FRIEND, vec![
        row(&["710000001","880000002","","","friend-cipher-1","同事","好友","","备注","cipher-qq","id-2"]),
        row(&["710000001","880000009","","","friend-cipher-1","同学","好友2","","","cipher-qq9","id-9"]),
    ]);
    assert_eq!(plan.query_origin.as_ref().unwrap().key, "710000001");
    assert_eq!(plan.relations.len(), 2);
}

#[test]
fn group_member_template_rebuilds() {
    let plan = canonical_plan("group-member", MEMBER, vec![
        row(&["548360752","703049615","548360752","","Success","cipher-g","【0】正常","cipher-q","","🫥","【0】普通成员","【false】否","id-1"]),
        row(&["548360752","123456789","548360752","","Success","cipher-g","【0】正常","cipher-q2","老王","北极星","【30】管理员","【true】是","id-2"]),
    ]);
    assert_eq!(plan.query_origin.as_ref().unwrap().kind, "group");
    assert_eq!(plan.query_origin.as_ref().unwrap().key, "548360752");
    assert_eq!(plan.relations.len(), 2);
    assert_eq!(plan.relations[0].label, "群成员");
    assert_eq!(plan.relations[0].source_kind, "group");
    assert_eq!(plan.relations[0].target_kind, "qq");
    // 属性：昵称入实体属性，角色入关系属性
    let nickname_count = plan.entities.iter().flat_map(|e| &e.attributes).filter(|a| a.field_key == "nickname").count();
    assert!(nickname_count >= 2);
    let role_count = plan.relations.iter().flat_map(|r| &r.attributes).filter(|a| a.field_key == "member_role").count();
    assert_eq!(role_count, 2);
}

#[test]
fn phone_lookup_normalizes_86_prefix() {
    let plan = canonical_plan("qq-phone-lookup", LOOKUP, vec![
        row(&["86-16650030502","2128667131","2128667131","","【Success】成功","cipher-qq","cipher-phone","【1】密保手机","2016/01/26 10:09:48","",""]),
    ]);
    assert_eq!(plan.query_origin.as_ref().unwrap().kind, "qq");
    assert_eq!(plan.query_origin.as_ref().unwrap().key, "2128667131");
    assert_eq!(plan.relations.len(), 1);
    assert_eq!(plan.relations[0].source_kind, "qq");
    assert_eq!(plan.relations[0].source_key, "2128667131");
    assert_eq!(plan.relations[0].target_kind, "phone");
    // 86- 前缀剥离
    assert_eq!(plan.relations[0].target_key, "16650030502");
}

#[test]
fn binding_accepts_86_prefix_phone() {
    // 方向合同 v2：绑定表统一为"查询起点 → 结果"，即 phone → qq
    let plan = canonical_plan("qq-phone-binding", PHONE, vec![
        row(&["880000010","+86-13800138000","",SUCCESS,"cipher-0","phone-cipher-0","【1】密保手机","2026-09-01","",""]),
    ]);
    assert_eq!(plan.relations[0].source_kind, "phone");
    assert_eq!(plan.relations[0].source_key, "13800138000");
    assert_eq!(plan.relations[0].target_kind, "qq");
    assert_eq!(plan.relations[0].target_key, "880000010");
}

#[test]
fn phone_format_matrix_normalizes() {
    // 全格式矩阵：位置合同与规范化全过（打印版诊断已验证8格式全true）
    for (raw, name) in [("86-16650030502","86-"),("+86-16650030502","+86-"),("+8616650030502","+86无分隔"),("8616650030502","86无分隔"),("166 5003 0502","空格分段"),("166-5003-0502","连字符"),("(86)16650030502","括号"),("16650030502","裸号")] {
        let plan = canonical_plan("qq-phone-lookup", LOOKUP, vec![
            row(&[raw,"2128667131","2128667131","","【Success】成功","c1","c2","【1】密保手机","","",""]),
        ]);
        assert_eq!(plan.relations[0].target_key, "16650030502", "格式 {} 规范化失败", name);
    }
    // 非法手机号：rebuild 必须拒绝（返回Err而非panic）
    let raw_table = vec![row(LOOKUP), row(&["12345","2128667131","2128667131","","【Success】成功","c1","c2","","","",""])];
    let bad_input = ImportPlanInput {
        case_id: String::new(), source_summary: "matrix-invalid".into(), template: "qq-phone-lookup".into(),
        template_version: "strict-v1".into(), template_mode: "strict-header".into(),
        header_fingerprint: raw_table[0].join("\u{1f}"), input_digest: strict_digest(&raw_table), raw_table,
        query_origin: None, current_source: None, overlap_candidates: vec![], parent_selection_reason: None, explicit_parent_key: None,
        mapping: None, endpoint_contract: json!({"sourceColumn":"QQ账号(解密)","sourceKind":"qq","targetColumn":"手机号(解密)","targetKind":"phone","relationLabel":"绑定手机号"}),
        duplicate_relations: 0, raw_row_count: 1, valid_row_count: 1, relation_count: 0, entity_count: 0,
        row_decisions: vec![], batch_errors: vec![], bridge_relation_count: 0, entities: vec![], relations: vec![], error_count: 0,
    };
    assert!(rebuild_strict_plan(&bad_input, &HashSet::new()).is_err(), "非法手机号必须被拒绝");
}

#[test]
fn manual_mapping_normalizes_86_phone() {
    // 手工映射路径：86- 手机号校验通过且入库规范化
    let raw_table=vec![row(&["QQ","手机"]),row(&["710000001","+86 166-5003-0502"])];
    let mapping=json!({"hasHeader":true,"sourceIndex":0,"sourceKind":"qq","targetIndex":1,"targetKind":"phone","displayNameIndex":null,"relationLabel":"绑定"});
    let mut input=ImportPlanInput{case_id:String::new(),source_summary:"manual-phone".into(),template:"custom".into(),template_version:"manual-mapped-v1".into(),template_mode:"manual-mapped".into(),header_fingerprint:raw_table[0].join("\u{1f}"),input_digest:strict_digest(&raw_table),raw_table,query_origin:None,current_source:None,overlap_candidates:vec![],parent_selection_reason:None,explicit_parent_key:None,mapping:Some(mapping),endpoint_contract:json!({"sourceColumn":"QQ","sourceKind":"qq","targetColumn":"手机","targetKind":"phone","relationLabel":"绑定"}),duplicate_relations:0,raw_row_count:0,valid_row_count:0,relation_count:0,entity_count:0,row_decisions:vec![],batch_errors:vec![],bridge_relation_count:0,entities:vec![],relations:vec![],error_count:0};
    let rebuilt=rebuild_manual_plan(&input).unwrap();
    assert_eq!(rebuilt.relations[0].target_key,"16650030502");
    assert_eq!(rebuilt.relations[0].target_kind,"phone");
    input.query_origin=rebuilt.query_origin.clone();
    input.raw_row_count=rebuilt.decisions.len() as i64;input.valid_row_count=input.raw_row_count;
    input.relation_count=rebuilt.relations.len() as i64;input.entity_count=rebuilt.entities.len() as i64;
    input.duplicate_relations=rebuilt.duplicates;input.row_decisions=rebuilt.decisions;
    input.entities=rebuilt.entities;input.relations=rebuilt.relations;drop(input);
}

fn manual_plan() -> ImportPlanInput {
    let raw_table=vec![row(&["来源QQ","目标QQ","昵称"]),row(&["710000001","880000001","对象一"]),row(&["710000001","880000002","对象二"])];
    let mapping=json!({"hasHeader":true,"sourceIndex":0,"sourceKind":"qq","targetIndex":1,"targetKind":"qq","displayNameIndex":2,"relationLabel":"关联账号"});
    let mut input=ImportPlanInput{case_id:String::new(),source_summary:"manual-test".into(),template:"custom".into(),template_version:"manual-mapped-v1".into(),template_mode:"manual-mapped".into(),header_fingerprint:raw_table[0].join("\u{1f}"),input_digest:strict_digest(&raw_table),raw_table,query_origin:None,current_source:None,overlap_candidates:vec![],parent_selection_reason:None,explicit_parent_key:None,mapping:Some(mapping),endpoint_contract:json!({"sourceColumn":"来源QQ","sourceKind":"qq","targetColumn":"目标QQ","targetKind":"qq","relationLabel":"关联账号"}),duplicate_relations:0,raw_row_count:0,valid_row_count:0,relation_count:0,entity_count:0,row_decisions:vec![],batch_errors:vec![],bridge_relation_count:0,entities:vec![],relations:vec![],error_count:0};
    let rebuilt=rebuild_manual_plan(&input).unwrap();input.query_origin=rebuilt.query_origin.clone();input.raw_row_count=rebuilt.decisions.len() as i64;input.valid_row_count=input.raw_row_count;input.relation_count=rebuilt.relations.len() as i64;input.entity_count=rebuilt.entities.len() as i64;input.duplicate_relations=rebuilt.duplicates;input.row_decisions=rebuilt.decisions;input.entities=rebuilt.entities;input.relations=rebuilt.relations;input
}

#[test]
fn manual_mapping_rebuilds_and_rejects_forgery() {
    let _root=TestDataRoot::new();let mut valid=manual_plan();let case=create_case(CreateCaseInput{title:"manual".into(),background:"".into(),seed_kind:"qq".into(),seed_value:"799999999".into()}).unwrap();valid.case_id=case.id;assert_eq!(import_plan(valid.clone()).unwrap().added_relations,2);
    let base=manual_plan();
    assert_rejected(base.clone(),|p|p.mapping.as_mut().unwrap()["sourceIndex"]=json!(9));
    assert_rejected(base.clone(),|p|p.mapping.as_mut().unwrap()["relationLabel"]=json!("伪造关系"));
    assert_rejected(base.clone(),|p|p.input_digest="fnv1a32:00000000".into());
    assert_rejected(base.clone(),|p|p.entities[1].display_name="伪造名称".into());
    assert_rejected(base.clone(),|p|p.relations[0].target_key="899999999".into());
    assert_rejected(base,|p|{p.raw_table[2][0]="720000001".into();p.input_digest=strict_digest(&p.raw_table);});
}

#[test]
fn manual_mapping_bridge_follows_access_contract() {
    let _root=TestDataRoot::new();
    let case=create_case(CreateCaseInput{title:"manual-bridge".into(),background:"".into(),seed_kind:"qq".into(),seed_value:"799999997".into()}).unwrap();
    // 场景1：起点不存在于案件，勾选接入 → 桥接 选中→查询号码→起点 落库
    let mut bridged=manual_plan();bridged.case_id=case.id.clone();
    bridged.current_source=Some(CurrentImportSourceInput{kind:"group".into(),value:"899999998".into(),display_name:"当前选中群".into()});
    bridged.bridge_relation_count=1;
    bridged.entities.push(PlannedEntityInput{kind:"group".into(),key:"899999998".into(),display_name:"当前选中群".into(),attributes:vec![]});
    bridged.relations.push(PlannedRelationInput{source_kind:"group".into(),source_key:"899999998".into(),target_kind:"qq".into(),target_key:"710000001".into(),label:"查询号码".into(),attributes:vec![]});
    bridged.query_origin=Some(QueryOriginInput{kind:"qq".into(),key:"710000001".into(),display_name:String::new()});
    let result=import_plan(bridged).unwrap();
    assert_eq!(result.added_relations,3,"应包含2条映射关系+1条桥接关系");
    // 场景2：桥接方向伪造（起点→选中）必须被拒
    let mut reversed=manual_plan();reversed.case_id=case.id.clone();
    reversed.current_source=Some(CurrentImportSourceInput{kind:"group".into(),value:"899999998".into(),display_name:"".into()});
    reversed.bridge_relation_count=1;
    reversed.entities.push(PlannedEntityInput{kind:"group".into(),key:"899999998".into(),display_name:"".into(),attributes:vec![]});
    reversed.relations.push(PlannedRelationInput{source_kind:"qq".into(),source_key:"710000001".into(),target_kind:"group".into(),target_key:"899999998".into(),label:"查询号码".into(),attributes:vec![]});
    reversed.query_origin=Some(QueryOriginInput{kind:"qq".into(),key:"710000001".into(),display_name:String::new()});
    assert!(import_plan(reversed).is_err(),"反向桥接必须拒绝");
    // 场景3：桥接标签伪造必须被拒
    let mut wrong_label=manual_plan();wrong_label.case_id=case.id.clone();
    wrong_label.current_source=Some(CurrentImportSourceInput{kind:"group".into(),value:"899999998".into(),display_name:"".into()});
    wrong_label.bridge_relation_count=1;
    wrong_label.entities.push(PlannedEntityInput{kind:"group".into(),key:"899999998".into(),display_name:"".into(),attributes:vec![]});
    wrong_label.relations.push(PlannedRelationInput{source_kind:"group".into(),source_key:"899999998".into(),target_kind:"qq".into(),target_key:"710000001".into(),label:"关联账号".into(),attributes:vec![]});
    wrong_label.query_origin=Some(QueryOriginInput{kind:"qq".into(),key:"710000001".into(),display_name:String::new()});
    assert!(import_plan(wrong_label).is_err(),"非查询号码标签的桥接必须拒绝");
    // 场景4：接入对象就是查询起点必须被拒
    let mut self_bridge=manual_plan();self_bridge.case_id=case.id.clone();
    self_bridge.current_source=Some(CurrentImportSourceInput{kind:"qq".into(),value:"710000001".into(),display_name:"".into()});
    self_bridge.bridge_relation_count=1;
    self_bridge.entities.push(PlannedEntityInput{kind:"qq".into(),key:"710000001".into(),display_name:"".into(),attributes:vec![]});
    self_bridge.relations.push(PlannedRelationInput{source_kind:"qq".into(),source_key:"710000001".into(),target_kind:"qq".into(),target_key:"710000001".into(),label:"查询号码".into(),attributes:vec![]});
    self_bridge.query_origin=Some(QueryOriginInput{kind:"qq".into(),key:"710000001".into(),display_name:String::new()});
    assert!(import_plan(self_bridge).is_err(),"接入对象不能就是查询起点");
}

#[test]
fn strict_phone_keys_accept_mobile_prefixes_and_reject_invalid_forms() {
    // v2 合同：大陆裸号与国际 + 形态均为合法规范键
    for phone in ["13800138000", "19900138000", "+85291234567", "+14155551234", "+79001234567"] {
        assert!(valid_strict_key("phone", phone), "应接受手机号 {phone}");
    }
    // 非规范形直接校验必须拒绝：非法段、长度不符、连字符未清洗（+86 形态是合法国际键，经 normalize 会剥为裸号）
    for phone in ["10100138000", "12100138000", "1380013800", "138001380000", "86-13800138000", "+852", "13800"] {
        assert!(!valid_strict_key("phone", phone), "应拒绝手机号 {phone}");
    }
}

#[test]
fn manual_mapping_rejects_duplicate_or_empty_headers_and_oversized_payload() {
    for headers in [row(&["来源QQ", "来源QQ", "昵称"]), row(&["来源QQ", " ", "昵称"])] {
        let mut plan = manual_plan();
        plan.raw_table[0] = headers;
        plan.header_fingerprint = plan.raw_table[0].join("\u{1f}");
        plan.input_digest = strict_digest(&plan.raw_table);
        assert!(rebuild_manual_plan(&plan).is_err());
    }

    let mut oversized = manual_plan();
    oversized.raw_table = std::iter::once(row(&["来源QQ", "目标QQ", "昵称"]))
        .chain((0..161).map(|index| vec!["710000001".into(), format!("{:09}", 880000000 + index), "x".repeat(65536)]))
        .collect();
    oversized.header_fingerprint = oversized.raw_table[0].join("\u{1f}");
    oversized.input_digest = strict_digest(&oversized.raw_table);
    assert!(rebuild_manual_plan(&oversized).is_err());
}

#[test]
fn strict_header_qq_device_rejects_out_of_range_similarity() {
    let base = four_plans().remove(2);
    for similarity in ["1.01", "-0.01", "100.01%"] {
        let mut plan = base.clone();
        plan.raw_table[2][1] = similarity.into();
        plan.input_digest = strict_digest(&plan.raw_table);
        assert!(rebuild_strict_plan(&plan, &HashSet::new()).is_err(), "应拒绝相似度 {similarity}");
    }
}

#[test]
fn strict_v1_four_contracts_rebuild_minimal_success() {
    let plans = four_plans();
    assert_eq!(plans.iter().map(|p| p.relation_count).collect::<Vec<_>>(), vec![1,1,1,8]);
    assert_eq!(plans[3].raw_row_count, 11);
    assert_eq!(plans[3].duplicate_relations, 3);
    assert_eq!(plans[2].row_decisions[0]["decision"], "source_only");
    assert_eq!(plans[2].relations.len(), 1);
    for plan in plans { assert!(!serde_json::to_string(&plan.relations).unwrap().contains("cipher")); }
}

#[test]
fn group_list_accepts_cipher_qq_column_that_differs_from_hit_result() {
    // 真实大禹/O3导出：QQ号、群号列可能是密文，与明文命中结果不同，此前会被误判为"QQ号不一致"整批拒绝
    let plan = canonical_plan("group-list", GROUP, vec![row(&["2742987178","1121500883","",SUCCESS,"2742987178","cipher-qq-column","cipher-group-column","【30】群主","","光头强78","https://p.qlogo.cn/gh/1/1/100","","82","2026/09/19 21:20:57","2026/09/04 21:05:34","","cipher-id"])]);
    assert_eq!(plan.relation_count, 1);
    assert_eq!(plan.relations[0].source_key, "2742987178");
    assert_eq!(plan.relations[0].target_key, "1121500883");
    assert!(!serde_json::to_string(&plan.relations).unwrap().contains("cipher"));
}

#[test]
fn qq_phone_binding_accepts_frontend_entity_order_and_rejects_attribute_tampering() {
    let rows = vec![
        row(&["467673818","13800138000","",SUCCESS,"cipher-1","phone-1","本人","2026-01-01","2026-02-01","2026-03-01"]),
        row(&["467673818","13800138000","",SUCCESS,"cipher-2","phone-2","亲属","2026-01-02","2026-02-02","2026-03-02"]),
        row(&["467673818","13800138000","",SUCCESS,"cipher-3","phone-3","历史","2026-01-03","2026-02-03","2026-03-03"]),
        row(&["467673819","13800138000","",SUCCESS,"cipher-4","phone-4","本人","2026-01-04","2026-02-04","2026-03-04"]),
        row(&["467673820","13800138000","",SUCCESS,"cipher-5","phone-5","本人","2026-01-05","2026-02-05","2026-03-05"]),
        row(&["467673821","13800138000","",SUCCESS,"cipher-6","phone-6","本人","2026-01-06","2026-02-06","2026-03-06"]),
    ];
    let mut frontend_plan = canonical_plan("qq-phone-binding", PHONE, rows);
    frontend_plan.entities.sort_by_key(|entity| (entity.kind == "phone", entity.key.clone()));
    assert_eq!(frontend_plan.entity_count, 5);
    assert_eq!(frontend_plan.relation_count, 4);
    assert_eq!(frontend_plan.duplicate_relations, 2);
    assert_eq!(frontend_plan.relations.iter().map(|relation| relation.attributes.len()).sum::<usize>(), 24);

    let _root = TestDataRoot::new();
    let case = create_case(CreateCaseInput { title: "真实手机号绑定".into(), background: "".into(), seed_kind: "qq".into(), seed_value: "799999997".into() }).unwrap();
    frontend_plan.case_id = case.id;
    let result = import_plan(frontend_plan.clone()).expect("前端按所有 QQ 后手机号排序的未篡改计划应通过");
    assert_eq!(result.added_relations, 4);
    assert_eq!(result.attribute_count, 24);

    assert_rejected(frontend_plan, |plan| {
        plan.relations[0].attributes[0].value_text = "篡改类型".into();
    });
}

#[test]
fn strict_positional_four_contracts_import_and_reject_tampering() {
    let _root = TestDataRoot::new();
    let mut plans = four_plans();
    for (index, plan) in plans.iter_mut().enumerate() {
        plan.template_mode = "strict-positional".into();
        let case = create_case(CreateCaseInput { title: format!("positional-{index}"), background: "".into(), seed_kind: "qq".into(), seed_value: format!("79000000{index}") }).unwrap();
        plan.case_id = case.id;
        if let Err(error) = import_plan(plan.clone()) { panic!("{} strict-positional 应通过: {error}", plan.template); }
    }

    let base = { let mut plan = four_plans().remove(0); plan.template_mode = "strict-positional".into(); plan };
    assert_rejected(base.clone(), |p| p.template_mode = "forged-positional".into());
    assert_rejected(base.clone(), |p| p.template = "friend-list".into());
    assert_rejected(base.clone(), |p| { p.raw_table[1][3] = "broken-anchor".into(); p.input_digest = strict_digest(&p.raw_table); });
    assert_rejected(base, |p| p.relation_count += 1);
}

#[test]
fn strict_v1_rejects_forged_contracts_and_summaries() {
    let base = four_plans().remove(0);
    assert_rejected(base.clone(), |p| p.template_version = "legacy-v0".into());
    assert_rejected(base.clone(), |p| p.input_digest = "fnv1a32:00000000".into());
    assert_rejected(base.clone(), |p| p.relations[0].target_key = "999999999".into());
    assert_rejected(base.clone(), |p| p.entities[1].display_name = "伪造名称".into());
    assert_rejected(base.clone(), |p| p.entities.push(PlannedEntityInput{kind:"qq".into(),key:"799999999".into(),display_name:"".into(),attributes:vec![]}));
    assert_rejected(base.clone(), |p| p.relations[0].target_key = "cipher-endpoint".into());
    assert_rejected(base.clone(), |p| { p.raw_table[1][3] = "Failure".into(); p.input_digest = strict_digest(&p.raw_table); p.error_count = 0; });
    for headers in [GROUP[1..].to_vec(), { let mut h=GROUP.to_vec(); h.push("额外"); h }, { let mut h=GROUP.to_vec(); h[1]=h[0]; h }] {
        assert_rejected(base.clone(), |p| { p.raw_table[0]=row(&headers); p.header_fingerprint=p.raw_table[0].join("\u{1f}"); p.input_digest=strict_digest(&p.raw_table); });
    }
    assert_rejected(base.clone(), |p| { p.raw_table.push({let mut r=p.raw_table[1].clone();r[4]="720000001".into();r[5]="720000001".into();r}); p.input_digest=strict_digest(&p.raw_table); });
    assert_rejected(base.clone(), |p| p.relation_count += 1);
    assert_rejected(base, |p| p.row_decisions[0]["decision"] = json!("duplicate_merged"));
}

#[test]
fn strict_v1_bridge_is_opt_in_single_and_directional() {
    let base = four_plans().remove(0);
    assert_rejected(base.clone(), |p| p.entities.push(PlannedEntityInput{kind:"group".into(),key:"899999999".into(),display_name:"".into(),attributes:vec![]}));
    let mut valid = base.clone();
    valid.bridge_relation_count=1;
    valid.current_source=Some(CurrentImportSourceInput{kind:"group".into(),value:"899999999".into(),display_name:"当前线索".into()});
    valid.entities.push(PlannedEntityInput{kind:"group".into(),key:"899999999".into(),display_name:"当前线索".into(),attributes:vec![]});
    valid.relations.push(PlannedRelationInput{source_kind:"group".into(),source_key:"899999999".into(),target_kind:"qq".into(),target_key:"710000001".into(),label:"查询号码".into(),attributes:vec![]});
    let _root=TestDataRoot::new();
    let case=create_case(CreateCaseInput{title:"bridge".into(),background:"".into(),seed_kind:"qq".into(),seed_value:"799999998".into()}).unwrap();
    valid.case_id=case.id;
    assert_eq!(import_plan(valid).unwrap().added_relations,2);
    assert_rejected(base.clone(), |p| { p.bridge_relation_count=2; });
    assert_rejected(base, |p| { p.bridge_relation_count=1;p.entities.push(PlannedEntityInput{kind:"group".into(),key:"899999999".into(),display_name:"".into(),attributes:vec![]});p.relations.push(PlannedRelationInput{source_kind:"group".into(),source_key:"899999999".into(),target_kind:"qq".into(),target_key:"710000001".into(),label:"加入群".into(),attributes:vec![]}); });
}

type EntityKey = (String, String);
type RelationKey = (String, String, String, String, String);
type AttributeKey = (String, String, String, String);
type AttributeValue = (String, Option<u64>, Option<String>);

#[derive(Clone, Debug, PartialEq, Eq)]
struct Snapshot {
    entities: BTreeSet<EntityKey>,
    relations: BTreeSet<RelationKey>,
    entity_attributes: BTreeMap<AttributeKey, AttributeValue>,
    relation_attributes: BTreeMap<AttributeKey, AttributeValue>,
}

fn attribute_value(attribute: &PlannedAttributeInput) -> AttributeValue {
    (attribute.value_text.clone(), attribute.value_number.map(f64::to_bits), attribute.value_time.clone())
}

fn snapshot(case_id: &str) -> Snapshot {
    let detail=get_case_detail(case_id).unwrap();
    let entity_ids=detail.entities.iter().map(|e|(e.id.clone(),(e.kind.clone(),e.label.clone()))).collect::<HashMap<_,_>>();
    let relation_ids=detail.relations.iter().map(|r|{
        let source=&entity_ids[&r.source_id]; let target=&entity_ids[&r.target_id];
        (r.id.clone(),(source.0.clone(),source.1.clone(),r.label.clone(),target.0.clone(),target.1.clone()))
    }).collect::<HashMap<_,_>>();
    let entities=entity_ids.values().cloned().collect();
    let relations=relation_ids.values().cloned().collect();
    let entity_attributes=detail.entity_attributes.iter().map(|a|{
        let subject=&entity_ids[&a.subject_id];
        ((subject.0.clone(),subject.1.clone(),a.field_key.clone(),a.value_type.clone()),(a.value_text.clone(),a.value_number.map(f64::to_bits),a.value_time.clone()))
    }).collect();
    let relation_attributes=detail.relation_attributes.iter().map(|a|{
        let subject=&relation_ids[&a.subject_id];
        ((format!("{}:{}",subject.0,subject.1),format!("{}:{}:{}",subject.2,subject.3,subject.4),a.field_key.clone(),a.value_type.clone()),(a.value_text.clone(),a.value_number.map(f64::to_bits),a.value_time.clone()))
    }).collect();
    Snapshot { entities, relations, entity_attributes, relation_attributes }
}

fn expected_snapshot(plan: &ImportPlanInput) -> Snapshot {
    let entities=plan.entities.iter().map(|e|(e.kind.clone(),e.key.clone())).collect();
    let relations=plan.relations.iter().map(|r|(r.source_kind.clone(),r.source_key.clone(),r.label.clone(),r.target_kind.clone(),r.target_key.clone())).collect();
    let entity_attributes=plan.entities.iter().flat_map(|e|e.attributes.iter().map(move |a|((e.kind.clone(),e.key.clone(),a.field_key.clone(),a.value_type.clone()),attribute_value(a)))).collect();
    let relation_attributes=plan.relations.iter().flat_map(|r|r.attributes.iter().map(move |a|((format!("{}:{}",r.source_kind,r.source_key),format!("{}:{}:{}",r.label,r.target_kind,r.target_key),a.field_key.clone(),a.value_type.clone()),attribute_value(a)))).collect();
    Snapshot { entities, relations, entity_attributes, relation_attributes }
}

fn snapshot_json(value: &Snapshot) -> serde_json::Value {
    json!({"entities":value.entities,"relations":value.relations,"entityAttributes":value.entity_attributes.iter().collect::<Vec<_>>(),"relationAttributes":value.relation_attributes.iter().collect::<Vec<_>>()})
}

fn set_diff<T: Ord + Clone>(left: &BTreeSet<T>, right: &BTreeSet<T>) -> Vec<T> { left.difference(right).cloned().collect() }
fn map_missing<K: Ord + Clone,V>(expected: &BTreeMap<K,V>,actual: &BTreeMap<K,V>) -> Vec<K> { expected.keys().filter(|k|!actual.contains_key(*k)).cloned().collect() }
fn map_extra<K: Ord + Clone,V>(expected: &BTreeMap<K,V>,actual: &BTreeMap<K,V>) -> Vec<K> { actual.keys().filter(|k|!expected.contains_key(*k)).cloned().collect() }
fn map_mismatch<K: Ord + Clone,V: PartialEq + Clone>(expected: &BTreeMap<K,V>,actual: &BTreeMap<K,V>) -> Vec<(K,V,V)> {
    expected.iter().filter_map(|(k,e)|actual.get(k).filter(|a|*a!=e).map(|a|(k.clone(),e.clone(),a.clone()))).collect()
}

#[test]
fn strict_v1_isolated_batches_have_exact_deltas_and_undo_to_seed_baseline() {
    let _root=TestDataRoot::new();
    let case=create_case(CreateCaseInput{title:"strict-isolated".into(),background:"".into(),seed_kind:"qq".into(),seed_value:"799999999".into()}).unwrap();
    let baseline=snapshot(&case.id);
    assert_eq!(baseline.entities.len(),2); assert_eq!(baseline.relations.len(),1);
    let names=["group","friend","device","phone"];
    let mut reports=vec![];
    for (name,mut plan) in names.into_iter().zip(four_plans()) {
        let expected=expected_snapshot(&plan);
        if name=="phone" { assert_eq!(plan.relations.iter().map(|r|r.attributes.len()).sum::<usize>(),22); assert_eq!(expected.relation_attributes.len(),16); }
        if name=="device" { assert!(expected.relation_attributes.keys().any(|k|k.2=="device_signal") && expected.relation_attributes.keys().any(|k|k.2=="similarity")); }
        plan.case_id=case.id.clone();
        let before=snapshot(&case.id);
        assert_eq!(before,baseline);
        let result=import_plan(plan).unwrap();
        assert_eq!(result.error_count,0);
        let after=snapshot(&case.id);
        let actual=Snapshot {
            entities: after.entities.difference(&before.entities).cloned().collect(),
            relations: after.relations.difference(&before.relations).cloned().collect(),
            entity_attributes: after.entity_attributes.iter().filter(|(k,_)|!before.entity_attributes.contains_key(*k)).map(|(k,v)|(k.clone(),v.clone())).collect(),
            relation_attributes: after.relation_attributes.iter().filter(|(k,_)|!before.relation_attributes.contains_key(*k)).map(|(k,v)|(k.clone(),v.clone())).collect(),
        };
        let missing=json!({"entities":set_diff(&expected.entities,&actual.entities),"relations":set_diff(&expected.relations,&actual.relations),"entityAttributes":map_missing(&expected.entity_attributes,&actual.entity_attributes),"relationAttributes":map_missing(&expected.relation_attributes,&actual.relation_attributes)});
        let extra=json!({"entities":set_diff(&actual.entities,&expected.entities),"relations":set_diff(&actual.relations,&expected.relations),"entityAttributes":map_extra(&expected.entity_attributes,&actual.entity_attributes),"relationAttributes":map_extra(&expected.relation_attributes,&actual.relation_attributes)});
        let mismatch=json!({"entityAttributes":map_mismatch(&expected.entity_attributes,&actual.entity_attributes),"relationAttributes":map_mismatch(&expected.relation_attributes,&actual.relation_attributes)});
        let incremental_pass=actual==expected;
        assert!(incremental_pass,"{name} golden delta mismatch: missing={missing}, extra={extra}, mismatch={mismatch}");
        let batch=result.batch.unwrap().id;
        undo_import_batch(&case.id,&batch).unwrap();
        let undone=snapshot(&case.id);
        let undo_pass=undone==baseline;
        assert!(undo_pass,"{name} undo did not restore exact baseline");
        reports.push(json!({"name":name,"incremental":{"expected":snapshot_json(&expected),"actual":snapshot_json(&actual),"missing":missing,"extra":extra,"mismatch":mismatch,"pass":incremental_pass},"undo":{"batchId":batch,"backToBaseline":undo_pass},"pass":incremental_pass&&undo_pass}));
    }
    if let Ok(report_path)=env::var("STRICT_DB_REPORT") {
        if let Some(parent)=Path::new(&report_path).parent() { fs::create_dir_all(parent).unwrap(); }
        let pass=reports.iter().all(|batch|batch["pass"]==json!(true));
        let report=json!({"schemaVersion":"strict-db-isolation-v2","seedBaseline":snapshot_json(&baseline),"batches":reports,"pass":pass});
        fs::write(report_path,format!("{}\n",serde_json::to_string_pretty(&report).unwrap())).unwrap();
    }
}

#[test]
fn strict_v1_rejects_short_and_long_data_rows() {
    let base = four_plans().remove(0);
    assert_rejected(base.clone(), |p| { p.raw_table[1].pop(); p.input_digest = strict_digest(&p.raw_table); });
    assert_rejected(base, |p| { p.raw_table[1].push("extra".into()); p.input_digest = strict_digest(&p.raw_table); });
}

#[test]
fn only_latest_active_import_batch_can_be_undone() {
    let _root = TestDataRoot::new();
    let case=create_case(CreateCaseInput{title:"latest-only".into(),background:"".into(),seed_kind:"qq".into(),seed_value:"799999999".into()}).unwrap();
    let mut first=four_plans().remove(0); first.case_id=case.id.clone();
    let first_id=import_plan(first).unwrap().batch.unwrap().id;
    let mut second=four_plans().remove(1); second.case_id=case.id.clone();
    let second_id=import_plan(second).unwrap().batch.unwrap().id;
    let error=undo_import_batch(&case.id,&first_id).unwrap_err();
    assert!(error.contains("最新活动"));
    assert_eq!(list_import_batches(&case.id).unwrap().len(),2);
    undo_import_batch(&case.id,&second_id).unwrap();
    undo_import_batch(&case.id,&first_id).unwrap();
    assert!(list_import_batches(&case.id).unwrap().is_empty());
}


#[test]
fn qq_device_uses_unique_file_origin_without_current_selection() {
    let rows=vec![
        row(&["2514249213","1","原号码","","源","","","正常","0","0","0","","","","",""]),
        row(&["880000003","0.9","同设备IMEI","","目标","","广东","正常","0","0","0","","","","",""]),
    ];
    let mut input=canonical_plan("qq-device",DEVICE,rows);
    input.current_source=None;
    let rebuilt=rebuild_strict_plan(&input,&HashSet::new()).unwrap();
    assert_eq!(rebuilt.query_origin.unwrap().key,"2514249213");
    assert_eq!(rebuilt.parent_selection_reason.as_deref(),Some("file-origin"));
    assert_eq!(rebuilt.relations.len(),1);
    assert_eq!(rebuilt.relations[0].source_key,"2514249213");
    assert_eq!(rebuilt.relations[0].target_key,"880000003");
}

#[test]
fn qq_device_uses_unique_existing_overlap_as_batch_parent_and_rejects_forgery() {
    let _root=TestDataRoot::new();
    let case=create_case(CreateCaseInput{title:"device-overlap".into(),background:"".into(),seed_kind:"qq".into(),seed_value:"123123".into()}).unwrap();
    let detail=get_case_detail(&case.id).unwrap();
    let seed=detail.entities.iter().find(|entity|entity.kind=="qq"&&entity.label=="123123").unwrap();
    add_relations(AddRelationsInput{case_id:case.id.clone(),source_id:seed.id.clone(),target_kind:"qq".into(),values:vec!["2514249213".into()],display_names:vec!["客服小泽".into()],label:"关联QQ号".into(),spread:"人工关联".into(),note:String::new(),custom_type:String::new(),source:"test".into(),attributes:vec![],entity_attributes:vec![],relation_attributes:vec![]}).unwrap();
    let rows=vec![
        row(&["2514249213","1","原号码","","客服小泽","","","正常","0","0","0","","","","",""]),
        row(&["880000003","0.9","同设备IMEI","","目标","","广东","正常","0","0","0","","","","",""]),
    ];
    let raw_table=std::iter::once(row(DEVICE)).chain(rows).collect::<Vec<_>>();
    let (_,source_kind,target_kind,label,source_column,target_column)=strict_import_contract("qq-device").unwrap();
    let mut input=ImportPlanInput{case_id:case.id.clone(),source_summary:"overlap-test".into(),template:"qq-device".into(),template_version:"strict-v1".into(),template_mode:"strict-header".into(),header_fingerprint:raw_table[0].join("\u{1f}"),input_digest:strict_digest(&raw_table),raw_table,query_origin:None,current_source:Some(CurrentImportSourceInput{kind:"qq".into(),value:"123123".into(),display_name:String::new()}),overlap_candidates:vec!["2514249213".into()],parent_selection_reason:Some("unique-existing-overlap".into()),explicit_parent_key:None,mapping:None,endpoint_contract:json!({"sourceColumn":source_column,"sourceKind":source_kind,"targetColumn":target_column,"targetKind":target_kind,"relationLabel":label}),duplicate_relations:0,raw_row_count:0,valid_row_count:0,relation_count:0,entity_count:0,row_decisions:vec![],batch_errors:vec![],bridge_relation_count:0,entities:vec![],relations:vec![],error_count:0};
    let existing=HashSet::from(["123123".into(),"2514249213".into()]);
    let rebuilt=rebuild_strict_plan(&input,&existing).unwrap();
    input.query_origin=rebuilt.query_origin.clone();input.overlap_candidates=rebuilt.overlap_candidates.clone();input.parent_selection_reason=rebuilt.parent_selection_reason.clone();input.duplicate_relations=rebuilt.duplicates;input.raw_row_count=rebuilt.decisions.len() as i64;input.valid_row_count=input.raw_row_count;input.relation_count=rebuilt.relations.len() as i64;input.entity_count=rebuilt.entities.len() as i64;input.row_decisions=rebuilt.decisions;input.entities=rebuilt.entities;input.relations=rebuilt.relations;
    assert_eq!(input.query_origin.as_ref().unwrap().key,"2514249213");
    assert_eq!(input.relations.len(),1);
    assert_eq!(input.relations[0].source_key,"2514249213");
    assert_eq!(input.relations[0].target_key,"880000003");
    let result=import_plan(input.clone()).unwrap();
    assert_eq!(result.added_relations,1);
    let after=snapshot(&case.id);
    assert!(after.relations.contains(&("qq".into(),"2514249213".into(),"同机".into(),"qq".into(),"880000003".into())));
    assert!(!after.relations.contains(&("qq".into(),"123123".into(),"同机".into(),"qq".into(),"2514249213".into())));
    let mut forged=input;forged.query_origin.as_mut().unwrap().key="123123".into();forged.parent_selection_reason=Some("fallback-current-selection".into());
    assert!(import_plan(forged).is_err());
}


#[test]
fn qq_device_multiple_overlaps_require_explicit_valid_parent() {
    let rows=vec![
        row(&["2514249213","1","原号码","","甲","","","正常","0","0","0","","","","",""]),
        row(&["880000003","0.9","同设备IMEI","","乙","","广东","正常","0","0","0","","","","",""]),
    ];
    let mut input=canonical_plan("qq-device",DEVICE,rows);
    input.current_source=Some(CurrentImportSourceInput{kind:"qq".into(),value:"123123".into(),display_name:String::new()});
    let existing=HashSet::from(["123123".into(),"2514249213".into(),"880000003".into()]);
    input.explicit_parent_key=None;
    assert!(rebuild_strict_plan(&input,&existing).err().expect("应拒绝未选择父节点").contains("多个案件已有QQ"));
    input.explicit_parent_key=Some("2514249213".into());
    let rebuilt=rebuild_strict_plan(&input,&existing).unwrap();
    assert_eq!(rebuilt.query_origin.unwrap().key,"2514249213");
    assert_eq!(rebuilt.parent_selection_reason.as_deref(),Some("explicit-existing-overlap"));
    input.explicit_parent_key=Some("999999999".into());
    assert!(rebuild_strict_plan(&input,&existing).err().expect("应拒绝伪造父节点").contains("不属于案件重合候选"));
}



// ===== 批量导入边界探针（测试员视角，2026-09-22）=====

#[test]
fn probe_import_undo_restores_seed_baseline_and_batch_list() {
    let _root=TestDataRoot::new();
    let case=create_case(CreateCaseInput{title:"probe-undo".into(),background:"".into(),seed_kind:"qq".into(),seed_value:"799999999".into()}).unwrap();
    let before=snapshot(&case.id);
    assert!(list_import_batches(&case.id).unwrap().is_empty());
    let mut plan=manual_plan();plan.case_id=case.id.clone();
    let result=import_plan(plan).unwrap();
    assert_eq!(result.added_relations,2);
    let batches=list_import_batches(&case.id).unwrap();
    assert_eq!(batches.len(),1);
    let mid=snapshot(&case.id);
    assert!(mid.entities.len()>before.entities.len());
    let removed=undo_import_batch(&case.id,&batches[0].id).unwrap();
    assert!(removed>=2);
    let after=snapshot(&case.id);
    assert_eq!(after.entities,before.entities,"撤销后实体应回到种子基线");
    assert_eq!(after.relations,before.relations,"撤销后关系应回到种子基线");
    assert!(list_import_batches(&case.id).unwrap().is_empty(),"撤销后批次列表应清空");
}

#[test]
fn probe_import_repeated_batch_reuses_not_duplicates() {
    let _root=TestDataRoot::new();
    let case=create_case(CreateCaseInput{title:"probe-reuse".into(),background:"".into(),seed_kind:"qq".into(),seed_value:"799999999".into()}).unwrap();
    let mut plan=manual_plan();plan.case_id=case.id.clone();
    let first=import_plan(plan.clone()).unwrap();
    assert_eq!(first.added_entities,3);
    let second=import_plan(plan).unwrap();
    assert_eq!(second.added_entities,0,"第二次导入同批应零新增实体");
    assert_eq!(second.reused_entities,3);
    assert_eq!(second.reused_relations,2);
    assert_eq!(list_import_batches(&case.id).unwrap().len(),2,"两次导入各留一个批次");
    // 撤销第二批不应影响第一批已落库数据
    let batches=list_import_batches(&case.id).unwrap();
    // 批次列表按最新在前；batches[1]是旧批次 → 撤销旧批次必须被拒
    undo_import_batch(&case.id,&batches[1].id).err().expect("撤销旧批次应被拒绝");
    // 撤销最新重复批 → 原第一批数据保留（重复批本来就零新增）
    undo_import_batch(&case.id,&batches[0].id).unwrap();
    let after=snapshot(&case.id);
    assert!(after.relations.contains(&("qq".into(),"710000001".into(),"关联账号".into(),"qq".into(),"880000001".into())),"撤销最新重复批后原数据应保留");
}

#[test]
fn probe_import_bridge_count_two_rejected() {
    let _root=TestDataRoot::new();
    let case=create_case(CreateCaseInput{title:"probe-bridge2".into(),background:"".into(),seed_kind:"qq".into(),seed_value:"799999997".into()}).unwrap();
    let mut plan=manual_plan();plan.case_id=case.id.clone();
    plan.current_source=Some(CurrentImportSourceInput{kind:"group".into(),value:"899999998".into(),display_name:String::new()});
    plan.bridge_relation_count=2;
    plan.entities.push(PlannedEntityInput{kind:"group".into(),key:"899999998".into(),display_name:String::new(),attributes:vec![]});
    plan.entities.push(PlannedEntityInput{kind:"group".into(),key:"899999997".into(),display_name:String::new(),attributes:vec![]});
    plan.relations.push(PlannedRelationInput{source_kind:"group".into(),source_key:"899999998".into(),target_kind:"qq".into(),target_key:"710000001".into(),label:"查询号码".into(),attributes:vec![]});
    plan.relations.push(PlannedRelationInput{source_kind:"group".into(),source_key:"899999997".into(),target_kind:"qq".into(),target_key:"710000001".into(),label:"查询号码".into(),attributes:vec![]});
    let err=import_plan(plan).err().expect("bridge=2 必须拒绝");
    assert!(err.contains("接入关系数量无效")||err.contains("额外")||err.contains("无效"), "实际错误: {err}");
}

#[test]
fn probe_import_bridge_with_attributes_rejected() {
    let _root=TestDataRoot::new();
    let case=create_case(CreateCaseInput{title:"probe-bridge-attr".into(),background:"".into(),seed_kind:"qq".into(),seed_value:"799999996".into()}).unwrap();
    let mut plan=manual_plan();plan.case_id=case.id.clone();
    plan.current_source=Some(CurrentImportSourceInput{kind:"group".into(),value:"899999998".into(),display_name:String::new()});
    plan.bridge_relation_count=1;
    plan.entities.push(PlannedEntityInput{kind:"group".into(),key:"899999998".into(),display_name:String::new(),attributes:vec![]});
    plan.relations.push(PlannedRelationInput{source_kind:"group".into(),source_key:"899999998".into(),target_kind:"qq".into(),target_key:"710000001".into(),label:"查询号码".into(),attributes:vec![PlannedAttributeInput{field_key:"fake".into(),value_type:"text".into(),value_text:"x".into(),value_number:None,value_time:None}]});
    assert!(import_plan(plan).is_err(),"桥接关系不允许携带属性");
}

#[test]
fn probe_import_manual_row_limit_boundary() {
    // raw_table 上限 10001（1表头+10000数据）；10002 应拒绝
    let mut raw=vec![row(&["来源QQ","目标QQ"])];
    for i in 0..10001 { raw.push(vec!["710000001".into(),format!("88{:07}",i)]); }
    let mut plan=manual_plan();
    plan.raw_table=raw;
    plan.header_fingerprint=plan.raw_table[0].join("\u{1f}");
    plan.input_digest=strict_digest(&plan.raw_table);
    let err=rebuild_manual_plan(&plan).err().expect("10002行必须拒绝");
    assert!(err.contains("原始表格"),"10002行应触发表格大小拒绝，实际错误: {err}");
    // 恰好 10001（10000数据行）允许重建（注意去掉越界的 displayNameIndex）
    let mut raw2=vec![row(&["来源QQ","目标QQ"])];
    for i in 0..10000 { raw2.push(vec!["710000001".into(),format!("88{:07}",i)]); }
    let mapping2=json!({"hasHeader":true,"sourceIndex":0,"sourceKind":"qq","targetIndex":1,"targetKind":"qq","relationLabel":"关联账号"});
    let plan2=ImportPlanInput{case_id:String::new(),source_summary:"probe".into(),template:"custom".into(),template_version:"manual-mapped-v1".into(),template_mode:"manual-mapped".into(),header_fingerprint:raw2[0].join("\u{1f}"),input_digest:strict_digest(&raw2),raw_table:raw2,query_origin:None,current_source:None,overlap_candidates:vec![],parent_selection_reason:None,explicit_parent_key:None,mapping:Some(mapping2),endpoint_contract:json!({}),duplicate_relations:0,raw_row_count:0,valid_row_count:0,relation_count:0,entity_count:0,row_decisions:vec![],batch_errors:vec![],bridge_relation_count:0,entities:vec![],relations:vec![],error_count:0};
    let rebuilt=rebuild_manual_plan(&plan2).expect("10000数据行应通过重建");
    assert_eq!(rebuilt.relations.len(),10000);
    assert_eq!(rebuilt.entities.len(),10001);
}

#[test]
fn probe_import_manual_phone_canonicalization_backend() {
    // 后端手工映射：来源手机号国际裸号 85212345678 → +85212345678；86-16650030502 → 16650030502
    let raw=vec![row(&["手机号","QQ"]),row(&["86-16650030502","710000001"]),row(&["+852 9123 4567","710000002"])];
    let mapping=json!({"hasHeader":true,"sourceIndex":0,"sourceKind":"phone","targetIndex":1,"targetKind":"qq","relationLabel":"绑定"});
    let input=ImportPlanInput{case_id:String::new(),source_summary:"probe".into(),template:"custom".into(),template_version:"manual-mapped-v1".into(),template_mode:"manual-mapped".into(),header_fingerprint:raw[0].join("\u{1f}"),input_digest:strict_digest(&raw),raw_table:raw,query_origin:None,current_source:None,overlap_candidates:vec![],parent_selection_reason:None,explicit_parent_key:None,mapping:Some(mapping),endpoint_contract:json!({}),duplicate_relations:0,raw_row_count:0,valid_row_count:0,relation_count:0,entity_count:0,row_decisions:vec![],batch_errors:vec![],bridge_relation_count:0,entities:vec![],relations:vec![],error_count:0};
    let err=rebuild_manual_plan(&input).err();
    // 注意：来源列两个不同手机号 → sources.len()!=1 应拒绝（来源必须唯一）
    assert!(err.is_some(),"来源列必须全批唯一");
    // 拆成两批各自唯一
    let raw1=vec![row(&["手机号","QQ"]),row(&["86-16650030502","710000001"])];
    let mut i1=input.clone();i1.raw_table=raw1.clone();i1.header_fingerprint=raw1[0].join("\u{1f}");i1.input_digest=strict_digest(&raw1);
    let r1=rebuild_manual_plan(&i1).expect("86-前缀单行应通过");
    assert_eq!(r1.entities.iter().find(|e|e.kind=="phone").unwrap().key,"16650030502");
    let raw2=vec![row(&["手机号","QQ"]),row(&["+852 9123 4567","710000002"])];
    let mut i2=input.clone();i2.raw_table=raw2.clone();i2.header_fingerprint=raw2[0].join("\u{1f}");i2.input_digest=strict_digest(&raw2);
    let r2=rebuild_manual_plan(&i2).expect("+852形态单行应通过");
    assert_eq!(r2.entities.iter().find(|e|e.kind=="phone").unwrap().key,"+85291234567");
}

#[test]
fn probe_import_strict_template_forged_header_fingerprint_rejected() {
    // 伪造表头指纹（乱序必需列）→ 后端拒绝
    let mut plan=canonical_plan("group-list",GROUP,vec![row(&["","880000001","",SUCCESS,"710000001","710000001","cipher-group","管理员","备注","测试群","","公告","20","2026-09-01","2020-01-01","简介","id-1"])]);
    plan.case_id="probe".into();
    plan.header_fingerprint=plan.raw_table[0].iter().rev().cloned().collect::<Vec<_>>().join("\u{1f}");
    assert!(import_plan(plan).is_err(),"伪造表头指纹必须拒绝");
}

#[test]
fn probe_import_strict_row_decision_forged_count_rejected() {
    // 行决策数量与原始表格不一致 → 拒绝
    let mut plan=canonical_plan("friend-list",FRIEND,vec![row(&["","880000002","","","720000001","同事","好友","","备注","cipher-qq","id-2"])]);
    plan.case_id="probe".into();
    plan.row_decisions.clear();
    assert!(import_plan(plan).is_err(),"行决策数量不一致必须拒绝");
}

#[test]
fn probe_import_cross_template_endpoint_kind_forgery_rejected() {
    // 端点种类伪造：群表关系端点改成 group→group → 拒绝
    let mut plan=canonical_plan("group-list",GROUP,vec![row(&["","880000001","",SUCCESS,"710000001","710000001","cipher-group","管理员","备注","测试群","","公告","20","2026-09-01","2020-01-01","简介","id-1"])]);
    plan.case_id="probe".into();
    plan.relations[0].target_kind="group".into();
    assert!(import_plan(plan).is_err(),"伪造端点种类必须拒绝");
}
