import { describe, expect, it } from "vitest";
import { buildImportPlan, currentClueBridge, withCurrentClueBridge } from "./smart-table";

const success = "【Success】成功";
const csv = (headers: string[], rows: string[][]) => [headers, ...rows].map((row) => row.join(",")).join("\n");
const groupHeaders = ["QQ账号(解密)","QQ群账号(解密)","错误备注","错误码类型","命中结果","QQ号","群号","查询人角色","群备注","群名称","群头像","最新群公告","群人数","最后群消息时间","群创建时间","群简介","标识id"];
const friendHeaders = ["查询账号(解密)","QQ账号(解密)","错误备注","错误码类型","查询账号","分组","昵称","头像","好友备注","QQ账号","标识id"];
const deviceHeaders = ["UIN","相似度","关系","头像","昵称","注册时间","注册地","账号状态","一年内被封次数","一年内被举报次数","一年内被举报成功次数","最后一次登录时间","QQ信用分","空间信用分","空间状态","频道资格"];
const phoneHeaders = ["QQ账号(解密)","命中查询内容","错误备注","错误码类型","QQ账号","手机号","手机号类型","设置时间","修改时间","验证时间"];

describe("strict-v1 四类真实合同小样本", () => {
  it("群列表只使用命中结果和解密群号，并校验QQ号一致", () => {
    const plan = buildImportPlan(csv(groupHeaders, [["","880000001","",success,"710000001","710000001","cipher-group","管理员","","测试群","","公告","20","2026-09-01","2020-01-01","","id-1"]]));
    expect(plan).toMatchObject({ template:"group-list", templateVersion:"strict-v1", canSubmit:true });
    expect(plan.relations[0]).toMatchObject({sourceKey:"710000001",targetKey:"880000001",label:"加入群"});
    expect(JSON.stringify(plan.relations)).not.toContain("cipher-group");
  });
  it("QQ号与群号列为密文且与命中结果不同时仍可提交（真实大禹/O3导出格式）", () => {
    const plan = buildImportPlan(csv(groupHeaders, [["2742987178","1121500883","",success,"2742987178","cipher-qq-column","cipher-group-column","【30】群主","","光头强78","https://p.qlogo.cn/gh/1/1/100","","82","2026/09/19 21:20:57","2026/09/04 21:05:34","","cipher-id"]]));
    expect(plan).toMatchObject({ template:"group-list", canSubmit:true, stats: { valid: 1, error: 0, relations: 1 } });
    expect(plan.relations[0]).toMatchObject({sourceKey:"2742987178",targetKey:"1121500883",label:"加入群"});
  });
  it("好友只使用查询账号和解密QQ，密文零端点", () => {
    const plan=buildImportPlan(csv(friendHeaders, [["","880000002","","","710000001","同事","好友","","备注","cipher-qq","id-2"]]));
    expect(plan.relations[0]).toMatchObject({sourceKey:"710000001",targetKey:"880000002",label:"好友"});
    expect(JSON.stringify(plan.relations)).not.toContain("cipher-qq");
  });
  it("同机无外部重合时使用当前选中QQ，原号码行也是结果", () => {
    const input=csv(deviceHeaders, [["710000001","1","原号码","","源","","","正常","0","0","0","","","","",""],["880000003","0.9","同设备IMEI","","目标","","广东","正常","0","0","0","","","","",""]]);
    const inferred=buildImportPlan(input); expect(inferred).toMatchObject({canSubmit:true,queryOrigin:{kind:"qq",key:"710000001"},parentSelectionReason:"file-origin"}); expect(inferred.relations).toHaveLength(1);
    const plan=buildImportPlan(input,{currentSource:{kind:"qq",value:"799999999"}});
    expect(plan).toMatchObject({template:"qq-device",canSubmit:true,queryOrigin:{kind:"qq",key:"799999999"},overlapCandidates:[],parentSelectionReason:"fallback-current-selection"});
    expect(plan.relations).toHaveLength(2); expect(plan.relations.map(r=>r.targetKey)).toEqual(["710000001","880000003"]);
  });
  it("同机唯一外部重合QQ接管整批父节点且自身行不建自环",()=>{
    const input=csv(deviceHeaders, [["2514249213","1","原号码","","客服小泽","","","正常","0","0","0","","","","",""],["880000003","0.9","同设备IMEI","","目标","","广东","正常","0","0","0","","","","",""]]);
    const plan=buildImportPlan(input,{currentSource:{kind:"qq",value:"123123"},existingEntityKeys:new Set([["qq","2514249213"].join("\u0000"),["qq","123123"].join("\u0000")])});
    expect(plan).toMatchObject({canSubmit:true,queryOrigin:{kind:"qq",key:"2514249213"},overlapCandidates:["2514249213"],parentSelectionReason:"unique-existing-overlap"});
    expect(plan.relations).toHaveLength(1);expect(plan.relations[0]).toMatchObject({sourceKey:"2514249213",targetKey:"880000003",label:"同机"});
    expect(plan.rows[0].decision).toBe("source_only");
    expect(plan.sourceEntity?.displayName).toBe("客服小泽");
    expect(plan.sourceEntity?.attributes.some(attribute=>attribute.fieldKey==="account_status"&&attribute.valueText==="正常")).toBe(true);
  });
  it("同机多个外部重合时必须显式选择候选父节点",()=>{
    const input=csv(deviceHeaders, [["2514249213","1","原号码","","甲","","","正常","0","0","0","","","","",""],["880000003","0.9","同设备IMEI","","乙","","","正常","0","0","0","","","","",""]]);
    const existing=new Set([["qq","2514249213"].join("\u0000"),["qq","880000003"].join("\u0000")]);
    const blocked=buildImportPlan(input,{currentSource:{kind:"qq",value:"123123"},existingEntityKeys:existing});
    expect(blocked.canSubmit).toBe(false);expect(blocked.overlapCandidates).toEqual(["2514249213","880000003"]);
    const selected=buildImportPlan(input,{currentSource:{kind:"qq",value:"123123"},existingEntityKeys:existing,explicitParentKey:"2514249213"});
    expect(selected).toMatchObject({canSubmit:true,queryOrigin:{key:"2514249213"},parentSelectionReason:"explicit-existing-overlap"});
  });
  it("手机号11行按QQ关系键合并为8关系并保留多值", () => {
    const rows=Array.from({length:11},(_,i)=>[String(880000001+(i%8)),"13800138000","",success,`cipher-${i}`,`phone-cipher-${i}`,`类型${i}`,`2026-09-${String(i+1).padStart(2,"0")}`,"",""]);
    const plan=buildImportPlan(csv(phoneHeaders,rows));
    expect(plan).toMatchObject({template:"qq-phone-binding",canSubmit:true,duplicateRelations:3});
    expect(plan.stats).toMatchObject({valid:11,duplicate:3,relations:8,entities:9});
    expect(plan.sourceEntities.map(entity=>[entity.kind,entity.key])).toEqual([["phone","13800138000"]]);
    expect(plan.targetEntities).toHaveLength(8);
    expect(plan.targetEntities.every(entity=>entity.kind==="qq")).toBe(true);
    expect(plan.relations[0]).toMatchObject({sourceKind:"phone",sourceKey:"13800138000",targetKind:"qq"});
    expect(plan.relations[0].attributes.length).toBeGreaterThan(2);
    expect(JSON.stringify(plan.relations)).not.toContain("phone-cipher");
  });
});

describe("strict-v1 失败关闭", () => {
  it("无表头仅在完整位置合同唯一命中时允许",()=>{
    const unknown=[["710000001","880000001"]];
    expect(buildImportPlan(unknown).batchErrors).toContain("无表头数据未通过四类严格位置合同");
    expect(buildImportPlan(unknown,{template:"friend-list",hasHeader:false}).canSubmit).toBe(false);
    const groupRow=["","880000001","",success,"710000001","710000001","cipher-group","【10】普通成员","","测试群","https://q.qlogo.cn/gzh/1","","20","2026-09-01","2020-01-01","","id-1"];
    expect(buildImportPlan([groupRow])).toMatchObject({template:"group-list",templateMode:"strict-positional",canSubmit:true,stats:{total:1,valid:1,error:0,relations:1}});
  });
  it("缺少任一必需表头拒绝",()=>expect(buildImportPlan(csv(groupHeaders.slice(1),[["x"]])).canSubmit).toBe(false));
  it("数据行多列或少列均整批拒绝",()=>{
    const valid=["","880000001","",success,"710000001","710000001","cipher","","","","","","","","","",""];
    expect(buildImportPlan(csv(groupHeaders,[[...valid,"extra"]])).batchErrors[0]).toContain("列数与表头不一致");
    expect(buildImportPlan(csv(groupHeaders,[valid.slice(0,-1)])).batchErrors[0]).toContain("列数与表头不一致");
  });
  it("任一错误行整批拒绝",()=>{
    const rows=[["","880000001","",success,"710000001","710000001","cipher","管理员","","","","","","","","",""],["","bad","",success,"710000001","710000001","cipher","管理员","","","","","","","","",""]];
    const plan=buildImportPlan(csv(groupHeaders,rows)); expect(plan.stats.error).toBe(1); expect(plan.canSubmit).toBe(false);
  });
});


describe("查询起点接入合同",()=>{
  const input=csv(groupHeaders, [["","880000001","",success,"710000001","710000001","cipher-group","管理员","","测试群","","公告","20","2026-09-01","2020-01-01","","id-1"]]);
  it("已有起点复用且不生成桥接",()=>{const plan=buildImportPlan(input,{currentSource:{kind:"subject",value:"案件根"},existingEntityKeys:new Set(["qq\0"+"710000001"])});expect(plan.accessStatus).toBe("reuse-existing");expect(currentClueBridge(plan,plan.currentSource)).toBeUndefined();});
  it("缺少起点时默认桥接方向为当前对象到查询起点",()=>{const plan=buildImportPlan(input,{currentSource:{kind:"subject",value:"案件根"}});const bridge=currentClueBridge(plan,plan.currentSource);expect(bridge?.relation).toMatchObject({sourceKind:"subject",sourceKey:"案件根",targetKind:"qq",targetKey:"710000001",label:"查询号码"});expect(withCurrentClueBridge(plan,bridge).relations).toHaveLength(2);});
  it("手机号查询起点方向为手机号→QQ（方向合同v2）",()=>{const plan=buildImportPlan(csv(phoneHeaders,[["880000001","13800138000","",success,"cipher","phone-cipher","本人","","",""]]),{currentSource:{kind:"subject",value:"案件根"}});expect(plan.queryOrigin).toEqual({kind:"phone",key:"13800138000",displayName:undefined});expect(plan.relations[0]).toMatchObject({sourceKind:"phone",sourceKey:"13800138000",targetKind:"qq",targetKey:"880000001"});});
});
