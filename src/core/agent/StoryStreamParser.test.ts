import { describe, expect, it } from "vitest";
import { StoryStreamParser } from "./StoryStreamParser";
import type { ParsedStoryBlock } from "./StoryStreamParser";

const line = (text: string, kind = "dialogue", visibility = "public") => JSON.stringify({ kind, visibility, text });
describe("typed story stream", () => {
  it("streams compact typed tuples at every boundary and preserves punctuation inside the text", () => {
    const text = '“我说的是 [今天]，不是「明天」。\\请记住。”\n\n“今天，今天。”😀';
    const raw = JSON.stringify(["dialogue", "public", text]) + '\n' + JSON.stringify(["narration", "private", "他仍有顾虑。"]);
    for (let split = 1; split < raw.length; split++) {
      const blocks: ParsedStoryBlock[] = []; const parser = new StoryStreamParser((index, block) => { blocks[index] = block; });
      parser.feed(raw.slice(0, split)); parser.feed(raw.slice(split)); parser.finish();
      expect(blocks.map(b => b.text)).toEqual([text, "他仍有顾虑。"]); expect(blocks[1].visibility).toBe("private");
    }
  });
  it("decodes every split boundary, nested quotes, escaped newlines and Unicode without changing text", () => {
    const text = '“你说的是\\今天，还是「明天」？”\n\n“今天。今天。”😀';
    const raw = line(text) + '\n' + line("他停了一下。", "narration");
    for (let split = 1; split < raw.length; split++) {
      const blocks: ParsedStoryBlock[] = [];
      const parser = new StoryStreamParser((index, block) => { blocks[index] = block; });
      parser.feed(raw.slice(0, split)); parser.feed(raw.slice(split)); parser.finish();
      expect(blocks.map(b => b.text)).toEqual([text, "他停了一下。"]); expect(blocks.every(b => b.complete)).toBe(true);
    }
  });
  it("publishes the text prefix while the JSON string is still arriving and withholds partial escapes", () => {
    const blocks: ParsedStoryBlock[] = []; const parser = new StoryStreamParser((index, block) => { blocks[index] = block; });
    parser.feed('{"kind":"dialogue","visibility":"public","text":"原话\\u4');
    expect(blocks[0]).toMatchObject({ text: "原话", complete: false });
    parser.feed('f60\\ud83d\\ude00"}'); parser.finish();
    expect(blocks[0]).toMatchObject({ text: "原话你😀", complete: true });
  });
  it("rejects truncation, impersonation fields and protocol corruption without deleting a published prefix", () => {
    for (const raw of ['{"kind":"dialogue","visibility":"private","text":"秘密"}', '{"kind":"dialogue","visibility":"public","text":"一","text":"二"}', '{"kind":"other","visibility":"public","text":"不支持"}', '{"kind":"dialogue","visibility":"public","text":"台词","speaker":"其他角色"}']) {
      expect(() => { const parser = new StoryStreamParser(() => {}); parser.feed(raw); parser.finish(); }).toThrow();
    }
    const updates: ParsedStoryBlock[] = []; const parser = new StoryStreamParser((_index, block) => updates.push(block));
    parser.feed('{"kind":"dialogue","visibility":"public","text":"没有说完'); expect(() => parser.finish()).toThrow();
    expect(updates[0].text).toBe("没有说完");
  });
});
