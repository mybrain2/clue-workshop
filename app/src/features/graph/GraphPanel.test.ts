import { describe, expect, it } from "vitest";
import type { CaseDetail, EntityRecord, RelationRecord } from "../../lib/types";
import qaFixture from "./qa-case.fixture.json";
import { COLLAPSE_THRESHOLD, contextDisplayLabel, edgeShortSummary, project } from "./GraphPanel";

const entity = (id: string, kind: EntityRecord["kind"] = "qq"): EntityRecord => ({ id, caseId: "case", kind, label: id, displayName: id, status: "", role: "", note: "", accent: "", pinned: false });
const relation = (id: string, sourceId: string, targetId: string, label = "加入群"): RelationRecord => ({ id, caseId: "case", sourceId, targetId, label, spread: "", status: "", note: "", emphasis: false });
const detail = (entities: EntityRecord[], relations: RelationRecord[]): CaseDetail => ({ case: { id: "case", title: "case", archiveFolder: "", background: "", policeDisposal: "", currentStatus: "", pathLanes: "", status: "active", sortOrder: 0, updatedAt: "", entityCount: entities.length, relationCount: relations.length }, rootId: "root", entities, relations, entityAttributes: [], relationAttributes: [], attachments: [] });
const render = (data: CaseDetail, mode: "path" | "network" = "path", expanded = false) => project(data, mode, data.rootId, 2, expanded, {}, new Set());
const overlaps = (graph: ReturnType<typeof render>) => {
  const nodes = graph.entities.map((item) => { const p = graph.positions.get(item.id)!; return { x: p.x - 82, y: p.y - 31, w: 164, h: 62 }; });
  let count = 0;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (nodes[i].x < nodes[j].x + nodes[j].w && nodes[i].x + nodes[i].w > nodes[j].x && nodes[i].y < nodes[j].y + nodes[j].h && nodes[i].y + nodes[i].h > nodes[j].y) count++;
  return count;
};

const qa = qaFixture.result as CaseDetail;

function mainDepth(data: CaseDetail) {
  const outgoing = new Map<string, string[]>();
  data.relations.forEach((edge) => outgoing.set(edge.sourceId, [...(outgoing.get(edge.sourceId) || []), edge.targetId]));
  const depth = new Map([[data.rootId, 0]]), queue = [data.rootId];
  while (queue.length) { const id = queue.shift()!; for (const next of outgoing.get(id) || []) if (!depth.has(next)) { depth.set(next, depth.get(id)! + 1); queue.push(next); } }
  return Math.max(...depth.values());
}

describe("A布局投影", () => {
  it("QA默认保持主链深度4、无重叠，并仅聚合单父叶子", () => {
    const graph = render(qa);
    expect(mainDepth(qa)).toBe(4);
    expect(overlaps(graph)).toBe(0);
    expect(graph.entities.filter((item) => item.virtual).map((item) => item.hiddenCount)).toEqual([16]);
    expect(graph.entities).toHaveLength(12);
    expect(graph.edges).toHaveLength(12);
  });

  it("path和network均keep3，并通过同一个全局状态展开", () => {
    const leaves = Array.from({ length: 8 }, (_, index) => entity(`leaf-${index}`));
    const fanout = detail([entity("root", "subject"), ...leaves], leaves.map((leaf, index) => relation(`edge-${index}`, "root", leaf.id)));
    const path = render(fanout, "path");
    const network = render(fanout, "network");
    expect(path.entities.filter((item) => !item.virtual && item.id !== "root")).toHaveLength(3);
    expect(network.entities.filter((item) => !item.virtual && item.id !== "root")).toHaveLength(3);
    const expanded = render(qa, "path", true);
    expect(expanded.entities).toHaveLength(27);
    expect(expanded.edges).toHaveLength(27);
    expect(expanded.entities.some((item) => item.virtual)).toBe(false);
    expect(overlaps(expanded)).toBe(0);
  });

  it("只折叠超过阈值的无下游单父叶子", () => {
    const leaves = Array.from({ length: COLLAPSE_THRESHOLD + 1 }, (_, index) => entity(`leaf-${index}`));
    const entities = [entity("root", "subject"), entity("branch"), entity("child"), entity("shared"), ...leaves];
    const edges = [relation("branch", "root", "branch"), relation("child", "branch", "child"), relation("shared-a", "root", "shared"), relation("shared-b", "branch", "shared"), ...leaves.map((leaf, index) => relation(`leaf-edge-${index}`, "root", leaf.id))];
    const graph = render(detail(entities, edges));
    expect(graph.entities.map((item) => item.id)).toEqual(expect.arrayContaining(["branch", "child", "shared", "leaf-0"]));
    expect(graph.entities.filter((item) => item.virtual)).toHaveLength(1);
    expect(graph.hidden).toBe(COLLAPSE_THRESHOLD - 2);
  });

  it("隐藏节点不占布局高度且全展开画布包含全部节点", () => {
    const collapsed = render(qa);
    const expanded = render(qa, "path", true);
    expect(expanded.height).toBeGreaterThan(collapsed.height);
    expect(collapsed.entities).toHaveLength(12);
    expect(collapsed.entities.every((item) => collapsed.positions.has(item.id))).toBe(true);
    for (const item of expanded.entities) {
      const point = expanded.positions.get(item.id)!;
      expect(point.x + 82).toBeLessThanOrEqual(expanded.width);
      expect(point.y + 31).toBeLessThanOrEqual(expanded.height);
    }
  });

  it("两个同层父节点分别聚合各自同类叶子并正确连边", () => {
    const parents = [entity("parent-a"), entity("parent-b")];
    const leaves = parents.flatMap((parent) => Array.from({ length: 7 }, (_, index) => entity(`${parent.id}-leaf-${index}`, "group")));
    const edges = [...parents.map((parent) => relation(`root-${parent.id}`, "root", parent.id)), ...leaves.map((leaf, index) => relation(`leaf-${index}`, leaf.id.startsWith("parent-a") ? "parent-a" : "parent-b", leaf.id))];
    const graph = render(detail([entity("root", "subject"), ...parents, ...leaves], edges));
    const proxies = graph.entities.filter((item) => item.virtual);
    expect(proxies).toHaveLength(2);
    expect(proxies.map((item) => item.displayName)).toEqual(["其余群聊 +4", "其余群聊 +4"]);
    expect(graph.edges.filter((edge) => edge.virtual).map((edge) => [edge.sourceId, edge.targetId])).toEqual([
      ["parent-a", proxies[0].id], ["parent-b", proxies[1].id],
    ]);
  });

  it("同父不同关系或不同类型不混合聚合", () => {
    const groups = [
      ...Array.from({ length: 7 }, (_, index) => ({ node: entity(`group-a-${index}`, "group"), label: "加入群" })),
      ...Array.from({ length: 7 }, (_, index) => ({ node: entity(`group-b-${index}`, "group"), label: "管理群" })),
      ...Array.from({ length: 7 }, (_, index) => ({ node: entity(`qq-${index}`, "qq"), label: "加入群" })),
    ];
    const graph = render(detail([entity("root", "subject"), ...groups.map(({ node }) => node)], groups.map(({ node, label }, index) => relation(`edge-${index}`, "root", node.id, label))));
    expect(graph.entities.filter((item) => item.virtual).map((item) => item.displayName)).toEqual(["其余群聊 +4", "其余群聊 +4", "其余QQ号 +4"]);
    expect(graph.edges.filter((edge) => edge.virtual)).toHaveLength(3);
  });

  it("不可达有向分支按局部层级连续布局并标记断连", () => {
    const entities = [entity("root", "subject"), entity("main"), entity("qq"), ...Array.from({ length: 3 }, (_, index) => entity(`group-${index}`, "group"))];
    const edges = [relation("main", "root", "main"), ...Array.from({ length: 3 }, (_, index) => relation(`group-edge-${index}`, "qq", `group-${index}`))];
    const graph = render(detail(entities, edges));
    expect(graph.positions.get("qq")?.layer).toBe(2);
    expect(graph.positions.get("group-0")?.layer).toBe(3);
    expect(graph.positions.get("qq")?.disconnected).toBe(true);
    expect(graph.positions.get("group-0")?.disconnected).toBe(true);
  });

  it("18个群保留3个并显示类型化聚合名称", () => {
    const leaves = Array.from({ length: 18 }, (_, index) => entity(`group-${index}`, "group"));
    const graph = render(detail([entity("root", "subject"), ...leaves], leaves.map((leaf, index) => relation(`edge-${index}`, "root", leaf.id))));
    expect(graph.entities.filter((item) => !item.virtual && item.kind === "group")).toHaveLength(3);
    expect(graph.entities.find((item) => item.virtual)?.displayName).toBe("其余群聊 +15");
  });


  it("边短摘要仅格式化同机关系相似度百分比", () => {
    const attributes = [{ id: "a", caseId: "case", subjectId: "same-device", fieldKey: "similarity", valueType: "number" as const, valueText: "0.87", valueNumber: 0.87, sortOrder: 0, createdAt: "", updatedAt: "" }];
    expect(edgeShortSummary(relation("same-device", "a", "b", "同机关系"), attributes)).toBe("87%");
    expect(edgeShortSummary(relation("friend", "a", "b", "好友"), [{ ...attributes[0], subjectId: "friend" }])).toBe("");
  });

  it("普通点击选择不同节点不改变path或network布局", () => {
    const data = detail(
      [entity("root", "subject"), entity("a"), entity("b"), entity("c")],
      [relation("a", "root", "a"), relation("b", "a", "b"), relation("c", "root", "c")],
    );
    for (const mode of ["path", "network"] as const) {
      const baseline = project(data, mode, "root", 2, false, {}, new Set());
      const selected = project(data, mode, "b", 2, false, {}, new Set());
      expect(selected.entities.map((item) => item.id)).toEqual(baseline.entities.map((item) => item.id));
      expect([...selected.positions]).toEqual([...baseline.positions]);
    }
  });
});

describe("location/datacenter附标签投影", () => {
  it("附标签文案同时显示对象类型和值", () => {
    expect(contextDisplayLabel(entity("东北", "location"))).toBe("活跃位置 · 东北");
    expect(contextDisplayLabel(entity("浙江", "datacenter"))).toBe("机房信息 · 浙江");
  });

  it("单附标签贴在第一条稳定入边父节点正下方并携带上下文标记", () => {
    const data = detail(
      [entity("root", "subject"), entity("other"), entity("location", "location")],
      [relation("first", "root", "location"), relation("second", "other", "location"), relation("other", "root", "other")],
    );
    const graph = render(data);
    const parent = graph.positions.get("root")!;
    const context = graph.positions.get("location")!;
    expect(context).toMatchObject({ x: parent.x, layer: parent.layer, context: true, sourceId: "root" });
    expect(context.y - parent.y).toBe(54);
    expect(graph.edges.filter((edge) => edge.targetId === "location").map((edge) => edge.id)).toEqual(["first"]);
  });

  it("同父多附标签按6px卡片间距堆叠并为下一主节点预留空间", () => {
    const data = detail(
      [entity("root", "subject"), entity("parent"), entity("next"), entity("location", "location"), entity("dc", "datacenter")],
      [relation("parent", "root", "parent"), relation("next", "root", "next"), relation("location", "parent", "location"), relation("dc", "parent", "dc")],
    );
    const graph = render(data);
    expect(graph.positions.get("dc")!.y - graph.positions.get("location")!.y).toBe(32);
    expect(graph.positions.get("next")!.y - graph.positions.get("parent")!.y).toBe(154);
  });

  it("父节点Option偏移同步到附标签且附标签不读取自身偏移", () => {
    const data = detail([entity("root", "subject"), entity("location", "location")], [relation("location", "root", "location")]);
    const graph = project(data, "path", data.rootId, 2, false, { root: 36, location: 96 }, new Set());
    expect(graph.positions.get("root")!.y).toBe(136);
    expect(graph.positions.get("location")!.y).toBe(190);
  });

  it("附标签不进入叶子聚合且只保留真实关系", () => {
    const contexts = Array.from({ length: 8 }, (_, index) => entity(`location-${index}`, "location"));
    const data = detail([entity("root", "subject"), ...contexts], contexts.map((item, index) => relation(`edge-${index}`, "root", item.id)));
    const graph = render(data);
    expect(graph.entities.filter((item) => item.kind === "location")).toHaveLength(8);
    expect(graph.entities.some((item) => item.virtual)).toBe(false);
    expect(graph.hidden).toBe(0);
    expect(graph.edges).toHaveLength(8);
  });

  it("network裁掉父节点时同步裁掉附标签", () => {
    const data = detail(
      [entity("root", "subject"), entity("middle"), entity("parent"), entity("location", "location")],
      [relation("middle", "root", "middle"), relation("parent", "middle", "parent"), relation("location", "parent", "location")],
    );
    const graph = project(data, "network", data.rootId, 1, false, {}, new Set());
    expect(graph.positions.has("parent")).toBe(false);
    expect(graph.positions.has("location")).toBe(false);
    expect(graph.entities.map((item) => item.id)).not.toContain("location");
  });

  it("附标签坐标扩展画布高度，无入边附标签仅在path底部兜底", () => {
    const contexts = Array.from({ length: 7 }, (_, index) => entity(`dc-${index}`, "datacenter"));
    const attached = contexts.slice(0, 6).map((item, index) => relation(`edge-${index}`, "root", item.id));
    const data = detail([entity("root", "subject"), ...contexts], attached);
    const path = render(data);
    const last = path.positions.get("dc-6")!;
    expect(last.context).toBe(true);
    expect(last.sourceId).toBeUndefined();
    expect(last.y + 13).toBeLessThan(path.height);
    expect(path.height).toBeGreaterThan(300);
    expect(render(data, "network").entities.map((item) => item.id)).not.toContain("dc-6");
  });
});
