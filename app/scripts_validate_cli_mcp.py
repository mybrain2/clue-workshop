import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CLI = ROOT / "src-tauri" / "target" / "release" / "clue-workbench-cli"
MCP = ROOT / "integrations" / "mcp" / "clue_workbench_mcp.py"
PYTHON = "/Users/chrishong/.workbuddy/binaries/python/versions/3.13.12/bin/python3"


def run_cli(*args):
    completed = subprocess.run([str(CLI), *args], capture_output=True, text=True, check=False, timeout=30)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    payload = json.loads(completed.stdout)
    assert payload["ok"], payload
    return payload["result"]


def mcp_request(process, payload):
    process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
    process.stdin.flush()
    response = process.stdout.readline()
    assert response, "MCP server did not respond"
    result = json.loads(response)
    assert "error" not in result, result
    return result["result"]


def main():
    assert CLI.exists(), CLI
    before = run_cli("revision")["revision"]

    created = run_cli(
        "case-create", "--json", json.dumps({
            "title": "CLI-MCP 脱敏闭环验证",
            "background": "验证文本命令到桌面数据库的受控写入。",
            "seedKind": "wechat",
            "seedValue": "wxid_cli_mcp_seed",
        }, ensure_ascii=False),
    )
    case_id = created["id"]
    case = run_cli("case-get", "--id", case_id)
    root_id = case["rootId"]
    revision_after_create = run_cli("revision")["revision"]
    assert revision_after_create != before

    added = run_cli(
        "relation-add", "--json", json.dumps({
            "caseId": case_id,
            "sourceId": root_id,
            "targetKind": "phone",
            "values": ["13900001111", "13900001111", "13700002222"],
            "label": "关联手机号",
            "spread": "跨平台映射",
            "note": "CLI 回归写入",
            "customType": "",
        }, ensure_ascii=False),
    )
    assert added["added"]["addedCount"] == 2, added
    case = run_cli("case-get", "--id", case_id)
    phones = [entity for entity in case["entities"] if entity["kind"] == "phone"]
    assert len(phones) == 2, phones

    first_phone = phones[0]
    first_phone["status"] = "待核实"
    first_phone["role"] = "小号"
    first_phone["note"] = "CLI 标注回归"
    first_phone["accent"] = "#d8583e"
    first_phone["pinned"] = True
    run_cli("entity-update", "--json", json.dumps(first_phone, ensure_ascii=False))
    updated = run_cli("case-get", "--id", case_id)
    marked = next(entity for entity in updated["entities"] if entity["id"] == first_phone["id"])
    assert marked["status"] == "待核实" and marked["pinned"] is True, marked

    exported = run_cli("export", "--id", case_id)
    for path in (exported["markdownPath"], exported["xmindPath"], exported["packagePath"]):
        assert Path(path).is_file(), path

    env = os.environ | {"CLUE_WORKBENCH_CLI": str(CLI)}
    process = subprocess.Popen([PYTHON, str(MCP)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    try:
        initialized = mcp_request(process, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
        assert initialized["serverInfo"]["name"] == "clue-workbench-local", initialized
        tools = mcp_request(process, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        names = {tool["name"] for tool in tools["tools"]}
        assert {"clue_add_relationships", "clue_undo_case", "clue_redo_case", "clue_export_case", "clue_open_app"}.issubset(names), names
        result = mcp_request(process, {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "clue_add_relationships", "arguments": {
            "caseId": case_id,
            "sourceId": first_phone["id"],
            "targetKind": "qq",
            "values": ["QQ 900001", "QQ 900002"],
            "label": "手机号关联QQ号",
            "spread": "跨平台映射",
            "note": "MCP 回归写入",
            "customType": "",
        }}})
        tool_result = json.loads(result["content"][0]["text"])
        assert tool_result["added"]["addedCount"] == 2, tool_result
    finally:
        process.terminate()
        process.wait(timeout=5)

    final_detail = run_cli("case-get", "--id", case_id)
    assert len(final_detail["entities"]) == 6, final_detail["entities"]
    assert len(final_detail["relations"]) == 5, final_detail["relations"]
    run_cli("case-undo", "--id", case_id)
    undone = run_cli("case-get", "--id", case_id)
    assert len(undone["entities"]) == 4 and len(undone["relations"]) == 3, undone
    run_cli("case-redo", "--id", case_id)
    redone = run_cli("case-get", "--id", case_id)
    assert len(redone["entities"]) == 6 and len(redone["relations"]) == 5, redone
    run_cli("case-trash", "--id", case_id)
    trashed = run_cli("case-get", "--id", case_id)
    assert trashed["case"]["status"] == "trash", trashed["case"]
    print(json.dumps({"result": "pass", "caseId": case_id, "entities": len(final_detail["entities"]), "relations": len(final_detail["relations"]), "export": exported["directory"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
