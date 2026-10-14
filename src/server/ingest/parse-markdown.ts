import type { Block, ParsedDocument } from "./types";

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^(```|~~~)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Strip inline markdown so lexical search and the citation viewer see plain prose. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(?<![\w*])([*_])(?!\s)(.+?)(?<!\s)\1(?![\w*])/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function tableRowToText(row: string): string {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => stripInlineMarkdown(cell))
    .filter(Boolean)
    .join(" — ");
}

/**
 * Line-oriented Markdown parser. Headings become heading blocks; paragraphs,
 * lists, tables and fenced code become paragraph blocks. List items and table
 * rows stay grouped so a chunk never separates a table header from its rows.
 */
export function parseMarkdown(source: string, fallbackTitle: string): ParsedDocument {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let mode: "prose" | "list" | "table" = "prose";

  const flush = () => {
    if (paragraph.length === 0) return;
    const text = mode === "prose" ? stripInlineMarkdown(paragraph.join(" ")) : paragraph.join("\n");
    if (text.trim()) blocks.push({ kind: "paragraph", text, page: null });
    paragraph = [];
    mode = "prose";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE.test(line.trim())) {
      flush();
      const fence = line.trim().slice(0, 3);
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence); i++) code.push(lines[i]);
      if (code.length) blocks.push({ kind: "paragraph", text: code.join("\n"), page: null });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, text: stripInlineMarkdown(heading[2]), page: null });
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    if (TABLE_ROW.test(line)) {
      if (mode !== "table") flush();
      mode = "table";
      if (!TABLE_DIVIDER.test(line)) paragraph.push(tableRowToText(line));
      continue;
    }

    if (LIST_ITEM.test(line)) {
      if (mode !== "list") flush();
      mode = "list";
      paragraph.push(`• ${stripInlineMarkdown(line.replace(LIST_ITEM, ""))}`);
      continue;
    }

    if (mode === "list" && /^\s{2,}\S/.test(line)) {
      paragraph[paragraph.length - 1] += ` ${stripInlineMarkdown(line)}`;
      continue;
    }

    if (mode !== "prose") flush();
    paragraph.push(line.trim());
  }
  flush();

  const firstH1 = blocks.find((b) => b.kind === "heading" && b.level === 1);
  return { title: firstH1?.text ?? fallbackTitle, pageCount: null, blocks };
}
