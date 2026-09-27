# 本地自动化接口

桌面应用、CLI 与 MCP 共用同一份本地 SQLite 案件库：

```text
自然语言指令 → MCP（stdio）→ CLI → 受控案件命令 → SQLite → 桌面应用刷新
```

接口不提供任意 SQL、任意文件读写或永久删除能力。

## CLI

构建后的命令：

```text
release/macOS/automation-0.7.12/clue-workbench-cli
```

常用命令：

```bash
# 检查本地数据目录与数据库
clue-workbench-cli health

# 列出进行中案件
clue-workbench-cli case-list --status active

# 读取案件图
clue-workbench-cli case-get --id <case-id>

# 创建案件
clue-workbench-cli case-create --json '{"title":"案件名","background":"背景","seedKind":"wechat","seedValue":"wxid_xxx"}'

# 批量加入关联对象；displayNames 可选且与 values 逐行对应
clue-workbench-cli relation-add --json '{"caseId":"...","sourceId":"...","targetKind":"phone","values":["13800138000","13900139000"],"displayNames":["工作手机号","备用手机号"],"label":"关联手机号","spread":"跨平台映射","note":""}'

# 更新案情简介、警方处置、当前现状和路径分栏
clue-workbench-cli case-overview-update --json '{"id":"...","background":"案情简介","policeDisposal":"警方处置","currentStatus":"当前现状","pathLanes":["种子","账号","环境","群组"]}'

# 撤销 / 重做最近一次对象或关系改动
clue-workbench-cli case-undo --id <case-id>
clue-workbench-cli case-redo --id <case-id>

# 选择目录导出可交换案件包、概括、SVG脑图和CSV
clue-workbench-cli export --id <case-id> --destination <directory>

# 将案件包.json导入为新案件，不覆盖本地已有案件
clue-workbench-cli case-import --path <案件包.json>
```

所有命令都返回 JSON。写入操作会更新案件修改时间与本地变更版本；已打开的桌面程序每两秒检测一次该版本并刷新当前案件。

## MCP

配置文件：

```text
release/macOS/automation-0.7.12/clue-workbench.mcp.json
```

将其中 `clue-workbench` 条目加入支持 stdio MCP 的客户端配置后，可使用：

- 案件列表与图读取；
- 创建案件；
- 关联对象批量录入；
- 节点 / 关系标记；
- 归档、恢复、移入回收站；
- 导出案件；
- 拉起桌面程序。

## 写入与删除边界

- 新建、添加关系、更新标记、导出、归档、恢复、移入回收站：接口可执行。
- 永久删除：**不通过 MCP 或 CLI 暴露**，只能在桌面端回收站中手动输入案件名确认。
- CLI/MCP 仅访问 `~/Library/Application Support/线索研判数据/` 下的案件库，不读取或上传其他个人文件。
