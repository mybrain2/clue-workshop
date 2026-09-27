# macOS 启动故障排查与修复

## 结论

最初交付的 `.app` 是手工拼装的壳：二进制、图标和 `Info.plist` 存在，但没有通过 Tauri 的正式 bundle 过程写入完整前端资源与 macOS 应用元数据，因此 Finder 双击无法正常启动。

已改为 **Tauri 官方 bundle 流程**生成正式 macOS 应用包，并完成实际启动验证。

## 根因

1. **手工封装不完整**
   - 手工复制 Rust 二进制进 `.app`，缺少 Tauri bundle 产生的完整 Resources、前端嵌入资源与应用元数据。
   - 手工 ad-hoc 签名虽然能通过部分签名检查，但不是可运行性证明。

2. **Tauri 依赖版本错位**
   - 初版 JavaScript 的 `@tauri-apps/*` 与 Rust `tauri` / plugin 版本不一致；Tauri CLI 直接阻止正式 bundle。
   - 之后尝试固定旧版 Rust 运行时又触发运行时 crate 兼容问题。
   - 已统一为匹配的当前 Tauri 2.11 Rust 运行时与 npm 2.11 API / 当前插件版本，正式 bundle 能完成应用构建。

## 修复内容

- 使用 Tauri 正式 `build --bundles app,dmg` 流程生成 macOS `.app`；DMG 内建脚本仍失败，但不会影响 `.app` 本身的完整构建与启动。
- 对正式 Tauri `.app` 进行 ad-hoc 签名并验证。
- 采用正式 bundle 内的 `.app` 重新生成可用 DMG。
- 数据目录明确固定为：

```text
~/Library/Application Support/线索研判数据/
├─ casework.sqlite3
├─ attachments/
├─ backups/
├─ exports/
├─ logs/
└─ snapshots/
```

此目录与应用安装包、源码、构建目录完全分离；升级或重装不会清理案件。

## 实测证据

1. 正式应用在本机通过 `open -n` 成功启动。
2. 启动后自动创建独立数据目录及 `casework.sqlite3`。
3. 当前运行实例：

```text
.../app/release/macOS/线索研判-0.1.0.app/Contents/MacOS/clue-workbench
```

4. 旧的手工封装包已移动到：

```text
app/release/archive/
```

不再作为可用交付物。

## 当前正式交付物

```text
app/release/macOS/
├─ 线索研判-0.1.0.app
└─ 线索研判-0.1.0-working.dmg
```

## 已知发布限制

- 当前包使用 ad-hoc 签名，只在本机实测通过；没有 Apple Developer ID 签名和 notarization。
- 因此分发给另一台未信任机器时，macOS 可能提示开发者未验证；正式对外发版前必须补 Apple Developer ID 签名与公证。
- Tauri 自动 DMG bundle 脚本在当前环境失败；已用完整、已验证的正式 `.app` 手工生成 DMG，不影响当前 macOS 使用。后续 CI 发布时再单独修复 DMG 脚本。
