/**
 * The tree the Markdown parser produces. Plain data, no React: the component
 * in src/components/markdown turns it into elements, and `markdownToPlainText`
 * flattens it. Nothing in it is ever HTML, so there is nothing to inject.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "br" };

export type TableAlign = "left" | "center" | "right" | null;

export type ListItem = { inlines: Inline[]; children: MarkdownList | null };

export type MarkdownList = { type: "list"; ordered: boolean; start: number; items: ListItem[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | MarkdownList
  | { type: "table"; align: TableAlign[]; header: Inline[][]; rows: Inline[][][] }
  | { type: "blockquote"; children: Block[] }
  | { type: "code"; text: string }
  | { type: "hr" };
