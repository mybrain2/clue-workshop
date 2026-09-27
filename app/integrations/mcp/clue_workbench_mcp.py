#!/usr/bin/env python3
from __future__ import annotations

"""Local stdio MCP adapter for the Clue Workbench CLI.

It deliberately exposes typed case operations only. It never accepts arbitrary SQL,
filesystem paths for case data, or permanent-delete operations.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
BUNDLED_CLI = Path("/Applications/线索研判.app/Contents/MacOS/clue-workbench-cli")
DEFAULT_CLI = BUNDLED_CLI if BUNDLED_CLI.exists() else ROOT / "src-tauri" / "target" / "release" / "clue-workbench-cli"
CLI = Path(os.environ.get("CLUE_WORKBENCH_CLI", DEFAULT_CLI))
APP_PATH = os.environ.get("CLUE_WORKBENCH_APP_PATH", "/Applications/线索研判.app")


def tool(name: str, description: str, properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required or [],
            "additionalProperties": False,
        },
    }


TOOLS = [
    tool("clue_health", "检查本地案件库和CLI是否可用。", {}),
    tool("clue_list_cases", "列出本地案件。可按 active、archived 或 trash 筛选。", {"status": {"type": "string", "enum": ["active", "archived", "trash"]}}),
    tool("clue_get_case", "读取单个案件的背景、实体、关系和根节点。", {"caseId": {"type": "string", "description": "案件 ID"}}, ["caseId"]),
    tool("clue_create_case", "创建一个案件，并建立主体簇与初始线索。", {
        "title": {"type": "string"}, "background": {"type": "string"},
        "seedKind": {"type": "string", "enum": ["qq", "wechat", "phone", "ip", "location", "datacenter", "device", "group", "platform", "organization", "custom"]},
        "seedValue": {"type": "string"},
    }, ["title", "seedKind", "seedValue"]),
    tool("clue_add_relationships", "从当前对象批量增加关联对象；自动按案件内 类型+值+自定义类型 去重。", {
        "caseId": {"type": "string"}, "sourceId": {"type": "string"},
        "targetKind": {"type": "string", "enum": ["subject", "qq", "wechat", "phone", "ip", "location", "datacenter", "device", "group", "platform", "organization", "custom"]},
        "values": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 500},
        "displayNames": {"type": "array", "items": {"type": "string"}, "description": "可选；与 values 逐行对应的账号命名/昵称。"},
        "label": {"type": "string"}, "spread": {"type": "string"}, "note": {"type": "string"}, "customType": {"type": "string"},
    }, ["caseId", "sourceId", "targetKind", "values", "label"]),
    tool("clue_update_case_overview", "更新案情简介、警方处置、当前现状和调查路径分栏。", {"caseId": {"type": "string"}, "background": {"type": "string"}, "policeDisposal": {"type": "string"}, "currentStatus": {"type": "string"}, "pathLanes": {"type": "array", "items": {"type": "string"}}}, ["caseId", "background", "policeDisposal", "currentStatus", "pathLanes"]),
    tool("clue_update_entity", "更新一个对象的状态、角色、备注、重点色或重点标记。传入从 clue_get_case 得到的完整 entity，并修改需要的字段。", {"entity": {"type": "object"}}, ["entity"]),
    tool("clue_update_relation", "更新一条关系的名称、状态、扩散方式、备注或加粗标记。传入完整 relation。", {"relation": {"type": "object"}}, ["relation"]),
    tool("clue_archive_case", "归档案件，可给归档副标题、文件夹名和备注。", {"caseId": {"type": "string"}, "archiveTitle": {"type": "string"}, "folder": {"type": "string"}, "note": {"type": "string"}}, ["caseId", "archiveTitle"]),
    tool("clue_restore_case", "将归档或回收站中的案件恢复为进行中。", {"caseId": {"type": "string"}}, ["caseId"]),
    tool("clue_move_case_to_trash", "将案件移入回收站，不会自动或永久删除。", {"caseId": {"type": "string"}}, ["caseId"]),
    tool("clue_undo_case", "撤销当前案件最近一次由界面、CLI或MCP记录的对象/关系改动。", {"caseId": {"type": "string"}}, ["caseId"]),
    tool("clue_redo_case", "重做当前案件最近一次已撤销的对象/关系改动。", {"caseId": {"type": "string"}}, ["caseId"]),
    tool("clue_export_case", "导出单个案件的.cluecase、XMind和Markdown三件套。", {"caseId": {"type": "string"}, "destination": {"type": "string"}}, ["caseId"]),
    tool("clue_backup_all", "一键将全部案件导出为可回导.cluecase、XMind和Markdown三件套。", {"destination": {"type": "string"}, "status": {"type": "string", "enum": ["active", "archived", "trash"]}}, ["destination"]),
    tool("clue_open_app", "拉起本地线索研判桌面程序。", {}),
]


def cli(*args: str) -> Any:
    if not CLI.exists():
        raise RuntimeError(f"未找到已构建 CLI：{CLI}。请先构建应用。")
    completed = subprocess.run([str(CLI), *args], capture_output=True, text=True, timeout=30, check=False)
    raw = completed.stdout.strip()
    if not raw:
        raise RuntimeError(completed.stderr.strip() or f"CLI 无输出，退出码 {completed.returncode}")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"CLI 返回非 JSON：{raw[:300]} ({error})") from error
    if not payload.get("ok"):
        raise RuntimeError(str(payload.get("error", "未知 CLI 错误")))
    return payload.get("result")


def call_tool(name: str, args: dict[str, Any]) -> Any:
    if name == "clue_health":
        return cli("health")
    if name == "clue_list_cases":
        status = args.get("status")
        return cli("case-list", "--status", status) if status else cli("case-list")
    if name == "clue_get_case":
        return cli("case-get", "--id", args["caseId"])
    if name == "clue_create_case":
        return cli("case-create", "--json", json.dumps(args, ensure_ascii=False))
    if name == "clue_add_relationships":
        return cli("relation-add", "--json", json.dumps(args, ensure_ascii=False))
    if name == "clue_update_case_overview":
        return cli("case-overview-update", "--json", json.dumps({"id": args["caseId"], "background": args["background"], "policeDisposal": args["policeDisposal"], "currentStatus": args["currentStatus"], "pathLanes": args["pathLanes"]}, ensure_ascii=False))
    if name == "clue_update_entity":
        return cli("entity-update", "--json", json.dumps(args["entity"], ensure_ascii=False))
    if name == "clue_update_relation":
        return cli("relation-update", "--json", json.dumps(args["relation"], ensure_ascii=False))
    if name == "clue_archive_case":
        return cli("case-archive", "--json", json.dumps({"id": args["caseId"], "archiveTitle": args["archiveTitle"], "folder": args.get("folder", ""), "note": args.get("note", "")}, ensure_ascii=False))
    if name == "clue_restore_case":
        return cli("case-restore", "--id", args["caseId"])
    if name == "clue_move_case_to_trash":
        return cli("case-trash", "--id", args["caseId"])
    if name == "clue_undo_case":
        return cli("case-undo", "--id", args["caseId"])
    if name == "clue_redo_case":
        return cli("case-redo", "--id", args["caseId"])
    if name == "clue_export_case":
        command = ["export", "--id", args["caseId"]]
        if args.get("destination"): command += ["--destination", args["destination"]]
        return cli(*command)
    if name == "clue_backup_all":
        command = ["backup-all", "--destination", args["destination"]]
        if args.get("status"): command += ["--status", args["status"]]
        return cli(*command)
    if name == "clue_open_app":
        return cli("app-open", "--path", APP_PATH)
    raise ValueError(f"未知工具：{name}")


def reply(request_id: Any, result: Any) -> None:
    print(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}, ensure_ascii=False), flush=True)


def error(request_id: Any, code: int, message: str) -> None:
    print(json.dumps({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}, ensure_ascii=False), flush=True)


def main() -> None:
    for raw in sys.stdin:
        try:
            request = json.loads(raw)
            method = request.get("method")
            request_id = request.get("id")
            if method == "notifications/initialized":
                continue
            if method == "initialize":
                reply(request_id, {"protocolVersion": "2025-03-26", "capabilities": {"tools": {}}, "serverInfo": {"name": "clue-workbench-local", "version": "0.1.0"}})
            elif method == "tools/list":
                reply(request_id, {"tools": TOOLS})
            elif method == "tools/call":
                params = request.get("params", {})
                result = call_tool(params.get("name", ""), params.get("arguments", {}))
                reply(request_id, {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]})
            elif request_id is not None:
                error(request_id, -32601, f"不支持的方法：{method}")
        except Exception as exc:  # Never write diagnostics to stdout: MCP uses it as the protocol channel.
            if 'request_id' in locals() and request_id is not None:
                error(request_id, -32000, str(exc))
            else:
                print(f"MCP adapter error: {exc}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
