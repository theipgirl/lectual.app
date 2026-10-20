import type { Inline } from "./types";

/**
 * Inline Markdown: **bold**, *italic* / _italic_, `code`, [text](url).
 *
 * Input is untrusted (agent and model output), so every rule here fails toward
 * "show the characters as typed". Two limits keep hostile input cheap:
 * a delimiter looks for its partner only within WINDOW characters, and the
 * partner lookup is memoised (Finder), so 200,000 stray `[` or `*` cost one
 * scan, not 200,000.
 */

const MAX_DEPTH = 5;
const WINDOW = 4000;
const MAX_URL = 2000;
const ESCAPABLE = "\\`*_{}[]()#+-.!|>~<";
/** Only these may become a clickable link; everything else shows as text. */
const SAFE_HREF = /^(https?:\/\/|mailto:)[^\s<>"']+$/i;

/** "Where is the next `needle` at or after `from`?", remembering the last answer. */
class Finder {
  private last = new Map<string, { from: number; pos: number }>();
  constructor(private readonly src: string) {}
  next(needle: string, from: number): number {
    const hit = this.last.get(needle);
    if (hit && from >= hit.from && (hit.pos === -1 || from <= hit.pos)) return hit.pos;
    const pos = this.src.indexOf(needle, from);
    this.last.set(needle, { from, pos });
    return pos;
  }
}

const isSpace = (ch: string | undefined) => ch === undefined || ch === " " || ch === "\t" || ch === "\n";
const isAlnum = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

export function safeHref(raw: string): string | null {
  const href = raw.trim();
  return SAFE_HREF.test(href) ? href : null;
}

export function parseInline(src: string): Inline[] {
  return parseRange(src, 0, src.length, 0, false, new Finder(src));
}

type LinkParts = { labelEnd: number; url: string; next: number };

/** Reads `](url)` after the `[` at `open`. Null when the text is not a link. */
function readLinkTail(src: string, open: number, end: number, finder: Finder): LinkParts | null {
  const close = finder.next("]", open + 1);
  if (close === -1 || close >= end || close - open > WINDOW || src[close + 1] !== "(") return null;
  const urlStart = close + 2;
  const limit = Math.min(end, urlStart + MAX_URL);
  let depth = 0;
  let k = urlStart;
  for (; k < limit; k++) {
    const ch = src[k];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "[") break;
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) break;
      depth--;
    }
  }
  const url = src.slice(urlStart, k);
  while (k < limit && (src[k] === " " || src[k] === "\t")) k++;
  if (src[k] === '"' || src[k] === "'") {
    const quote = src[k];
    const titleEnd = src.indexOf(quote, k + 1);
    if (titleEnd === -1 || titleEnd - k > 300 || titleEnd >= end) return null;
    k = titleEnd + 1;
    while (k < end && (src[k] === " " || src[k] === "\t")) k++;
  }
  if (src[k] !== ")" || k >= end) return null;
  return { labelEnd: close, url, next: k + 1 };
}

/** `*x*`, `**x**` or `***x***` opening at `i` (a run of `n` delimiters), or null. */
function readEmphasis(
  src: string,
  start: number,
  i: number,
  n: number,
  end: number,
  depth: number,
  inLink: boolean,
  finder: Finder,
): { node: Inline; next: number } | null {
  const ch = src[i];
  const before = i > start ? src[i - 1] : undefined;
  if (i + n >= end || isSpace(src[i + n]) || (ch === "_" && isAlnum(before))) return null;
  const delim = ch.repeat(n);
  let from = i + n;
  // A few candidate closers per opener: enough for real text, bounded for hostile text.
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = finder.next(delim, from);
    if (p === -1 || p >= end || p - i > WINDOW) return null;
    let runLen = 1;
    while (p + runLen < end && src[p + runLen] === ch) runLen++;
    const closes = runLen === n && p > i + n && !isSpace(src[p - 1]) && !(ch === "_" && isAlnum(src[p + runLen]));
    if (closes) {
      const inner = parseRange(src, i + n, p, depth + 1, inLink, finder);
      const node: Inline =
        n === 1 ? { type: "em", children: inner } : n === 2 ? { type: "strong", children: inner } : { type: "strong", children: [{ type: "em", children: inner }] };
      return { node, next: p + n };
    }
    from = p + runLen;
  }
  return null;
}

function parseRange(src: string, start: number, end: number, depth: number, inLink: boolean, finder: Finder): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ type: "text", text: buf });
    buf = "";
  };
  let i = start;

  while (i < end) {
    const ch = src[i];

    if (ch === "\\" && i + 1 < end && ESCAPABLE.includes(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      out.push({ type: "br" });
      i++;
      continue;
    }

    if (ch === "`") {
      let n = 1;
      while (i + n < end && src[i + n] === "`") n++;
      const fence = "`".repeat(n);
      const close = finder.next(fence, i + n);
      if (close !== -1 && close + n <= end && close - i <= WINDOW) {
        const code = src.slice(i + n, close).replace(/\n/g, " ").trim();
        if (code) {
          flush();
          out.push({ type: "code", text: code });
          i = close + n;
          continue;
        }
      }
      buf += fence;
      i += n;
      continue;
    }

    // An image is never fetched or drawn: only its alt text survives.
    if (ch === "!" && src[i + 1] === "[" && depth < MAX_DEPTH) {
      const tail = readLinkTail(src, i + 1, end, finder);
      if (tail) {
        buf += src.slice(i + 2, tail.labelEnd).replace(/[\n[\]\\]/g, " ");
        i = tail.next;
        continue;
      }
    }

    if (ch === "[" && depth < MAX_DEPTH) {
      const tail = readLinkTail(src, i, end, finder);
      if (tail) {
        const label = parseRange(src, i + 1, tail.labelEnd, depth + 1, true, finder);
        const href = inLink ? null : safeHref(tail.url);
        flush();
        if (href) out.push({ type: "link", href, children: label });
        else out.push(...label);
        i = tail.next;
        continue;
      }
    }

    if ((ch === "*" || ch === "_") && depth < MAX_DEPTH) {
      let n = 1;
      while (i + n < end && src[i + n] === ch) n++;
      const emphasis = n <= 3 ? readEmphasis(src, start, i, n, end, depth, inLink, finder) : null;
      if (emphasis) {
        flush();
        out.push(emphasis.node);
        i = emphasis.next;
        continue;
      }
      buf += src.slice(i, i + n);
      i += n;
      continue;
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}
