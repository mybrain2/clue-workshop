import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke }=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke}));
vi.mock("@tauri-apps/plugin-clipboard-manager",()=>({readText:vi.fn()}));

describe("addRelations structured attributes",()=>{
  beforeEach(()=>{vi.resetModules();invoke.mockReset();Object.assign(globalThis,{window:{__TAURI_INTERNALS__:{}}});});
  it("分别提交对象属性和关系属性",async()=>{
    invoke.mockResolvedValue({candidateCount:1,addedCount:1,skippedCount:0,attributeCount:2});
    const {addRelations}=await import("./desktop-api");
    const entityAttributes=[{fieldKey:"member_count",valueType:"number" as const,valueText:"120",valueNumber:120}];
    const relationAttributes=[{fieldKey:"query_role",valueType:"enum" as const,valueText:"群主"}];
    await addRelations("case","source","group",["20002"],"加入群","群聊扩散","","",undefined,"快速添加",entityAttributes,relationAttributes);
    expect(invoke).toHaveBeenCalledWith("add_relations",expect.objectContaining({entityAttributes,relationAttributes}));
  });
});
