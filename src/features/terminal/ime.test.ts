import { describe, expect, it } from "vitest";
import { imeCommitAction } from "./ime";

describe("IME commit de-duplication", () => {
  it("sends when nothing was forwarded recently", () => {
    expect(imeCommitAction([], "新增", 1000)).toBe("send");
  });

  it("skips the compositionend copy when the keydown path already sent it", () => {
    expect(imeCommitAction([{ text: "新增", at: 1000 }], "新增", 1050)).toBe("skip");
  });

  it("skips when the keydown path sent a longer sequence ending with the commit", () => {
    expect(imeCommitAction([{ text: "我们新增", at: 1000 }], "新增", 1030)).toBe("skip");
  });

  it("still finds the commit when other keys were sent in between", () => {
    expect(imeCommitAction([{ text: "新增", at: 1000 }, { text: "\r", at: 1001 }], "新增", 1060)).toBe("skip");
  });

  it("sends when the previous input is older than the dedup window", () => {
    expect(imeCommitAction([{ text: "新增", at: 1000 }], "新增", 1400)).toBe("send");
  });

  it("sends different text", () => {
    expect(imeCommitAction([{ text: "新增", at: 1000 }], "项目", 1010)).toBe("send");
  });

  it("sends empty composition commits through", () => {
    expect(imeCommitAction([{ text: "", at: 1000 }], "", 1000)).toBe("send");
  });
});
