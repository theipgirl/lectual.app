import { parseMarkdown } from "./parse";
import type { Block, Inline, MarkdownList } from "./types";

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.text;
        case "br":
          return "\n";
        default:
          return inlineText(n.children);
      }
    })
    .join("");
}

/**
 * Table fragments the parser did not accept as a table (a ragged separator,
 * a pipe line with no header) would otherwise show `|---|` in a preview.
 */
function stripPipeDebris(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!line.includes("|")) return line;
      let t = line.trim();
      if (t !== "" && /^[|\s:-]+$/.test(t)) return "";
      while (t.startsWith("|")) t = t.slice(1).trimStart();
      while (t.endsWith("|")) t = t.slice(0, -1).trimEnd();
      return t.split(" | ").join(" ");
    })
    .filter((line) => line !== "")
    .join("\n");
}

function listText(list: MarkdownList): string[] {
  return list.items.flatMap((item) => [inlineText(item.inlines), ...(item.children ? listText(item.children) : [])]);
}

function blockText(block: Block): string[] {
  switch (block.type) {
    case "heading":
      return [inlineText(block.inlines)];
    case "paragraph":
      return [stripPipeDebris(inlineText(block.inlines))];
    case "list":
      return listText(block);
    case "table":
      return [block.header, ...block.rows].map((row) => row.map(inlineText).join(" "));
    case "blockquote":
      return block.children.flatMap(blockText);
    case "code":
      return [block.text];
    case "hr":
      return [];
  }
}

/** Markdown with the syntax taken out: for one-line previews of a body. */
export function markdownToPlainText(text: string): string {
  return parseMarkdown(text)
    .flatMap(blockText)
    .filter((line) => line !== "")
    .join("\n")
    .trim();
}
