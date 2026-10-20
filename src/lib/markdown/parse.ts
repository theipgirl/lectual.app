import { parseInline } from "./inline";
import type { Block, Inline, ListItem, MarkdownList, TableAlign } from "./types";

/**
 * Block Markdown: headings, paragraphs, lists (one nested level), pipe tables,
 * blockquotes, fenced code and rules. Line-based and non-backtracking, so
 * hostile input costs a pass over the text, not more.
 */

const MAX_QUOTE_DEPTH = 3;
const MAX_TABLE_CELLS = 64;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

function expandLeadingTabs(line: string): string {
  let k = 0;
  while (k < line.length && (line[k] === "\t" || line[k] === " ")) k++;
  const lead = line.slice(0, k);
  return lead.includes("\t") ? lead.replace(/\t/g, "    ") + line.slice(k) : line;
}

const isBlank = (line: string) => line.trim() === "";
const indentOf = (line: string) => line.length - line.trimStart().length;

function fenceOf(line: string): { char: string; len: number } | null {
  const t = line.trimStart();
  if (line.length - t.length > 3) return null;
  const char = t[0];
  if (char !== "`" && char !== "~") return null;
  let len = 0;
  while (t[len] === char) len++;
  if (len < 3) return null;
  // A backtick fence's info string may not contain a backtick (that is inline code).
  if (char === "`" && t.slice(len).includes("`")) return null;
  return { char, len };
}

function isFenceClose(line: string, fence: { char: string; len: number }): boolean {
  const t = line.trim();
  if (t.length < fence.len) return false;
  for (let k = 0; k < t.length; k++) if (t[k] !== fence.char) return false;
  return true;
}

function headingOf(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  const t = line.trimStart();
  if (line.length - t.length > 3 || t[0] !== "#") return null;
  let level = 0;
  while (t[level] === "#") level++;
  if (level > 6) return null;
  const rest = t.slice(level);
  if (rest !== "" && rest[0] !== " " && rest[0] !== "\t") return null;
  let text = rest.trim();
  // Optional closing sequence: "## Title ##".
  let e = text.length;
  while (e > 0 && text[e - 1] === "#") e--;
  if (e < text.length && e > 0 && (text[e - 1] === " " || text[e - 1] === "\t")) text = text.slice(0, e).trimEnd();
  return { level: level as 1 | 2 | 3 | 4 | 5 | 6, text };
}

function isRule(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || indentOf(line) > 3) return false;
  const c = t[0];
  if (c !== "-" && c !== "*" && c !== "_") return false;
  let count = 0;
  for (const ch of t) {
    if (ch === c) count++;
    else if (ch !== " " && ch !== "\t") return false;
  }
  return count >= 3;
}

const isQuote = (line: string) => indentOf(line) <= 3 && line.trimStart().startsWith(">");

/** Splits one table row on unescaped pipes, dropping the empty edge cells a leading/trailing pipe makes. */
function splitRow(line: string): string[] {
  const t = line.trim();
  const cells: string[] = [];
  let cur = "";
  for (let k = 0; k < t.length; k++) {
    const ch = t[k];
    if (ch === "\\" && t[k + 1] === "|") {
      cur += "\\|";
      k++;
    } else if (ch === "|") {
      cells.push(cur);
      cur = "";
      if (cells.length > MAX_TABLE_CELLS) break;
    } else cur += ch;
  }
  cells.push(cur);
  if (t.startsWith("|")) cells.shift();
  if (t.endsWith("|") && !t.endsWith("\\|") && cells.length > 0) cells.pop();
  return cells.slice(0, MAX_TABLE_CELLS).map((c) => c.trim());
}

function separatorAligns(line: string): TableAlign[] | null {
  if (!line.includes("-")) return null;
  const cells = splitRow(line);
  if (cells.length === 0) return null;
  const aligns: TableAlign[] = [];
  for (const cell of cells) {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    const dashes = cell.slice(left ? 1 : 0, right && cell.length > 1 ? -1 : undefined);
    if (dashes === "" || dashes.length === 0) return null;
    for (const ch of dashes) if (ch !== "-") return null;
    aligns.push(left && right ? "center" : right ? "right" : left ? "left" : null);
  }
  return aligns;
}

/** Whether a table starts at `lines[i]`: a header row of N cells, then an N-cell separator. */
function tableStart(lines: string[], i: number): TableAlign[] | null {
  const line = lines[i];
  if (!line.includes("|") || i + 1 >= lines.length) return null;
  const aligns = separatorAligns(lines[i + 1]);
  if (!aligns) return null;
  return splitRow(line).length === aligns.length ? aligns : null;
}

function listItemOf(line: string) {
  const m = LIST_ITEM.exec(line);
  return m ? { indent: m[1].length, marker: m[2], text: m[3], ordered: /^\d/.test(m[2]) } : null;
}

/** Whether `lines[i]` may interrupt a paragraph. */
function interruptsParagraph(lines: string[], i: number): boolean {
  const line = lines[i];
  if (fenceOf(line) || headingOf(line) || isRule(line) || isQuote(line)) return true;
  const item = listItemOf(line);
  if (item && (!item.ordered || /^1[.)]/.test(item.marker))) return true;
  return tableStart(lines, i) !== null;
}

type DraftItem = { lines: string[]; children: DraftList | null };
type DraftList = { ordered: boolean; start: number; items: DraftItem[] };

function finishList(list: DraftList): MarkdownList {
  return {
    type: "list",
    ordered: list.ordered,
    start: list.start,
    items: list.items.map(
      (item): ListItem => ({ inlines: parseInline(item.lines.join("\n")), children: item.children ? finishList(item.children) : null }),
    ),
  };
}

function parseList(lines: string[], start: number): { block: MarkdownList; next: number } {
  const first = listItemOf(lines[start])!;
  const base = first.indent;
  const root: DraftList = { ordered: first.ordered, start: first.ordered ? Math.max(1, parseInt(first.marker, 10) || 1) : 1, items: [] };
  let current: DraftItem | null = null;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      const nextItem = j < lines.length ? listItemOf(lines[j]) : null;
      if (nextItem && !isRule(lines[j]) && (nextItem.indent >= base + 2 || nextItem.ordered === root.ordered)) {
        i = j;
        continue;
      }
      break;
    }
    const item = listItemOf(line);
    if (item && !isRule(line)) {
      if (current && item.indent >= base + 2) {
        const nested: DraftList = (current.children ??= { ordered: item.ordered, start: 1, items: [] });
        nested.items.push({ lines: [item.text], children: null });
      } else if (item.ordered !== root.ordered) {
        break;
      } else {
        current = { lines: [item.text], children: null };
        root.items.push(current);
      }
      i++;
      continue;
    }
    // An indented line without a marker continues the item above it.
    if (current && indentOf(line) > base) {
      const target = current.children ? current.children.items[current.children.items.length - 1] : current;
      target.lines.push(line.trim());
      i++;
      continue;
    }
    break;
  }
  return { block: finishList(root), next: i };
}

function parseTable(lines: string[], start: number, aligns: TableAlign[]): { block: Block; next: number } {
  const cols = aligns.length;
  const header = splitRow(lines[start]).map(parseInline);
  const rows: Inline[][][] = [];
  let i = start + 2;
  while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
    const cells = splitRow(lines[i]);
    while (cells.length < cols) cells.push("");
    rows.push(cells.slice(0, cols).map(parseInline));
    i++;
  }
  return { block: { type: "table", align: aligns, header, rows }, next: i };
}

function parseBlocks(lines: string[], quoteDepth: number): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = fenceOf(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !isFenceClose(lines[i], fence)) body.push(lines[i++]);
      i++; // the closing fence; an unterminated one runs to the end
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }

    const heading = headingOf(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading.level, inlines: parseInline(heading.text) });
      i++;
      continue;
    }

    if (isRule(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (isQuote(line)) {
      const inner: string[] = [];
      while (i < lines.length && isQuote(lines[i])) {
        const t = lines[i].trimStart().slice(1);
        inner.push(t.startsWith(" ") ? t.slice(1) : t);
        i++;
      }
      const children =
        quoteDepth >= MAX_QUOTE_DEPTH ? [{ type: "paragraph" as const, inlines: parseInline(inner.join("\n").trim()) }] : parseBlocks(inner, quoteDepth + 1);
      blocks.push({ type: "blockquote", children });
      continue;
    }

    if (listItemOf(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    const aligns = tableStart(lines, i);
    if (aligns) {
      const { block, next } = parseTable(lines, i, aligns);
      blocks.push(block);
      i = next;
      continue;
    }

    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !interruptsParagraph(lines, i)) para.push(lines[i++].trim());
    blocks.push({ type: "paragraph", inlines: parseInline(para.join("\n")) });
  }
  return blocks;
}

export function parseMarkdown(text: string): Block[] {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map(expandLeadingTabs);
  return parseBlocks(lines, 0);
}
