# 线索研判桌面工作台

macOS 本地优先的案件关系图工作台。前端为 React/TypeScript，桌面壳为 Tauri v2，数据核心为 Rust + SQLite；CLI 与 MCP 使用同一业务核心和同一数据库。

## 当前能力

- 案件创建、搜索、排序、归档文件夹、回收站与恢复。
- 手工录入账号、手机号、IP、设备、群聊、位置、机房、平台账号、组织等关系；支持批量粘贴和 Excel/CSV 文件导入。
- 调查路径、局部一/两跳关系网、全量关系表、节点/关系状态与重点、聚合分支。
- 快照式撤销/重做、案件包导入导出、Markdown/SVG/CSV 材料。
- 本地 CLI / stdio MCP 自动化；外部写入通过 revision polling 刷新桌面端。
- 选中反馈：点击节点高亮一跳关联，点击关系高亮线与两端并双击编辑；Option（⌥）+ 拖动仅做节点纵向微调。
- 界面级错误边界：渲染异常显示可重载恢复页，不修改数据，不白屏。

产品、边界、架构与接手说明请先读：`../项目真相/00-AI接手总览.md` 与 `../项目真相/48-增量交接补充说明.md`。

给新电脑主体的最小交付见：`新电脑安装与AI部署说明.md`；使用者海报见 `线索研判_简要操作手册.png` / `.svg`。

## 目录

```text
app/
├── src/
│   ├── App.tsx                  # 工作台编排
│   ├── features/cases/          # 案件库、创建、归档与概览
│   ├── features/graph/          # 图谱、布局、快速录入
│   ├── features/import/         # 文本、表格、截图候选导入
│   ├── features/export/         # 导出、案件包导入
│   ├── lib/types.ts             # 跨端类型
│   └── lib/desktop-api.ts       # Tauri command 桥
├── src-tauri/
│   ├── src/case_core.rs         # SQLite、快照、导入导出、领域操作
│   ├── src/main.rs              # Tauri command 与桌面运行时
│   └── src/bin/                 # CLI
├── integrations/mcp/            # stdio MCP
└── scripts_validate_*.py        # 回归脚本
```

## 用户数据目录

```text
~/Library/Application Support/线索研判数据/
├── casework.sqlite3
├── attachments/
├── exports/
├── backups/
├── snapshots/
└── logs/desktop-runtime.log
```

重装应用不会主动清理该目录。不要直接修改 SQLite；通过桌面端、CLI 或 MCP 写入，确保快照、撤销和 revision 同步正常。

## 开发与验证

使用受管 Node：

```bash
cd app
PATH="/Users/chrishong/.workbuddy/binaries/node/versions/22.12.0/bin:$PATH" \
  /Users/chrishong/.workbuddy/binaries/node/versions/22.12.0/bin/npm run build
cargo check --manifest-path src-tauri/Cargo.toml --bin clue-workbench --bin clue-workbench-cli

/Users/chrishong/.workbuddy/binaries/python/versions/3.13.12/bin/python3 scripts_validate_regression_case.py
/Users/chrishong/.workbuddy/binaries/python/versions/3.13.12/bin/python3 scripts_validate_cli_mcp.py
```

构建 macOS App：

```bash
PATH="/Users/chrishong/.workbuddy/binaries/node/versions/22.12.0/bin:$PATH" \
  /Users/chrishong/.workbuddy/binaries/node/workspace/node_modules/.bin/tauri build --bundles app
```

发布、签名、DMG 与 UI 实测流程见 `../项目真相/42-AI协作与工程验收.md`。
