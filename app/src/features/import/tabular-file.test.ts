import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readTabularFile } from "./tabular-file";

const file = (parts: BlobPart[], name: string) => new File(parts, name);

describe("readTabularFile", () => {
  it("按UTF-8 BOM读取带引号和逗号的CSV", async () => {
    const parsed = await readTabularFile(file([new Uint8Array([0xef,0xbb,0xbf]), '查询账号,QQ账号,昵称\n10001,20002,"昵称,甲"\n'], "好友.csv"));
    expect(parsed.rows).toEqual([["查询账号","QQ账号","昵称"],["10001","20002","昵称,甲"]]);
    expect(parsed.sourceLabel).toContain("1 行 × 3 列");
  });
  it("读取TSV并保留二维结构", async () => {
    const parsed = await readTabularFile(file(["UIN\t关系\n10001\t原号码\n"], "同机.tsv"));
    expect(parsed.rows).toEqual([["UIN","关系"],["10001","原号码"]]);
  });
  it("读取XLSX首个工作表", async () => {
    const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([["QQ账号(解密)","命中查询内容"],["10001","13800138000"]]),"数据");
    const bytes=XLSX.write(workbook,{bookType:"xlsx",type:"array"}) as ArrayBuffer;
    const parsed=await readTabularFile(file([bytes],"绑定.xlsx"));
    expect(parsed.sheetName).toBe("数据");expect(parsed.rows).toHaveLength(2);expect(parsed.columns).toBe(2);
  });
  it("支持GB18030并拒绝单列文件", async () => {
    const gb=new Uint8Array([0xc4,0xe3,0xba,0xc3,0x2c,0x31,0x0a,0xca,0xc0,0xbd,0xe7,0x2c,0x32,0x0a]);
    const parsed=await readTabularFile(file([gb],"gb.csv"));expect(parsed.rows).toEqual([["你好","1"],["世界","2"]]);expect(parsed.sheetName).toContain("GB18030");
    await expect(readTabularFile(file(["只有一列\n下一行\n"],"bad.csv"))).rejects.toThrow("只有一列");
  });
});
