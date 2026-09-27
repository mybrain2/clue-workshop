import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AttachmentPanel.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

describe("AttachmentPanel 静态接入", () => {
  it("提供折叠面板、受控打开和删除确认入口", () => {
    expect(source).toContain('<details className="attachment-panel">');
    expect(source).toContain("打开附件");
    expect(source).toContain("window.confirm");
    expect(source).toContain("onOpen(attachment)");
  });

  it("按附件管理受控说明并通过按钮显式保存", () => {
    expect(source).toContain("noteDrafts[attachment.id] ?? attachment.note");
    expect(source).toContain("[attachment.id]: event.target.value");
    expect(source).toContain("保存说明");
    expect(source).toContain("disabled={savingNoteIds[attachment.id]}");
    expect(source).toContain("await onNote(attachment, nextNote)");
    expect(source).not.toContain("defaultValue={attachment.note}");
    expect(source).not.toContain("onBlur=");
  });

  it("App 接入附件增改删、打开和刷新", () => {
    expect(appSource).toContain("<AttachmentPanel");
    expect(appSource).toContain("await addAttachment(");
    expect(appSource).toContain("await updateAttachmentNote(");
    expect(appSource).toContain("await deleteAttachment(");
    expect(appSource).toContain("await openAttachment(");
    expect(appSource).toContain("await refresh(attachment.caseId)");
  });
});
