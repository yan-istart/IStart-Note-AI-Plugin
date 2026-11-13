import { parseAnnotations } from "../annotations/AnnotationParser";
import { applyTextRanges, buildDeletionRanges } from "../annotations/AnnotationEdits";
import type { CompiledArticle, PublishingAsset } from "./types";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
export interface AssetReader { (link: string): Promise<{ path: string; data: ArrayBuffer } | null> }

/** Transform only prose; code examples must keep their literal Obsidian syntax. */
export async function compileArticle(source: string, fallbackTitle: string, readAsset: AssetReader): Promise<CompiledArticle> {
  let body = source.replace(/^\uFEFF/, "").replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
  const annotations = parseAnnotations(body).filter(a => a.source !== "footnote");
  body = applyTextRanges(body, annotations.flatMap(a => buildDeletionRanges(body, a)));
  const assets: PublishingAsset[] = [], warnings: string[] = [];
  const cache = new Map<string, PublishingAsset>();
  const code: string[] = [];
  body = body.replace(/(^[ \t]*(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*(?:`{3,}|~{3,})[^\n]*(?:\n|$))|(`+)[^\n]*?\2/gm, match => {
    if (/^\s*```(?:mermaid|dataview|dataviewjs)\b/i.test(match)) warnings.push("图表或动态代码块需要在目标平台检查；建议先转换为图片。");
    code.push(match); return `\uE000CODE${code.length - 1}\uE001`;
  });
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = (titleMatch?.[1] ?? fallbackTitle).trim();
  if (titleMatch && body.slice(0, titleMatch.index).trim() === "") body = body.slice((titleMatch.index ?? 0) + titleMatch[0].length).trimStart();
  if (/!\[[^\]]*\]\s*\[/.test(body)) throw new Error("请将引用式图片转换为 ![说明](图片路径) 后重新预览");
  const replaceImage = async (link: string, alt: string): Promise<string> => {
    const cleaned = link.trim().replace(/^<|>$/g, "");
    if (/^https?:\/\//i.test(cleaned)) return `![${alt}](${cleaned})`;
    if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(cleaned)) return `![${alt}](${cleaned})`;
    if (/^[a-z][a-z\d+.-]*:/i.test(cleaned)) throw new Error("图片使用了不支持的地址类型");
    let decoded: string;
    try { decoded = decodeURIComponent(cleaned); } catch { throw new Error(`图片地址编码无效：${cleaned}`); }
    const image = await readAsset(decoded);
    if (!image) throw new Error(`找不到图片或嵌入不是图片：${decoded}`);
    let asset = cache.get(image.path);
    if (!asset) {
      const ext = image.path.split(".").pop()?.toLowerCase() ?? "";
      const mime = MIME[ext];
      if (!mime) throw new Error(`暂不支持此附件格式：${image.path}`);
      if (image.data.byteLength > 8 * 1024 * 1024) throw new Error(`图片超过 8 MB：${image.path}`);
      asset = { source: image.path, name: `image-${assets.length + 1}.${ext}`, data: image.data, mime };
      assets.push(asset); cache.set(image.path, asset);
    }
    if (assets.reduce((sum, a) => sum + a.data.byteLength, 0) > 16 * 1024 * 1024) throw new Error("本篇本地图片合计超过 16 MB，请压缩后发送");
    return `![${alt.replace(/[[\]\r\n]/g, "")}](${`assets/${asset.name}`})`;
  };
  const images = /!\[\[([^\]]+)\]\]|!\[([^\]]*)\]\(\s*(<[^>]+>|[^\s)]+(?:\([^)]*\)[^\s)]*)*)(?:\s+"[^"\n]*")?\s*\)/g;
  let match: RegExpExecArray | null, next = "", offset = 0;
  while ((match = images.exec(body))) {
    next += body.slice(offset, match.index);
    const [link, alias] = (match[1] ?? "").split("|");
    next += await replaceImage(match[1] ? link : match[3], match[1] ? (/^\d+(?:x\d+)?$/.test(alias ?? "") ? "图片" : alias ?? "图片") : match[2]);
    offset = images.lastIndex;
  }
  body = (next + body.slice(offset)).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all: string, link: string, alias?: string) => alias ?? link.split("#")[0].split("/").pop() ?? link);
  if (/<(?:img|iframe|script|video|audio)\b/i.test(body)) throw new Error("正文含 HTML 图片、脚本或媒体嵌入，请改用 Markdown 图片并移除动态内容");
  if (/!\[\[|!\[[^\]]*\]\(/.test(body.replace(/!\[[^\]]*\]\((?:assets\/[^)]+|https?:\/\/[^)]+|data:[^)]+)\)/g, ""))) throw new Error("存在无法识别的图片或笔记嵌入，请调整后重新预览");
  body = body.replace(/\uE000CODE(\d+)\uE001/g, (_all: string, i: string) => code[Number(i)]).trim();
  if (!title || !body) throw new Error("标题或正文为空");
  if (body.length > 250000) throw new Error("正文过长，请拆分后发送");
  return { title, markdown: body, assets, warnings: [...new Set(warnings)] };
}
