#!/usr/bin/env node
const { spawnSync } = require('child_process');
const readline = require('readline');
const CLI = process.env.CLUE_WORKBENCH_CLI || '/Applications/线索研判.app/Contents/MacOS/clue-workbench-cli';
const APP = process.env.CLUE_WORKBENCH_APP_PATH || '/Applications/线索研判.app';
const tool=(name,description,properties={},required=[])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
const text={type:'string'}, caseId={type:'string',description:'案件ID'};
const TOOLS=[
 tool('clue_health','检查本地案件库和CLI是否可用。'),
 tool('clue_list_cases','列出本地案件。可按状态筛选。',{status:{type:'string',enum:['active','archived','trash']}}),
 tool('clue_get_case','读取案件详情。',{caseId},['caseId']),
 tool('clue_create_case','创建案件。',{title:text,background:text,seedKind:{type:'string'},seedValue:text},['title','seedKind','seedValue']),
 tool('clue_add_relationships','批量增加关联对象。',{caseId,sourceId:text,targetKind:text,values:{type:'array',items:text},displayNames:{type:'array',items:text},label:text,spread:text,note:text,customType:text},['caseId','sourceId','targetKind','values','label']),
 tool('clue_update_case_overview','更新案件概览。',{caseId,background:text,policeDisposal:text,currentStatus:text,pathLanes:{type:'array',items:text}},['caseId','background','policeDisposal','currentStatus','pathLanes']),
 tool('clue_update_entity','更新对象。',{entity:{type:'object'}},['entity']),
 tool('clue_update_relation','更新关系。',{relation:{type:'object'}},['relation']),
 tool('clue_archive_case','归档案件。',{caseId,archiveTitle:text,folder:text,note:text},['caseId','archiveTitle']),
 tool('clue_restore_case','恢复案件。',{caseId},['caseId']),
 tool('clue_move_case_to_trash','将案件移入回收站。',{caseId},['caseId']),
 tool('clue_undo_case','撤销案件最近一次图谱改动。',{caseId},['caseId']),
 tool('clue_redo_case','重做案件最近一次图谱改动。',{caseId},['caseId']),
 tool('clue_export_case','导出单案三件套。',{caseId,destination:text},['caseId']),
 tool('clue_backup_all','一键备份全部案件。',{destination:text,status:{type:'string',enum:['active','archived','trash']}},['destination']),
 tool('clue_open_app','打开桌面应用。')
];
function cli(args){const r=spawnSync(CLI,args,{encoding:'utf8',timeout:120000});if(r.error)throw r.error;if(!r.stdout.trim())throw new Error(r.stderr.trim()||`CLI无输出：${r.status}`);const p=JSON.parse(r.stdout);if(!p.ok)throw new Error(String(p.error||'CLI错误'));return p.result;}
function call(name,a){switch(name){
case'clue_health':return cli(['health']);case'clue_list_cases':return cli(a.status?['case-list','--status',a.status]:['case-list']);case'clue_get_case':return cli(['case-get','--id',a.caseId]);
case'clue_create_case':return cli(['case-create','--json',JSON.stringify(a)]);case'clue_add_relationships':return cli(['relation-add','--json',JSON.stringify(a)]);
case'clue_update_case_overview':return cli(['case-overview-update','--json',JSON.stringify({id:a.caseId,background:a.background,policeDisposal:a.policeDisposal,currentStatus:a.currentStatus,pathLanes:a.pathLanes})]);
case'clue_update_entity':return cli(['entity-update','--json',JSON.stringify(a.entity)]);case'clue_update_relation':return cli(['relation-update','--json',JSON.stringify(a.relation)]);
case'clue_archive_case':return cli(['case-archive','--json',JSON.stringify({id:a.caseId,archiveTitle:a.archiveTitle,folder:a.folder||'',note:a.note||''})]);case'clue_restore_case':return cli(['case-restore','--id',a.caseId]);case'clue_move_case_to_trash':return cli(['case-trash','--id',a.caseId]);case'clue_undo_case':return cli(['case-undo','--id',a.caseId]);case'clue_redo_case':return cli(['case-redo','--id',a.caseId]);
case'clue_export_case':{const x=['export','--id',a.caseId];if(a.destination)x.push('--destination',a.destination);return cli(x);}case'clue_backup_all':{const x=['backup-all','--destination',a.destination];if(a.status)x.push('--status',a.status);return cli(x);}case'clue_open_app':return cli(['app-open','--path',APP]);default:throw new Error(`未知工具：${name}`);}}
function reply(id,result){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');}
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});rl.on('line',line=>{let id=null;try{const r=JSON.parse(line);id=r.id;if(r.method==='notifications/initialized')return;if(r.method==='initialize')reply(id,{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'clue-workbench-local',version:'0.7.13'}});else if(r.method==='tools/list')reply(id,{tools:TOOLS});else if(r.method==='tools/call'){const p=r.params||{};reply(id,{content:[{type:'text',text:JSON.stringify(call(p.name,p.arguments||{}),null,2)}]});}else if(id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32601,message:`不支持的方法：${r.method}`}})+'\n');}catch(e){if(id!==null)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32000,message:String(e.message||e)}})+'\n');else process.stderr.write(String(e)+'\n');}});
