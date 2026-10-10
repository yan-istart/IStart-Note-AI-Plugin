import type { InsertRequest } from "../features/writing/types";
import type { InsertionContext } from "../editor/InsertionContext";

export function buildInsertionPrompt(request: InsertRequest, context: InsertionContext) {
  return {
    systemPrompt: `你是插写助手，在已有正文的上文与下文之间补充缺失的连接内容。
规则：
1. 同时参考上文末尾和下文开头，让新内容承接上文，并自然衔接到给定下文。
2. 保持原文的语言、人称、时态、文风和格式，前后事实、人物状态与时间关系一致。
3. 不改写、不复述两侧原文，不重复下文将要展开的内容，不继续写到下文之后。
4. 只输出需要插入的正文，不输出标题、解释、上文、下文或插入标记。
5. 约 ${request.targetWords} 字，以完成当前连接为目标，不额外展开无关内容。`,
    userPrompt: `【上文（插入位置之前）】\n${context.before}\n\n【下文（插入位置之后）】\n${context.after}\n\n【插写要求】\n${request.instruction || "补充一段承上启下的内容，让前后文自然衔接"}\n\n请只输出两者之间缺失的正文：`,
  };
}
