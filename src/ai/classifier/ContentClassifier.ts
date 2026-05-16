import { ContentType } from "../templates/types";

/**
 * 内容类型分类器
 * 根据用户输入、文件路径、文件类型等信息，判断应使用哪个模板。
 */
export class ContentClassifier {
  /**
   * 分类：返回最匹配的内容类型
   */
  classify(input: {
    instruction: string;
    fileName: string;
    filePath: string;
    fileType?: string;
    selection?: string;
  }): ContentType {
    const { instruction, fileName, filePath, fileType, selection } = input;
    const text = `${instruction} ${fileName} ${selection ?? ""}`.toLowerCase();

    // 1. 基于 frontmatter type 直接判断
    if (fileType === "reading-note" || fileType === "reading-project") return ContentType.READING_NOTE;
    if (fileType === "concept") return ContentType.CONCEPT;
    if (fileType === "question") return ContentType.QA;

    // 2. 基于文件路径
    if (filePath.includes("Reading/")) return ContentType.READING_NOTE;
    if (filePath.includes("Concepts/")) return ContentType.CONCEPT;
    if (filePath.includes("Q&A/")) return ContentType.QA;

    // 3. 基于指令关键词
    if (this.matchKeywords(text, ["架构", "系统设计", "方案设计", "技术选型", "微服务", "分布式"])) {
      return ContentType.ARCHITECTURE;
    }
    if (this.matchKeywords(text, ["产品", "需求", "用户故事", "PRD", "功能设计", "交互"])) {
      return ContentType.PRODUCT_DESIGN;
    }
    if (this.matchKeywords(text, ["会议", "讨论", "决策", "行动项", "周会", "复盘"])) {
      return ContentType.MEETING_NOTE;
    }
    if (this.matchKeywords(text, ["计划", "排期", "里程碑", "任务", "sprint", "迭代"])) {
      return ContentType.TASK_PLAN;
    }
    if (this.matchKeywords(text, ["世界观", "设定", "种族", "魔法", "规则", "历史线"])) {
      return ContentType.WORLD_BUILDING;
    }
    if (this.matchKeywords(text, ["总结", "阅读", "读书", "章节", "笔记"])) {
      return ContentType.READING_NOTE;
    }
    if (this.matchKeywords(text, ["概念", "定义", "解释", "是什么"])) {
      return ContentType.CONCEPT;
    }
    if (this.matchKeywords(text, ["代码", "实现", "API", "SDK", "配置", "部署", "debug", "bug"])) {
      return ContentType.TECH_DOC;
    }

    // 4. 默认：如果有问号，当作 QA
    if (instruction.includes("?") || instruction.includes("？")) {
      return ContentType.QA;
    }

    return ContentType.UNKNOWN;
  }

  private matchKeywords(text: string, keywords: string[]): boolean {
    return keywords.some((kw) => text.includes(kw.toLowerCase()));
  }
}
