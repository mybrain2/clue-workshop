import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { completeQuickAdd, QuickAddDialog } from "./QuickAddDialog";

const render = (initialKind: "group" | "qq") => renderToStaticMarkup(<QuickAddDialog open initialKind={initialKind} sourceLabel="当前QQ" onClose={()=>{}} onOpenSmartImport={()=>{}} onAdd={async()=>{}} />);

describe("QuickAddDialog structured fields",()=>{
  it("群聊手动录入提供对象信息字段",()=>{
    const html=render("group");
    expect(html).toContain("群名称");expect(html).toContain("群人数");expect(html).toContain("群备注");expect(html).toContain("简介");expect(html).toContain("对象信息");expect(html).toContain("关系信息");expect(html).toContain("更多模板字段");
  });
  it("QQ默认关系保留关系字段目录能力",()=>{
    const html=render("qq");
    expect(html).toContain("昵称");expect(html).toContain("注册地");expect(html).toContain("对象信息");
  });
  it("保存失败时显示错误且不关闭弹窗",async()=>{
    let closed=false,error="";
    await completeQuickAdd(async()=>{throw new Error("写入失败");},{kind:"qq",values:["123"],label:"好友",spread:"人工关联",note:"",customType:"",entityAttributes:[],relationAttributes:[]},()=>{closed=true;},message=>{error=message;});
    expect(closed).toBe(false);expect(error).toContain("保存失败");expect(error).toContain("写入失败");
  });
  it("保存成功后关闭弹窗",async()=>{
    let closed=false,error="";
    await completeQuickAdd(async()=>{}, {kind:"qq",values:["123"],label:"好友",spread:"人工关联",note:"",customType:"",entityAttributes:[],relationAttributes:[]},()=>{closed=true;},message=>{error=message;});
    expect(closed).toBe(true);expect(error).toBe("");
  });
});
