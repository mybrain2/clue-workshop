import type { ExportResult } from "../../lib/types";

export function ExportPanel({ onExport, onImport, result, disabled = false }: { onExport(): void; onImport(): void; result?: ExportResult | null; disabled?: boolean }) {
  return <section className="export-panel">
    <span className="eyebrow">生成案件材料</span>
    <h2>导出当前案件</h2>
    <p>一次导出默认三件套：完整 `.cluecase` 可还原包、可编辑原生 `.xmind`，以及可直接复制给 AI 或人工阅读的自包含 Markdown。三者均基于已录入信息生成。</p>
    <button className="primary export-primary" disabled={disabled} onClick={onExport}>导出案件材料（三件套）</button>
    <button className="open-package" onClick={onImport}>导入案件包</button>
    {result && <div className="export-result"><strong>案件材料三件套已生成。</strong><small>导出目录：{result.directory}</small><small>.cluecase：{result.packagePath}</small><small>.xmind（实际文件）：{result.xmindPath}</small><small>XMind 文件大小：{result.xmindSizeBytes.toLocaleString()} bytes；生成时间：{result.xmindGeneratedAt}</small><small>案情说明：{result.markdownPath}</small></div>}
    <div className="export-list"><span>.cluecase（可导入还原，含附件及 SHA-256 清单）</span><span>.xmind（可编辑案件树，保留交叉关联）</span><span>_案情说明.md（完整事实、关系、附件与数据语义）</span></div>
  </section>;
}
