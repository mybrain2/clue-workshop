import { normalizeTable } from "./smart-table";

export type TabularFileResult = { rows: string[][]; sheetName: string; sourceLabel: string; dataRows: number; columns: number };

function nonEmptyRows(rows: unknown[][]) {
  return rows.map((row) => row.map((value) => String(value ?? ""))).filter((row) => row.some((value) => value.trim()));
}

export async function readTabularFile(file: File): Promise<TabularFileResult> {
  if (file.size > 10 * 1024 * 1024) throw new Error("文件超过 10 MB 上限，请拆分后再导入");
  const lower = file.name.toLowerCase();
  let rows: string[][] = [], sheetName = "文本表格";
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    const bytes = await file.arrayBuffer();
    let text = "", encoding = "UTF-8";
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
    catch {
      try { text = new TextDecoder("gb18030", { fatal: true }).decode(bytes); encoding = "GB18030"; }
      catch { throw new Error("CSV/TSV 编码无法识别，请另存为 UTF-8 CSV 后重试"); }
    }
    rows = nonEmptyRows(normalizeTable(text).rows);
    sheetName = `${lower.endsWith(".tsv") ? "TSV" : "CSV"} · ${encoding}`;
  } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    sheetName = workbook.SheetNames[0] || "";
    if (!sheetName || !workbook.Sheets[sheetName]) throw new Error("文件不含可读取的工作表");
    rows = nonEmptyRows(XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "", blankrows: false }));
  } else throw new Error("仅支持 XLSX、XLS、CSV 或 TSV 文件");
  if (!rows.length) throw new Error("文件没有可导入的数据");
  const columns = Math.max(...rows.map((row) => row.length));
  if (columns < 2) throw new Error("文件只有一列，无法识别关联表格");
  return { rows, sheetName, sourceLabel: `${file.name} · ${sheetName} · ${Math.max(0, rows.length - 1)} 行 × ${columns} 列`, dataRows: Math.max(0, rows.length - 1), columns };
}
