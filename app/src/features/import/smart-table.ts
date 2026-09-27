import type { AttributeValueType, EntityKind } from "../../lib/types";

export type TemplateType = "group-list" | "friend-list" | "qq-device" | "qq-phone-binding" | "group-member" | "qq-phone-lookup" | "custom";
export type RecognitionConfidence = "high" | "low";
export type TabularInput = string | ReadonlyArray<ReadonlyArray<unknown>>;
export interface ParseDiagnostic { code: "unclosed-quote" | "row-width"; message: string; severity: "error"; physicalLine: number; }
export interface ParseResult { rows: string[][]; recordStartLines: number[]; physicalLineCount: number; logicalRecordCount: number; dataRecordCount: number; emptyRowsRemoved: number; duplicateHeadersRemoved: number; delimiter: "\t" | "," | null; diagnostics: ParseDiagnostic[]; }
export interface NormalizedTable extends ParseResult { hasHeader: boolean; headers: string[]; dataRows: string[][]; }
export interface TemplateRecognition { template: TemplateType; mode: "strict-header" | "strict-positional"; confidence: RecognitionConfidence; score: number; reasons: string[]; alternatives: Array<{ template: Exclude<TemplateType, "custom">; score: number }>; table: NormalizedTable; }
export interface PlannedAttribute { fieldKey: string; valueType: AttributeValueType; valueText: string; valueNumber?: number; valueTime?: string; }
export interface PlannedEntity { kind: EntityKind; key: string; displayName: string; attributes: PlannedAttribute[]; }
export interface PlannedRelation { sourceKind: EntityKind; sourceKey: string; targetKind: EntityKind; targetKey: string; label: string; attributes: PlannedAttribute[]; }
export interface ImportPlanRow { rowNumber: number; valid: boolean; error?: string; reason: string; sourceEntity?: PlannedEntity; targetEntities: PlannedEntity[]; relations: PlannedRelation[]; entityAttributes: PlannedAttribute[]; relationAttributes: PlannedAttribute[]; rawRecord: Record<string, string>; relationKey?: string; decision: "accepted" | "duplicate_merged" | "source_only" | "error"; }
export interface ImportPlanStats { total: number; physicalLineCount: number; logicalRecordCount: number; dataRecordCount: number; emptyRowsRemoved: number; duplicateHeadersRemoved: number; valid: number; error: number; duplicate: number; entities: number; relations: number; entityAttributes: number; relationAttributes: number; }
export interface EndpointContract { sourceColumn: string; sourceKind: EntityKind; targetColumn: string; targetKind: EntityKind; relationLabel: string; direction: string; }
export interface ManualMapping { hasHeader: boolean; sourceIndex: number; sourceKind: ManualEntityKind; targetIndex: number; targetKind: ManualEntityKind; displayNameIndex?: number; relationLabel: string; }
export type ManualEntityKind = "qq" | "group" | "phone" | "ip" | "custom";
export interface ManualMappingSuggestion { hasHeader: boolean; sourceIndex?: number; sourceKind?: ManualEntityKind; targetIndex?: number; targetKind?: ManualEntityKind; }
export interface QueryOrigin { kind: EntityKind; key: string; displayName?: string; }
export type ParentSelectionReason = "fallback-current-selection" | "file-origin" | "unique-existing-overlap" | "explicit-existing-overlap";
export interface ImportPlan { template: TemplateType; templateVersion: "strict-v1" | "manual-mapped-v1"; templateMode: "strict-header" | "strict-positional" | "manual-mapped"; rawTable: string[][]; confidence: RecognitionConfidence; reasons: string[]; inferredColumns: string[]; headerFingerprint: string; inputDigest: string; endpointContract?: EndpointContract; duplicateRelations: number; rowDecisions: ImportPlanRow[]; batchErrors: string[]; canSubmit: boolean; rows: ImportPlanRow[]; sourceEntity?: PlannedEntity; sourceEntities: PlannedEntity[]; targetEntities: PlannedEntity[]; relations: PlannedRelation[]; entityAttributes: PlannedAttribute[]; relationAttributes: PlannedAttribute[]; ignoredColumns: string[]; delimiter: "\t" | "," | null; diagnostics: ParseDiagnostic[]; stats: ImportPlanStats; queryOrigin?: QueryOrigin; currentSource?: CurrentImportSource; accessStatus?: "query-origin" | "reuse-existing" | "bridge-available" | "unavailable"; overlapCandidates?: string[]; parentSelectionReason?: ParentSelectionReason; explicitParentKey?: string; bridgeRelationCount?: number; mapping?: ManualMapping; }
export interface CurrentImportSource { kind: EntityKind; value: string; displayName?: string; }
export interface BuildImportPlanOptions { template?: TemplateType; currentSource?: string | CurrentImportSource; existingEntityKeys?: ReadonlySet<string>; explicitParentKey?: string; hasHeader?: boolean; }
export interface CurrentClueBridge { entity: PlannedEntity; relation: PlannedRelation; }

type StrictTemplate = Exclude<TemplateType, "custom">;
type Spec = { required: string[]; aliases: Record<string, string[]>; source: string; sourceKind: EntityKind; target: string; targetKind: EntityKind; label: string; success: "explicit" | "blank-or-explicit" | "explicit-or-plain" | "all"; relationProps: Array<[string,string,AttributeValueType?]>; targetProps: Array<[string,string,AttributeValueType?]>; fallbackSource?: string; };
const SUCCESS = "【Success】成功";
const SPECS: Record<StrictTemplate, Spec> = {
  "group-list": { required: ["QQ账号(解密)","QQ群账号(解密)","错误备注","错误码类型","命中结果","QQ号","群号","查询人角色","群备注","群名称","群头像","最新群公告","群人数","最后群消息时间","群创建时间","群简介","标识id"], aliases: {}, source:"命中结果",sourceKind:"qq",target:"QQ群账号(解密)",targetKind:"group",label:"加入群",success:"explicit",relationProps:[["查询人角色","query_role","enum"],["群备注","group_remark"]],targetProps:[["群名称","group_name"],["群头像","avatar"],["最新群公告","announcement"],["群人数","member_count","number"],["最后群消息时间","last_message_at","datetime"],["群创建时间","created_at","datetime"],["群简介","description"],["标识id","identifier"]]},
  "friend-list": { required: ["查询账号(解密)","QQ账号(解密)","错误备注","错误码类型","查询账号","分组","昵称","头像","好友备注","QQ账号","标识id"], aliases: {}, source:"查询账号",sourceKind:"qq",target:"QQ账号(解密)",targetKind:"qq",label:"好友",success:"blank-or-explicit",fallbackSource:"查询账号(解密)",relationProps:[["分组","friend_group"],["好友备注","friend_remark"]],targetProps:[["昵称","nickname"],["头像","avatar"],["标识id","identifier"]]},
  "qq-device": { required: ["UIN","相似度","关系","头像","昵称","注册时间","注册地","账号状态","一年内被封次数","一年内被举报次数","一年内被举报成功次数","最后一次登录时间","QQ信用分","空间信用分","空间状态","频道资格"], aliases: {}, source:"当前选中QQ",sourceKind:"qq",target:"UIN",targetKind:"qq",label:"同机",success:"all",relationProps:[["关系","device_signal","list"],["相似度","similarity","number"]],targetProps:[["头像","avatar"],["昵称","nickname"],["注册时间","registered_at","datetime"],["注册地","registration"],["账号状态","account_status","enum"],["一年内被封次数","ban_count","number"],["一年内被举报次数","report_count","number"],["一年内被举报成功次数","report_success_count","number"],["最后一次登录时间","last_login_at","datetime"],["QQ信用分","qq_credit","number"],["空间信用分","space_credit","enum"],["空间状态","space_status","enum"],["频道资格","channel_status","enum"]]},
  "qq-phone-binding": { required: ["QQ账号(解密)","命中查询内容","错误备注","错误码类型","QQ账号","手机号","手机号类型","设置时间","修改时间","验证时间"], aliases: {}, source:"命中查询内容",sourceKind:"phone",target:"QQ账号(解密)",targetKind:"qq",label:"绑定手机号",success:"explicit",relationProps:[["手机号类型","phone_type","enum"],["设置时间","set_at","datetime"],["修改时间","modified_at","datetime"],["验证时间","verified_at","datetime"]],targetProps:[]},
  "group-member": { required: ["QQ群账号(解密)","QQ账号(解密)","命中查询内容","异常说明","错误码类型","QQ群账号(加密)","群状态","QQ账号(加密)","群成员昵称","QQ账号昵称","成员角色","是否机器人","标识id"], aliases: {}, source:"QQ群账号(解密)",sourceKind:"group",target:"QQ账号(解密)",targetKind:"qq",label:"群成员",success:"explicit-or-plain",relationProps:[["成员角色","member_role","enum"],["群成员昵称","member_nickname"]],targetProps:[["QQ账号昵称","nickname"],["标识id","identifier"]]},
  "qq-phone-lookup": { required: ["手机号(解密)","QQ账号(解密)","命中查询内容","错误备注","错误码类型","QQ账号","手机号","手机号类型","设置时间","修改时间","验证时间"], aliases: {}, source:"QQ账号(解密)",sourceKind:"qq",target:"手机号(解密)",targetKind:"phone",label:"绑定手机号",success:"explicit",relationProps:[["手机号类型","phone_type","enum"],["设置时间","set_at","datetime"],["修改时间","modified_at","datetime"],["验证时间","verified_at","datetime"]],targetProps:[]},
};

const cleanCell=(value:unknown)=>String(value??"").replace(/^\ufeff/,"").trim();
const canonicalHeader=(value:string)=>cleanCell(value);
const isQq=(value:string)=>/^\d{5,12}$/.test(value);
// 手机号规范化 v2（国际号码合同，与 Rust case_core.rs normalize_phone_key 逐字节同构，黄金夹具 phone-fixtures.json 双端校验）：
// 清洗：空白/连字符/破折号/括号/点/中点，全角数字与全角＋转半角；00 国际拨号前缀视为 +。
// 规则按序：①大陆(?:86)?1[3-9]… → 裸11位（与存量数据去重）②带+/00 且 7-15 位数字 → "+"+数字 ③裸号 8-15 位且前缀命中
// ITU E.164 区号表 → "+"+数字（不拆国家码与本地号，同一号码不同写法必去重）④其余原样返回由调用方拒绝。
const MAINLAND_PHONE=/^1[3-9]\d{9}$/;
const CANONICAL_PHONE=/^(?:1[3-9]\d{9}|\+\d{7,15})$/;
// ITU E.164 已分配区号（紧凑区间，含少量备用号段；宁多勿漏）
const CC_RANGES:Array<[number,number]>=[[1,1],[7,7],[20,20],[27,27],[30,34],[36,36],[39,39],[40,49],[51,58],[60,66],[81,81],[82,82],[84,84],[86,86],[90,95],[98,98],[211,219],[220,235],[236,249],[250,258],[260,269],[290,290],[291,291],[297,299],[350,359],[370,383],[385,389],[420,420],[421,421],[423,423],[500,509],[590,599],[670,683],[685,692],[850,850],[852,852],[853,853],[855,855],[856,856],[870,870],[878,878],[880,883],[886,886],[960,979],[992,998]];
const matchCountryCode=(digits:string):boolean=>{
  if(digits.length<8)return false;
  const at=(size:number)=>size<=digits.length?Number(digits.slice(0,size)):NaN;
  for(const size of [3,2,1] as const){const code=at(size);if(Number.isInteger(code)&&CC_RANGES.some(([lo,hi])=>code>=lo&&code<=hi))return true;}
  return false;
};
const normalizePhone=(value:string)=>{
  const fullwidth=(c:string)=>c>="０"&&c<="９"?String.fromCharCode(c.charCodeAt(0)-0xFEE0):c==="＋"?"+":c;
  const stripped=cleanCell(value).split("").map(fullwidth).join("").replace(/[\s\-()·.．—–]/g,"");
  if(!stripped)return"";
  const hasPlus=stripped.startsWith("+");
  let digits=stripped.replace(/^\+/,"");
  let impliedPlus=hasPlus;
  // 00 国际拨号前缀视为 +（剩余部分全零则不剥，防误判）
  if(!hasPlus&&digits.startsWith("00")&&digits.length>=9&&[...digits.slice(2)].some(c=>c!=="0")){digits=digits.slice(2);impliedPlus=true;}
  if(!/^\d+$/.test(digits))return stripped;
  // 86 前缀 13 位：无论是否带 +，均为大陆手机 → 裸 11 位（与存量数据去重）
  const mainland86=digits.match(/^86(1[3-9]\d{9})$/);
  if(mainland86)return mainland86[1];
  const explicitPlus=hasPlus||impliedPlus;
  // 裸 11 位 1 开头：大陆手机（带 + 的 11 位 1 开头是 NANP 国际形态，走国际分支）
  if(!explicitPlus&&MAINLAND_PHONE.test(digits))return digits;
  // 国际：带 +/00 且 7-15 位 → "+"+数字
  if(explicitPlus&&digits.length>=7&&digits.length<=15)return`+${digits}`;
  // 裸号国际：8-15 位且前缀命中 ITU 区号表 → "+"+数字
  if(!explicitPlus&&digits.length>=8&&digits.length<=15&&matchCountryCode(digits))return`+${digits}`;
  return stripped;
};
const isPhone=(value:string)=>CANONICAL_PHONE.test(value);
const isPhoneLoose=(value:string)=>isPhone(normalizePhone(value));
export const phoneContract={normalizePhone,isPhoneCanonical:isPhone,isPhoneLoose};
const relationKey=(r:PlannedRelation)=>`${r.sourceKind}\u0000${r.sourceKey}\u0000${r.label}\u0000${r.targetKind}\u0000${r.targetKey}`;
const stableDigest=(rows:string[][])=>{const value=rows.map(row=>row.map(cell=>`${new TextEncoder().encode(cell).length}:${cell}`).join("|")).join("\n");let h=2166136261;for(const byte of new TextEncoder().encode(value)){h^=byte;h=Math.imul(h,16777619);}return `fnv1a32:${(h>>>0).toString(16).padStart(8,"0")}`;};

interface DelimiterCandidate { rows:string[][];recordStartLines:number[];diagnostics:ParseDiagnostic[];delimiter:"\t"|","; }
function parseCandidate(input:string,delimiter:"\t"|","):DelimiterCandidate{const rows:string[][]=[],recordStartLines:number[]=[],diagnostics:ParseDiagnostic[]=[];let row:string[]=[],cell="",quoted=false,physicalLine=1,recordStartLine=1,quoteStartLine=1;const finish=()=>{row.push(cell);rows.push(row);recordStartLines.push(recordStartLine);row=[];cell="";recordStartLine=physicalLine+1;};for(let i=0;i<input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){cell+='"';i++;}else if(quoted)quoted=false;else if(!cell.length){quoted=true;quoteStartLine=physicalLine;}else cell+=c;}else if(c===delimiter&&!quoted){row.push(cell);cell="";}else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;finish();physicalLine++;}else{if((c==='\r'||c==='\n')&&quoted){cell+='\n';physicalLine++;if(c==='\r'&&input[i+1]==='\n')i++;}else cell+=c;}}if(quoted)diagnostics.push({code:"unclosed-quote",severity:"error",physicalLine:quoteStartLine,message:`第 ${quoteStartLine} 物理行开始的引号未闭合`});if(row.length||cell.length||input.length){row.push(cell);rows.push(row);recordStartLines.push(recordStartLine);}return{rows,recordStartLines,diagnostics,delimiter};}
function candidateScore(c:DelimiterCandidate):[number,number,number]{const nonempty=c.rows.filter(r=>r.some(v=>v.trim()));const counts=new Map<number,number>();nonempty.forEach(r=>counts.set(r.length,(counts.get(r.length)??0)+1));const [width,n]=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0])[0]??[1,0];return[width>1?n/Math.max(1,nonempty.length):0,width,n];}
export function parseDelimited(text:string):ParseResult{const input=text.replace(/^\ufeff/,"");const selected=[parseCandidate(input,"\t"),parseCandidate(input,",")].sort((a,b)=>{const x=candidateScore(a),y=candidateScore(b);return y[0]-x[0]||y[1]-x[1]||y[2]-x[2];})[0];if(selected.rows.at(-1)?.length===1&&!selected.rows.at(-1)![0].trim()&&/(?:\r\n|\r|\n)$/.test(input)){selected.rows.pop();selected.recordStartLines.pop();}const trimmed=input.replace(/\s+$/,"");return{...selected,delimiter:candidateScore(selected)[1]>1?selected.delimiter:null,physicalLineCount:trimmed?(trimmed.match(/\r\n|\r|\n/g)?.length??0)+1:0,logicalRecordCount:selected.rows.length,dataRecordCount:selected.rows.length,emptyRowsRemoved:0,duplicateHeadersRemoved:0};}
export function normalizeTable(input:TabularInput,hasHeader?:boolean):NormalizedTable{const parsed=typeof input==="string"?parseDelimited(input):{rows:input.map(r=>[...r].map(String)),recordStartLines:input.map((_,i)=>i+1),physicalLineCount:input.length,logicalRecordCount:input.length,dataRecordCount:input.length,emptyRowsRemoved:0,duplicateHeadersRemoved:0,delimiter:null,diagnostics:[]};const cleaned=parsed.rows.map(r=>r.map(cleanCell));const nonempty=cleaned.map((r,i)=>r.some(Boolean)?i:-1).filter(i=>i>=0);let rows=nonempty.map(i=>cleaned[i]),lines=nonempty.map(i=>parsed.recordStartLines[i]);const headerWidth=rows[0]?.length??0;rows.slice(1).forEach((row,i)=>{if(row.length!==headerWidth)parsed.diagnostics.push({code:"row-width",severity:"error",physicalLine:lines[i+1]??i+2,message:`第 ${lines[i+1]??i+2} 行列数 ${row.length} 与表头列数 ${headerWidth} 不一致`});});const knownHeader=Boolean(rows[0]?.some(h=>Object.values(SPECS).some(s=>s.required.includes(canonicalHeader(h)))));const looksTyped=(value:string)=>isQq(value)||isPhoneLoose(value)||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)||/^https?:\/\//i.test(value);const genericHeader=rows.length>1&&rows[0].some(Boolean)&&rows[0].every(value=>!looksTyped(value))&&rows.slice(1,Math.min(rows.length,6)).some(row=>row.some(looksTyped));const detected=hasHeader===false?false:hasHeader===true?true:knownHeader||genericHeader;const headers=detected?rows[0]:[];let duplicateHeadersRemoved=0;const dataRows:string[][]=[],dataLines:number[]=[];rows.slice(detected?1:0).forEach((r,i)=>{if(detected&&r.every((v,j)=>canonicalHeader(v)===canonicalHeader(headers[j]??"")))duplicateHeadersRemoved++;else{dataRows.push(r);dataLines.push(lines[i+(detected?1:0)]);}});lines=detected?[lines[0],...dataLines]:dataLines;return{...parsed,rows:detected?[headers,...dataRows]:dataRows,recordStartLines:lines,hasHeader:detected,headers,dataRows,dataRecordCount:dataRows.length,emptyRowsRemoved:cleaned.length-nonempty.length,duplicateHeadersRemoved};}
export function isTableLike(input:TabularInput):boolean{const t=normalizeTable(input);const width=Math.max(0,...t.rows.map(r=>r.length));if(width<=1)return false;if(typeof input==="string"&&!input.includes("\t")&&t.delimiter===",")return t.hasHeader;return typeof input!=="string"||input.includes("\t")||t.hasHeader;}

function resolveHeaders(headers:string[],spec:Spec):Map<string,number>|undefined{if(headers.length!==spec.required.length||headers.length!==new Set(headers).size)return;const result=new Map<string,number>();for(const required of spec.required){const accepted=[required,...(spec.aliases[required]??[])];const indexes=headers.map((h,i)=>accepted.includes(canonicalHeader(h))?i:-1).filter(i=>i>=0);if(indexes.length!==1)return;result.set(required,indexes[0]);}return result;}
const isUrlOrEmpty=(value:string)=>!value||/^https?:\/\/\S+$/i.test(value);
const isCipherOrEmpty=(value:string)=>!value||(!isQq(value)&&!isPhone(value)&&!/^https?:\/\//i.test(value));
const isQqOrCipherOrEmpty=(value:string)=>isQq(value)||isCipherOrEmpty(value);
const isSuccessOrEmpty=(value:string)=>!value||value===SUCCESS;
const isRole=(value:string)=>/^【\d+】\S+/.test(value)||["群主","管理员","成员","普通成员","创建者"].includes(value);
const isSimilarity=(value:string)=>{if(!value)return false;const n=Number(value.replace(/%$/,""));return Number.isFinite(n)&&n>=0&&(value.endsWith("%")?n<=100:n<=1);};
function validatesStrictRow(template:StrictTemplate,r:string[]):boolean{switch(template){
case "group-list":return isQq(r[1])&&r[3]===SUCCESS&&isQq(r[4])&&isQqOrCipherOrEmpty(r[5])&&isRole(r[7])&&isUrlOrEmpty(r[10])&&(!r[12]||Number.isFinite(Number(r[12])));
case "friend-list":return isQq(r[1])&&isQqOrCipherOrEmpty(r[4])&&isUrlOrEmpty(r[7])&&isCipherOrEmpty(r[9])&&isCipherOrEmpty(r[10])&&isSuccessOrEmpty(r[3]);
case "qq-device":return isQq(r[0])&&isSimilarity(r[1])&&Boolean(r[2]);
case "qq-phone-binding":return isQq(r[0])&&isPhoneLoose(r[1])&&r[3]===SUCCESS&&isCipherOrEmpty(r[4])&&isCipherOrEmpty(r[5]);
case "group-member":return isQq(r[0])&&isQq(r[1])&&isQqOrCipherOrEmpty(r[2])&&isCipherOrEmpty(r[5])&&isCipherOrEmpty(r[7])&&/^【/.test(r[10])&&/^【/.test(r[11]);
case "qq-phone-lookup":return isQq(r[1])&&isPhoneLoose(r[0])&&isQqOrCipherOrEmpty(r[2])&&r[4]===SUCCESS&&isCipherOrEmpty(r[5])&&isCipherOrEmpty(r[6]);}}
// 行校验失败时定位第一个不满足的检查项，返回可读诊断（列名+当前值+期望）
function strictRowDiagnosis(template:StrictTemplate,r:string[],headers:string[]):string{
  const at=(i:number)=>headers[i]??`第${i+1}列`;
  const brief=(v:string)=>v.length>24?`${v.slice(0,24)}…`:v||"(空)";
  const fail=(i:number,expect:string)=>`「${at(i)}」列应为${expect}，实际：${brief(r[i]??"")}`;
  switch(template){
  case "group-list":
    if(!isQq(r[1]))return fail(1,"群号（5-12位数字）");
    if(r[3]!==SUCCESS)return fail(3,"【Success】成功");
    if(!isQq(r[4]))return fail(4,"命中结果QQ号");
    if(!isQqOrCipherOrEmpty(r[5]))return fail(5,"QQ号或密文");
    if(!isRole(r[7]))return fail(7,"查询人角色（如【10】普通成员）");
    if(!isUrlOrEmpty(r[10]))return fail(10,"群头像URL或空");
    if(r[12]&&!Number.isFinite(Number(r[12])))return fail(12,"群人数数字");
    break;
  case "friend-list":
    if(!isQq(r[1]))return fail(1,"好友QQ号（5-12位数字）");
    if(!isQqOrCipherOrEmpty(r[4]))return fail(4,"查询账号QQ或密文");
    if(!isUrlOrEmpty(r[7]))return fail(7,"头像URL或空");
    if(!isCipherOrEmpty(r[9]))return fail(9,"密文或空");
    if(!isCipherOrEmpty(r[10]))return fail(10,"密文或空");
    if(!isSuccessOrEmpty(r[3]))return fail(3,"空或【Success】成功");
    break;
  case "qq-device":
    if(!isQq(r[0]))return fail(0,"UIN QQ号");
    if(!isSimilarity(r[1]))return fail(1,"相似度（0-1或百分比）");
    if(!r[2])return fail(2,"关系（如：原号码/同设备IMEI）");
    break;
  case "qq-phone-binding":
    if(!isQq(r[0]))return fail(0,"QQ账号");
    if(!isPhoneLoose(r[1]))return fail(1,"手机号（大陆 1[3-9]… 或国际 +852… / +1… 格式）");
    if(r[3]!==SUCCESS)return fail(3,"【Success】成功");
    if(!isCipherOrEmpty(r[4]))return fail(4,"密文或空");
    if(!isCipherOrEmpty(r[5]))return fail(5,"密文或空");
    break;
  case "group-member":
    if(!isQq(r[0]))return fail(0,"群号（5-12位数字）");
    if(!isQq(r[1]))return fail(1,"成员QQ号");
    if(!isQqOrCipherOrEmpty(r[2]))return fail(2,"命中内容QQ或密文");
    if(!isCipherOrEmpty(r[5]))return fail(5,"密文或空");
    if(!isCipherOrEmpty(r[7]))return fail(7,"密文或空");
    if(!/^【/.test(r[10]))return fail(10,"成员角色（如【0】普通成员）");
    if(!/^【/.test(r[11]))return fail(11,"是否机器人（如【false】否）");
    break;
  case "qq-phone-lookup":
    if(!isQq(r[1]))return fail(1,"QQ账号");
    if(!isPhoneLoose(r[0]))return fail(0,"手机号（支持86-/+86-前缀）");
    if(!isQqOrCipherOrEmpty(r[2]))return fail(2,"命中内容QQ或密文");
    if(r[4]!==SUCCESS)return fail(4,"【Success】成功");
    if(!isCipherOrEmpty(r[5]))return fail(5,"密文或空");
    if(!isCipherOrEmpty(r[6]))return fail(6,"密文或空");
    break;
  }
  return "字段内容未通过模板语义校验";
}
function validatesPositional(template:StrictTemplate,rows:string[][]):boolean{if(!rows.length)return false;const width=SPECS[template].required.length;if(rows.some(row=>row.length!==width)||!rows.every(row=>validatesStrictRow(template,row)))return false;if(template==="group-list"||template==="friend-list")return new Set(rows.map(r=>r[4]).filter(Boolean)).size===1;if(template==="qq-phone-binding")return new Set(rows.map(r=>r[1]).filter(Boolean)).size===1;if(template==="qq-phone-lookup")return new Set(rows.map(r=>r[1]).filter(Boolean)).size===1;if(template==="group-member")return new Set(rows.map(r=>r[0]).filter(Boolean)).size===1;return true;}
export function recognizeTemplate(input:TabularInput,options:Pick<BuildImportPlanOptions,"hasHeader">={}):TemplateRecognition{let table=normalizeTable(input,options.hasHeader);const headerMatches=table.hasHeader?(Object.entries(SPECS) as Array<[StrictTemplate,Spec]>).filter(([,s])=>resolveHeaders(table.headers,s)):[];const positionalMatches=!table.hasHeader?(Object.keys(SPECS) as StrictTemplate[]).filter(name=>validatesPositional(name,table.dataRows)):[];const matches=table.hasHeader?headerMatches:positionalMatches.map(name=>[name,SPECS[name]] as [StrictTemplate,Spec]);const template=matches.length===1?matches[0][0]:"custom";const mode=table.hasHeader?"strict-header":"strict-positional";if(template!=="custom"&&!table.hasHeader){const headers=[...SPECS[template].required];table={...table,headers,rows:[headers,...table.dataRows]};}const reasons=template!=="custom"?[mode==="strict-header"?"strict-v1 完整表头指纹匹配":`无表头，按已验证${SPECS[template].required.length}列位置合同识别`]:table.hasHeader?(matches.length>1?["表头指纹不唯一"]:["未知表头指纹，仅生成诊断，不可导入"]):(matches.length>1?["无表头位置合同命中不唯一"]:["无表头数据未通过四类严格位置合同"]);return{template,mode,confidence:template==="custom"?"low":"high",score:template==="custom"?0:100,reasons,alternatives:matches.map(([name])=>({template:name,score:100})),table};}
const attr=(fieldKey:string,valueText:string,valueType:AttributeValueType="text"):PlannedAttribute|undefined=>{if(!valueText)return;const a:PlannedAttribute={fieldKey,valueType,valueText};if(valueType==="number"){const n=fieldKey==="similarity"?Number(valueText.replace("%",""))/(valueText.includes("%")?100:1):Number(valueText);if(Number.isFinite(n))a.valueNumber=n;}if(valueType==="datetime")a.valueTime=valueText;return a;};
const attributes=(row:Record<string,string>,fields:Spec["targetProps"])=>fields.map(([column,key,type])=>attr(key,row[column],type)).filter((a):a is PlannedAttribute=>Boolean(a));
const errorRow=(rowNumber:number,error:string,rawRecord:Record<string,string>):ImportPlanRow=>({rowNumber,valid:false,error,reason:error,targetEntities:[],relations:[],entityAttributes:[],relationAttributes:[],rawRecord,decision:"error"});
function emptyPlan(recognition:TemplateRecognition,batchErrors:string[]):ImportPlan{const t=recognition.table;const error=0;return{template:"custom",templateVersion:"strict-v1",templateMode:recognition.mode,rawTable:t.rows,confidence:"low",reasons:recognition.reasons,inferredColumns:[],headerFingerprint:t.headers.join("\u001f"),inputDigest:stableDigest(t.rows),duplicateRelations:0,rowDecisions:[],batchErrors,canSubmit:false,rows:[],sourceEntities:[],targetEntities:[],relations:[],entityAttributes:[],relationAttributes:[],ignoredColumns:t.headers,delimiter:t.delimiter,diagnostics:t.diagnostics,stats:{total:t.dataRecordCount,physicalLineCount:t.physicalLineCount,logicalRecordCount:t.logicalRecordCount,dataRecordCount:t.dataRecordCount,emptyRowsRemoved:t.emptyRowsRemoved,duplicateHeadersRemoved:t.duplicateHeadersRemoved,valid:0,error,duplicate:0,entities:0,relations:0,entityAttributes:0,relationAttributes:0}};}
export function buildImportPlan(input:TabularInput,options:BuildImportPlanOptions={}):ImportPlan {
  const rawRows=(typeof input==="string"?parseDelimited(input).rows:input.map(row=>[...row].map(String))).filter(row=>row.some(cell=>cleanCell(cell)));
  const rawWidth=rawRows[0]?.length??0,widthError=rawRows.slice(1).findIndex(row=>row.length!==rawWidth);
  const recognition=recognizeTemplate(input,{hasHeader:options.hasHeader}),table=recognition.table;
  if(widthError>=0)return emptyPlan(recognition,[`第 ${widthError+2} 行列数与表头不一致`]);
  if(recognition.template==="custom"||options.template&&options.template!==recognition.template)return emptyPlan(recognition,[...recognition.reasons,options.template&&options.template!==recognition.template?"手选模板与严格表头指纹不符":""].filter(Boolean));
  const template=recognition.template,spec=SPECS[template],map=resolveHeaders(table.headers,spec)!;
  const records=table.dataRows.map((values,i)=>({rowNumber:table.recordStartLines[i+(recognition.mode==="strict-header"?1:0)]??i+(recognition.mode==="strict-header"?2:1),values,row:Object.fromEntries(table.headers.map((h,j)=>[canonicalHeader(h),cleanCell(values[j])]))}));
  const batchErrors:string[]=[];
  let originKey="",overlapCandidates:string[]|undefined,parentSelectionReason:ParentSelectionReason|undefined;
  if(template==="qq-device"){
    const current=typeof options.currentSource==="string"?{kind:"qq" as EntityKind,value:options.currentSource}:options.currentSource;
    const selectedKey=current?.kind==="qq"&&isQq(cleanCell(current.value))?cleanCell(current.value):"";
    const fileOrigins=[...new Set(records.filter(({row})=>cleanCell(row["关系"])==="原号码").map(({row})=>cleanCell(row[spec.target])).filter(isQq))];
    const fallbackKey=selectedKey||(fileOrigins.length===1?fileOrigins[0]:"");
    if(!fallbackKey)batchErrors.push(fileOrigins.length>1?"同机文件包含多个原号码，请先选择实际用于查询的QQ号":"同机文件没有唯一原号码，请先选择实际用于查询的QQ号");
    else {
      const targets=[...new Set(records.map(({row})=>cleanCell(row[spec.target])).filter(isQq))];
      overlapCandidates=targets.filter(key=>key!==fallbackKey&&options.existingEntityKeys?.has(`qq\0${key}`)).sort();
      const explicit=cleanCell(options.explicitParentKey);
      if(overlapCandidates.length===0){originKey=fallbackKey;parentSelectionReason=selectedKey?"fallback-current-selection":"file-origin";}
      else if(overlapCandidates.length===1){originKey=overlapCandidates[0];parentSelectionReason="unique-existing-overlap";}
      else if(explicit&&overlapCandidates.includes(explicit)){originKey=explicit;parentSelectionReason="explicit-existing-overlap";}
      else {originKey=fallbackKey;batchErrors.push(`检测到多个案件已有QQ与同机结果重合，请选择本批父节点：${overlapCandidates.join("、")}`);}
    }
  }else{
    const normalize=(v:string)=>spec.sourceKind==="phone"?normalizePhone(v):v;
    const sources=new Set(records.map(({row})=>normalize(row[spec.source])).filter(Boolean));
    const primaryOK=sources.size===1&&(spec.sourceKind==="phone"?isPhone([...sources][0]):isQq([...sources][0]));
    if(primaryOK)originKey=[...sources][0];
    else if(spec.fallbackSource){
      // 主起点列缺失/密文/不唯一时回退解密列（如好友列表"查询账号"密文 → "查询账号(解密)"明文）
      const fallbackColumn=spec.fallbackSource;
      const fallbacks=new Set(records.map(({row})=>normalize(row[fallbackColumn])).filter(Boolean));
      if(fallbacks.size===1&&(spec.sourceKind==="phone"?isPhone([...fallbacks][0]):isQq([...fallbacks][0])))originKey=[...fallbacks][0];
      else batchErrors.push(`查询起点必须唯一且格式有效，实际 ${fallbacks.size} 个候选`);
    }else batchErrors.push(`查询起点必须唯一，实际 ${sources.size}`);
  }
  const queryOrigin:QueryOrigin|undefined=originKey?{kind:spec.sourceKind,key:originKey,displayName:template==="qq-device"&&typeof options.currentSource!=="string"&&cleanCell(options.currentSource?.value)===originKey?options.currentSource?.displayName:undefined}:undefined;
  const seen=new Map<string,ImportPlanRow>(),rows:ImportPlanRow[]=[];
  for(const {rowNumber,values,row} of records){
    const sourceValue=originKey;
    const rawTarget=row[spec.target];
    // 手机号端点规范化：86-/+86 前缀剥离为11位裸号
    const targetValue=spec.targetKind==="phone"?normalizePhone(rawTarget):rawTarget;
    const code=row["错误码类型"]??"";
    const codeOk=spec.success==="all"||code===SUCCESS||(spec.success==="blank-or-explicit"&&(code===""||code===SUCCESS))||(spec.success==="explicit-or-plain"&&(code==="Success"||code===SUCCESS));
    let built:ImportPlanRow;
    if(!validatesStrictRow(template,values))built=errorRow(rowNumber,strictRowDiagnosis(template,values,table.headers),row);
    else if(template==="group-list"&&isQq(row["QQ号"])&&row["QQ号"]!==sourceValue)built=errorRow(rowNumber,"命中结果与QQ号不一致",row);
    else if(!codeOk)built=errorRow(rowNumber,"错误码非严格成功码",row);
    else if(!(spec.sourceKind==="phone"?isPhone(sourceValue):isQq(sourceValue)))built=errorRow(rowNumber,"查询起点主键格式无效",row);
    else if(!(spec.targetKind==="phone"?isPhone(targetValue):isQq(targetValue)))built=errorRow(rowNumber,"目标主键格式无效",row);
    else {
      const targetAttrs=attributes(row,spec.targetProps),relationAttrs=attributes(row,spec.relationProps);
      if(template==="qq-device"&&targetValue===sourceValue){
        built={rowNumber,valid:true,reason:"UIN等于当前查询QQ，跳过自环并保留实体属性",sourceEntity:{kind:"qq",key:sourceValue,displayName:row["昵称"]||"",attributes:targetAttrs},targetEntities:[],relations:[],entityAttributes:targetAttrs,relationAttributes:[],rawRecord:row,decision:"source_only"};
      }else{
        let sourceKind=spec.sourceKind,targetKind=spec.targetKind,left=sourceValue,right=targetValue;
        const originEntity:PlannedEntity={kind:spec.sourceKind,key:sourceValue,displayName:"",attributes:[]};
        const targetEntity:PlannedEntity={kind:spec.targetKind,key:targetValue,displayName:row["群名称"]||row["昵称"]||row["QQ账号昵称"]||"",attributes:targetAttrs};
        const relation:PlannedRelation={sourceKind,sourceKey:left,targetKind,targetKey:right,label:spec.label,attributes:relationAttrs};
        const key=relationKey(relation);
        built={rowNumber,valid:true,reason:"严格合同通过",sourceEntity:originEntity,targetEntities:[targetEntity],relations:[relation],entityAttributes:targetEntity.attributes,relationAttributes:relationAttrs,rawRecord:row,relationKey:key,decision:seen.has(key)?"duplicate_merged":"accepted"};
        if(seen.has(key)){const first=seen.get(key)!;first.relations[0].attributes.push(...relationAttrs.map(a=>({...a})));}else seen.set(key,built);
      }
    }
    rows.push(built);
  }
  const uniqueRows=[...seen.values()],relations=uniqueRows.flatMap(r=>r.relations);
  const allEntities=rows.flatMap(r=>[...(r.sourceEntity?[r.sourceEntity]:[]),...r.targetEntities]);
  const entityMap=new Map<string,PlannedEntity>();
  for(const entity of allEntities){const key=`${entity.kind}\0${entity.key}`;if(!entityMap.has(key))entityMap.set(key,entity);}
  const entities=[...entityMap.values()];
  const sourceEntities=entities.filter(e=>queryOrigin&&e.kind===queryOrigin.kind&&e.key===queryOrigin.key);
  const targetEntities=entities.filter(e=>!queryOrigin||e.kind!==queryOrigin.kind||e.key!==queryOrigin.key);
  const entityAttributes=entities.flatMap(e=>e.attributes),relationAttributes=relations.flatMap(r=>r.attributes);
  const duplicates=rows.filter(r=>r.decision==="duplicate_merged").length,error=rows.filter(r=>!r.valid).length+table.diagnostics.length;
  const endpointContract:EndpointContract={sourceColumn:spec.source,sourceKind:spec.sourceKind,targetColumn:spec.target,targetKind:spec.targetKind,relationLabel:spec.label,direction:`${spec.sourceKind}→${spec.targetKind}`};
  const stats:ImportPlanStats={total:records.length,physicalLineCount:table.physicalLineCount,logicalRecordCount:table.logicalRecordCount,dataRecordCount:records.length,emptyRowsRemoved:table.emptyRowsRemoved,duplicateHeadersRemoved:table.duplicateHeadersRemoved,valid:rows.filter(r=>r.valid).length,error,duplicate:duplicates,entities:entities.length,relations:relations.length,entityAttributes:entityAttributes.length,relationAttributes:relationAttributes.length};
  const originExists=Boolean(queryOrigin&&options.existingEntityKeys?.has(`${queryOrigin.kind}\0${queryOrigin.key}`));
  const current=typeof options.currentSource==="string"?undefined:options.currentSource;
  const currentIsOrigin=Boolean(queryOrigin&&current&&current.kind===queryOrigin.kind&&cleanCell(current.value)===queryOrigin.key);
  const accessStatus=currentIsOrigin?"query-origin":originExists?"reuse-existing":current&&queryOrigin?"bridge-available":"unavailable";
  return{template,templateVersion:"strict-v1",templateMode:recognition.mode,rawTable:table.rows,confidence:"high",reasons:recognition.reasons,inferredColumns:[`${spec.source} → ${spec.target}`],headerFingerprint:table.headers.join("\u001f"),inputDigest:stableDigest(table.rows),endpointContract,queryOrigin,currentSource:current,accessStatus,overlapCandidates,parentSelectionReason,explicitParentKey:options.explicitParentKey,duplicateRelations:duplicates,rowDecisions:rows,batchErrors,canSubmit:error===0&&batchErrors.length===0&&relations.length>0,rows,sourceEntity:sourceEntities[0],sourceEntities,targetEntities,relations,entityAttributes,relationAttributes,ignoredColumns:table.headers.filter(h=>!map.has(h)),delimiter:table.delimiter,diagnostics:table.diagnostics,stats};
}
export function currentClueBridge(plan:ImportPlan,current?:CurrentImportSource):CurrentClueBridge|undefined {
  if(!plan.queryOrigin||!current)return;
  if(plan.templateVersion==="strict-v1"&&plan.accessStatus!=="bridge-available")return;
  if(plan.templateVersion==="manual-mapped-v1"&&plan.accessStatus!=="bridge-available")return;
  const key=cleanCell(current.value),origin=plan.queryOrigin;
  if(!key||(current.kind===origin.kind&&key===origin.key))return;
  return{entity:{kind:current.kind,key,displayName:current.displayName??"",attributes:[]},relation:{sourceKind:current.kind,sourceKey:key,targetKind:origin.kind,targetKey:origin.key,label:"查询号码",attributes:[]}};
}
export function withCurrentClueBridge(plan:ImportPlan,bridge?:CurrentClueBridge):ImportPlan{if(!bridge)return plan;const bridgeKey=`${bridge.entity.kind}\u0000${bridge.entity.key}`;const entityKnown=plan.sourceEntities.concat(plan.targetEntities).some(e=>`${e.kind}\u0000${e.key}`===bridgeKey);return{...plan,sourceEntities:entityKnown?plan.sourceEntities:[...plan.sourceEntities,bridge.entity],relations:[...plan.relations,bridge.relation],bridgeRelationCount:1};}



const manualKinds: ManualEntityKind[] = ["qq", "group", "phone", "ip", "custom"];
const isIp=(value:string)=>{const parts=value.split(".");return parts.length===4&&parts.every(part=>/^\d{1,3}$/.test(part)&&Number(part)<=255);};
const validManualKey=(kind:ManualEntityKind,value:string)=>kind==="qq"||kind==="group"?isQq(value):kind==="phone"?isPhoneLoose(value):kind==="ip"?isIp(value):Boolean(value.trim());
function inferredKind(values:string[]):ManualEntityKind|undefined{if(!values.length)return;for(const [kind,test] of [["qq",isQq],["phone",isPhoneLoose],["ip",isIp]] as const){if(values.filter(Boolean).length&&values.filter(Boolean).every(test))return kind;}return;}
const headerKindHint=(header:string):ManualEntityKind|undefined=>{const h=canonicalHeader(header);if(/群/.test(h))return"group";if(/手机|电话/.test(h))return"phone";if(/ip/i.test(h))return"ip";if(/qq|账号/i.test(h))return"qq";return;};
export function suggestManualMapping(input:TabularInput,hasHeader?:boolean):ManualMappingSuggestion{
 const table=normalizeTable(input,hasHeader), width=Math.max(0,...table.rows.map(r=>r.length));
 const columns=Array.from({length:width},(_,index)=>table.dataRows.map(row=>cleanCell(row[index])).filter(Boolean));
 const typed=columns.map((values,index)=>{const byValue=inferredKind(values);const hint=table.hasHeader?headerKindHint(table.headers[index]??""):undefined;return hint==="group"&&byValue==="qq"?"group":byValue;}), unique=columns.map(values=>new Set(values).size);
 const sourceIndex=columns.map((values,index)=>({index,ok:values.length>0&&unique[index]===1&&Boolean(typed[index])})).find(x=>x.ok)?.index;
 const targetIndex=columns.map((values,index)=>({index,ok:index!==sourceIndex&&unique[index]>1&&Boolean(typed[index])})).find(x=>x.ok)?.index;
 return {hasHeader:table.hasHeader,sourceIndex,sourceKind:sourceIndex===undefined?undefined:typed[sourceIndex],targetIndex,targetKind:targetIndex===undefined?undefined:typed[targetIndex]};
}
export function buildManualMappedPlan(input:TabularInput,mapping:ManualMapping,options:BuildImportPlanOptions={}):ImportPlan{
 const parsed=normalizeTable(input,mapping.hasHeader), width=Math.max(0,...parsed.rows.map(r=>r.length));
 const headers=mapping.hasHeader?parsed.headers:Array.from({length:width},(_,i)=>`第${i+1}列`);
 const rawTable=mapping.hasHeader?parsed.rows:[headers,...parsed.dataRows];
 const batchErrors:string[]=[];
 if(!manualKinds.includes(mapping.sourceKind)||!manualKinds.includes(mapping.targetKind))batchErrors.push("端点类型无效");
 if(!mapping.relationLabel.trim())batchErrors.push("关系名称不能为空");
 for(const index of [mapping.sourceIndex,mapping.targetIndex,...(mapping.displayNameIndex===undefined?[]:[mapping.displayNameIndex])])if(!Number.isInteger(index)||index<0||index>=width)batchErrors.push("映射列超出范围");
 if(mapping.sourceIndex===mapping.targetIndex)batchErrors.push("来源列和目标列不能相同");
 const rows:ImportPlanRow[]=[], seen=new Map<string,ImportPlanRow>();
 for(let i=0;i<parsed.dataRows.length;i++){
  const values=parsed.dataRows[i], rowNumber=(parsed.recordStartLines[i+(mapping.hasHeader?1:0)]??i+(mapping.hasHeader?2:1));
  const rawRecord=Object.fromEntries(headers.map((h,j)=>[h,cleanCell(values[j])]));
  const source=cleanCell(values[mapping.sourceIndex]),target=cleanCell(values[mapping.targetIndex]); let error="";
  if(values.length!==width)error="行宽与映射表不一致";else if(!source||!target)error="来源或目标不能为空";else if(!validManualKey(mapping.sourceKind,source))error="来源格式不符";else if(!validManualKey(mapping.targetKind,target))error="目标格式不符";else if(mapping.sourceKind===mapping.targetKind&&source===target)error="来源与目标不能自环";
  if(error){rows.push(errorRow(rowNumber,error,rawRecord));continue;}
  // 手机号端点入库前规范化（86-/+86- 前缀剥离），与严格模板一致
  const canonical=(kind:ManualEntityKind,v:string)=>kind==="phone"?normalizePhone(v):v;
  const sourceKey=canonical(mapping.sourceKind,source),targetKey=canonical(mapping.targetKind,target);
  const sourceEntity:PlannedEntity={kind:mapping.sourceKind,key:sourceKey,displayName:"",attributes:[]};
  const targetEntity:PlannedEntity={kind:mapping.targetKind,key:targetKey,displayName:mapping.displayNameIndex===undefined?"":cleanCell(values[mapping.displayNameIndex]),attributes:[]};
  const relation:PlannedRelation={sourceKind:mapping.sourceKind,sourceKey,targetKind:mapping.targetKind,targetKey,label:mapping.relationLabel.trim(),attributes:[]};
  const key=relationKey(relation), duplicate=seen.has(key);
  const built:ImportPlanRow={rowNumber,valid:true,reason:"手工映射通过",sourceEntity,targetEntities:[targetEntity],relations:[relation],entityAttributes:[],relationAttributes:[],rawRecord,relationKey:key,decision:duplicate?"duplicate_merged":"accepted"};
  if(!duplicate)seen.set(key,built); rows.push(built);
 }
 const sources=new Set(rows.filter(r=>r.valid).map(r=>`${r.sourceEntity!.kind}\0${r.sourceEntity!.key}`));if(sources.size!==1)batchErrors.push(`来源必须全批唯一，实际 ${sources.size}`);
 const uniqueRows=[...seen.values()], relations=uniqueRows.flatMap(r=>r.relations), sourceEntities=[...new Map(rows.flatMap(r=>r.sourceEntity?[r.sourceEntity]:[]).map(e=>[`${e.kind}\0${e.key}`,e])).values()], targetEntities=[...new Map(uniqueRows.flatMap(r=>r.targetEntities).map(e=>[`${e.kind}\0${e.key}`,e])).values()];
 const duplicates=rows.filter(r=>r.decision==="duplicate_merged").length,error=rows.filter(r=>!r.valid).length+parsed.diagnostics.length;
 const stats:ImportPlanStats={total:parsed.dataRows.length,physicalLineCount:parsed.physicalLineCount,logicalRecordCount:parsed.logicalRecordCount,dataRecordCount:parsed.dataRows.length,emptyRowsRemoved:parsed.emptyRowsRemoved,duplicateHeadersRemoved:parsed.duplicateHeadersRemoved,valid:rows.filter(r=>r.valid).length,error,duplicate:duplicates,entities:new Set([...sourceEntities,...targetEntities].map(e=>`${e.kind}\0${e.key}`)).size,relations:relations.length,entityAttributes:0,relationAttributes:0};
 // 接入合同（与严格模板对齐）：来源列唯一值已存在于案件 → 复用同值实体；不存在且有当前选中 → 桥接引申。
 const originKey=sourceEntities.length===1?sourceEntities[0].key:"";
 const queryOrigin:QueryOrigin|undefined=originKey?{kind:mapping.sourceKind,key:originKey,displayName:""}:undefined;
 const current=typeof options.currentSource==="string"?undefined:options.currentSource;
 const originExists=Boolean(originKey&&options.existingEntityKeys?.has(`${mapping.sourceKind}\0${originKey}`));
 const currentIsOrigin=Boolean(queryOrigin&&current&&current.kind===queryOrigin.kind&&cleanCell(current.value)===queryOrigin.key);
 const accessStatus=currentIsOrigin?"query-origin":originExists?"reuse-existing":current&&queryOrigin?"bridge-available":"unavailable";
 return {template:"custom",templateVersion:"manual-mapped-v1",templateMode:"manual-mapped",mapping:{...mapping,relationLabel:mapping.relationLabel.trim()},rawTable,confidence:"low",reasons:["用户确认手工映射"],inferredColumns:[`${headers[mapping.sourceIndex]??""} → ${headers[mapping.targetIndex]??""}`],headerFingerprint:headers.join("\u001f"),inputDigest:stableDigest(rawTable),endpointContract:{sourceColumn:headers[mapping.sourceIndex]??"",sourceKind:mapping.sourceKind,targetColumn:headers[mapping.targetIndex]??"",targetKind:mapping.targetKind,relationLabel:mapping.relationLabel.trim(),direction:`${mapping.sourceKind}→${mapping.targetKind}`},duplicateRelations:duplicates,rowDecisions:rows,batchErrors,canSubmit:batchErrors.length===0&&error===0&&relations.length>0,rows,sourceEntity:sourceEntities.length===1?sourceEntities[0]:undefined,sourceEntities,targetEntities,relations,entityAttributes:[],relationAttributes:[],ignoredColumns:headers.filter((_,i)=>![mapping.sourceIndex,mapping.targetIndex,mapping.displayNameIndex].includes(i)),delimiter:parsed.delimiter,diagnostics:parsed.diagnostics,stats,queryOrigin,currentSource:current,accessStatus,bridgeRelationCount:0};
}
