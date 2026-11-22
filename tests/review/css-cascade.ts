/**
 * A small, strict CSS cascade for ONE property family (white-space / text-wrap / text-wrap-mode -> text-wrap-mode), used to prove which
 * rule decides whether a cell's text may wrap. No browser: it parses the stylesheets the app ships and the markup React renders.
 *
 * Scope, on purpose: selectors of type, universal, class, id, attribute, the descendant / child / sibling combinators, structural and
 * state pseudo-classes, :not / :is / :where of those, and pseudo-elements (which never match an element). Media queries are evaluated at
 * one desktop width. Anything it cannot parse is REPORTED when the rule declares one of the three properties, so a test can fail on it
 * rather than silently ignore a rule that might win.
 */

/* ── markup ── */

export type El = { tag: string; attrs: Record<string, string>; classes: string[]; parent: El | null; children: El[]; hasText: boolean };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

export function parseHtml(html: string): El {
  const root: El = { tag: "#root", attrs: {}, classes: [], parent: null, children: [], hasText: false };
  let cur = root;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) {
      if (m[5].trim()) cur.hasText = true;
      continue;
    }
    const [, close, tag, rest, selfClose] = m;
    if (close) {
      if (cur.parent) cur = cur.parent;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rest.matchAll(/([^\s=/]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? "";
    const el: El = { tag: tag.toLowerCase(), attrs, classes: (attrs.class ?? "").split(/\s+/).filter(Boolean), parent: cur, children: [], hasText: false };
    cur.children.push(el);
    if (!selfClose && !VOID.has(el.tag)) cur = el;
  }
  return root;
}

export function findAll(root: El, test: (el: El) => boolean): El[] {
  const out: El[] = [];
  const walk = (e: El) => {
    for (const c of e.children) {
      if (test(c)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/* ── selectors ── */

type Attr = { name: string; op: string | null; value: string; insensitive: boolean };
type Pseudo = { kind: "class"; name: string; arg?: string; list?: Compound[][] } | { kind: "element"; name: string };
type Compound = { tag: string | null; ids: string[]; classes: string[]; attrs: Attr[]; pseudos: Pseudo[] };
type Complex = { compounds: Compound[]; combinators: string[] };
export type Specificity = [number, number, number];

const STATE = new Set(["hover", "focus", "focus-visible", "focus-within", "active", "visited", "link", "any-link", "checked", "disabled", "enabled", "target", "placeholder-shown", "invalid", "valid", "required", "indeterminate", "open", "popover-open", "default", "read-only", "read-write"]);
const STRUCTURAL = new Set(["first-child", "last-child", "only-child", "nth-child", "nth-last-child", "first-of-type", "last-of-type", "root", "empty"]);
const LIST = new Set(["not", "is", "where"]);

class Unparseable extends Error {}

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim());
}

const IDENT = /^-?[A-Za-z_][A-Za-z0-9_-]*/;

function parseCompound(s: string): Compound {
  const c: Compound = { tag: null, ids: [], classes: [], attrs: [], pseudos: [] };
  let i = 0;
  const ident = () => {
    const m = IDENT.exec(s.slice(i).replace(/\\:/g, ":"));
    if (!m) throw new Unparseable(s);
    i += m[0].length;
    return m[0];
  };
  if (s[i] === "*") i++;
  else if (IDENT.test(s.slice(i))) c.tag = ident().toLowerCase();
  while (i < s.length) {
    const ch = s[i];
    if (ch === ".") {
      i++;
      c.classes.push(ident());
    } else if (ch === "#") {
      i++;
      c.ids.push(ident());
    } else if (ch === "[") {
      const end = s.indexOf("]", i);
      if (end < 0) throw new Unparseable(s);
      const inner = s.slice(i + 1, end).trim();
      const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?)?$/.exec(inner);
      if (!m) throw new Unparseable(s);
      c.attrs.push({ name: m[1], op: m[2] ?? null, value: m[3] ?? m[4] ?? m[5] ?? "", insensitive: !!m[6] });
      i = end + 1;
    } else if (ch === ":") {
      const element = s[i + 1] === ":";
      i += element ? 2 : 1;
      const name = ident().toLowerCase();
      let arg: string | undefined;
      if (s[i] === "(") {
        let depth = 0;
        let j = i;
        for (; j < s.length; j++) {
          if (s[j] === "(") depth++;
          else if (s[j] === ")" && --depth === 0) break;
        }
        arg = s.slice(i + 1, j);
        i = j + 1;
      }
      if (element || ["before", "after", "placeholder", "marker", "selection", "backdrop", "first-line", "first-letter"].includes(name) || name.startsWith("-webkit-") || name.startsWith("-moz-")) c.pseudos.push({ kind: "element", name });
      else if (LIST.has(name) && arg !== undefined) c.pseudos.push({ kind: "class", name, list: splitTop(arg, ",").map(parseComplexCompounds) });
      else if (STATE.has(name) || STRUCTURAL.has(name)) c.pseudos.push({ kind: "class", name, arg });
      else throw new Unparseable(s);
    } else throw new Unparseable(s);
  }
  return c;
}

/** A selector inside :not / :is / :where: a single compound only (enough for these stylesheets; anything else is reported). */
function parseComplexCompounds(s: string): Compound[] {
  const cx = parseComplex(s);
  if (cx.compounds.length !== 1) throw new Unparseable(s);
  return cx.compounds;
}

function parseComplex(s: string): Complex {
  const parts = s.replace(/\s*([>+~])\s*/g, " $1 ").trim().split(/\s+/);
  const compounds: Compound[] = [];
  const combinators: string[] = [];
  let pending = " ";
  for (const p of parts) {
    if (p === ">" || p === "+" || p === "~") {
      pending = p;
      continue;
    }
    if (compounds.length > 0) combinators.push(pending);
    compounds.push(parseCompound(p));
    pending = " ";
  }
  if (compounds.length === 0) throw new Unparseable(s);
  return { compounds, combinators };
}

const add = (a: Specificity, b: Specificity): Specificity => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const cmpSpec = (a: Specificity, b: Specificity) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function compoundSpec(c: Compound): Specificity {
  let s: Specificity = [c.ids.length, c.classes.length + c.attrs.length, c.tag ? 1 : 0];
  for (const p of c.pseudos) {
    if (p.kind === "element") s = add(s, [0, 0, 1]);
    else if (p.list) {
      if (p.name === "where") continue;
      s = add(s, p.list.map((l) => compoundSpec(l[0])).sort(cmpSpec).at(-1) ?? [0, 0, 0]);
    } else s = add(s, [0, 1, 0]);
  }
  return s;
}

export function specificity(cx: Complex): Specificity {
  return cx.compounds.reduce<Specificity>((acc, c) => add(acc, compoundSpec(c)), [0, 0, 0]);
}

const siblings = (el: El) => (el.parent ? el.parent.children : [el]);

function nth(arg: string | undefined, pos: number): boolean {
  const a = (arg ?? "").trim();
  if (a === "odd") return pos % 2 === 1;
  if (a === "even") return pos % 2 === 0;
  if (/^\d+$/.test(a)) return pos === Number(a);
  throw new Unparseable(`:nth-child(${a})`);
}

function matchCompound(c: Compound, el: El): boolean {
  if (c.tag && c.tag !== el.tag) return false;
  if (c.ids.some((id) => el.attrs.id !== id)) return false;
  if (c.classes.some((k) => !el.classes.includes(k))) return false;
  for (const a of c.attrs) {
    if (!(a.name in el.attrs)) return false;
    let v = el.attrs[a.name];
    let want = a.value;
    if (a.insensitive) {
      v = v.toLowerCase();
      want = want.toLowerCase();
    }
    const ok =
      a.op === null ? true
      : a.op === "=" ? v === want
      : a.op === "~=" ? v.split(/\s+/).includes(want)
      : a.op === "|=" ? v === want || v.startsWith(`${want}-`)
      : a.op === "^=" ? v.startsWith(want)
      : a.op === "$=" ? v.endsWith(want)
      : v.includes(want);
    if (!ok) return false;
  }
  for (const p of c.pseudos) {
    if (p.kind === "element") return false;
    if (p.list) {
      const any = p.list.some((l) => matchCompound(l[0], el));
      if (p.name === "not" ? any : !any) return false;
      continue;
    }
    const sib = siblings(el);
    const pos = sib.indexOf(el) + 1;
    switch (p.name) {
      case "first-child": if (pos !== 1) return false; break;
      case "last-child": if (pos !== sib.length) return false; break;
      case "only-child": if (sib.length !== 1) return false; break;
      case "nth-child": if (!nth(p.arg, pos)) return false; break;
      case "nth-last-child": if (!nth(p.arg, sib.length - pos + 1)) return false; break;
      case "first-of-type": if (sib.filter((s) => s.tag === el.tag)[0] !== el) return false; break;
      case "last-of-type": if (sib.filter((s) => s.tag === el.tag).at(-1) !== el) return false; break;
      case "root": if (el.parent?.tag !== "#root") return false; break;
      case "empty": if (el.children.length > 0 || el.hasText) return false; break;
      default: return false; // a state (hover, focus, ...): not in effect on a page at rest
    }
  }
  return true;
}

export function matches(cx: Complex, el: El): boolean {
  const go = (i: number, e: El): boolean => {
    if (!matchCompound(cx.compounds[i], e)) return false;
    if (i === 0) return true;
    const comb = cx.combinators[i - 1];
    if (comb === ">") return !!e.parent && e.parent.tag !== "#root" && go(i - 1, e.parent);
    if (comb === " ") {
      for (let p = e.parent; p && p.tag !== "#root"; p = p.parent) if (go(i - 1, p)) return true;
      return false;
    }
    const sib = siblings(e);
    const at = sib.indexOf(e);
    if (comb === "+") return at > 0 && go(i - 1, sib[at - 1]);
    for (let k = at - 1; k >= 0; k--) if (go(i - 1, sib[k])) return true;
    return false;
  };
  return go(cx.compounds.length - 1, el);
}

/* ── stylesheets ── */

const PROPS = new Set(["white-space", "text-wrap", "text-wrap-mode"]);
export type Decl = { prop: string; value: string; important: boolean };
export type Rule = { selector: string; complex: Complex[] | null; decls: Decl[]; order: number; sheet: string; media: boolean | "unknown" };
export type Sheet = { name: string; css: string };

function evalMedia(cond: string, width: number): boolean | "unknown" {
  let result: boolean | "unknown" = false;
  for (const part of splitTop(cond, ",")) {
    let ok: boolean | "unknown" = true;
    let s = part.trim().toLowerCase();
    let negate = false;
    if (s.startsWith("not ")) {
      negate = true;
      s = s.slice(4);
    }
    s = s.replace(/^only\s+/, "");
    for (const tok of s.split(/\s+and\s+/)) {
      const t = tok.trim();
      let v: boolean | "unknown";
      if (t === "screen" || t === "all") v = true;
      else if (t === "print") v = false;
      else {
        const m = /^\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)$/.exec(t);
        if (!m) v = "unknown";
        else {
          const [, feat, val] = m;
          const px = /^(\d+(?:\.\d+)?)px$/.exec(val);
          if (feat === "min-width" && px) v = width >= Number(px[1]);
          else if (feat === "max-width" && px) v = width <= Number(px[1]);
          else if (feat === "pointer" || feat === "any-pointer") v = val === "fine";
          else if (feat === "hover" || feat === "any-hover") v = val === "hover";
          else if (feat === "prefers-reduced-motion") v = val === "no-preference";
          else if (feat === "prefers-color-scheme") v = val === "light";
          else if (feat === "prefers-contrast") v = val === "no-preference";
          else v = "unknown";
        }
      }
      ok = ok === "unknown" || v === "unknown" ? "unknown" : ok && v;
    }
    if (negate && ok !== "unknown") ok = !ok;
    if (ok === true) return true;
    if (ok === "unknown") result = "unknown";
  }
  return result;
}

function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return i;
  }
  return css.length;
}

function parseDecls(body: string): Decl[] {
  return splitTop(body, ";")
    .map((d) => {
      const at = d.indexOf(":");
      if (at < 0) return null;
      const prop = d.slice(0, at).trim().toLowerCase();
      let value = d.slice(at + 1).trim();
      const important = /!\s*important\s*$/i.test(value);
      if (important) value = value.replace(/!\s*important\s*$/i, "").trim();
      return { prop, value: value.toLowerCase(), important };
    })
    .filter((d): d is Decl => !!d && PROPS.has(d.prop));
}

/** Every rule in the sheets, in cascade order. `problems` lists each rule declaring one of the three properties that could not be understood. */
export function parseSheets(sheets: Sheet[], width: number): { rules: Rule[]; problems: string[] } {
  const rules: Rule[] = [];
  const problems: string[] = [];
  let order = 0;
  const walk = (css: string, sheet: string, media: boolean | "unknown") => {
    let i = 0;
    while (i < css.length) {
      const open = css.indexOf("{", i);
      const semi = css.indexOf(";", i);
      if (open < 0) break;
      const prelude0 = css.slice(i, open).trim();
      if (semi >= 0 && semi < open && css.slice(i, semi).trim().startsWith("@")) {
        i = semi + 1; // @import / @charset
        continue;
      }
      const end = blockEnd(css, open);
      const body = css.slice(open + 1, end);
      const prelude = prelude0;
      if (prelude.startsWith("@")) {
        const name = /^@([a-z-]+)/i.exec(prelude)?.[1].toLowerCase() ?? "";
        if (name === "media") {
          const m = evalMedia(prelude.slice(6), width);
          walk(body, sheet, media === false || m === false ? false : media === "unknown" || m === "unknown" ? "unknown" : true);
        } else if (["keyframes", "font-face", "theme", "property", "page", "counter-style"].includes(name) || name.endsWith("keyframes")) {
          // no selectors that can match an element
        } else {
          walk(body, sheet, media === false ? false : "unknown");
        }
      } else {
        const decls = parseDecls(body.includes("{") ? "" : body);
        if (body.includes("{") && /white-space|text-wrap/.test(body)) problems.push(`${sheet}: nested rule under ${prelude}`);
        let complex: Complex[] | null = null;
        try {
          complex = splitTop(prelude, ",").map(parseComplex);
        } catch {
          if (decls.length > 0) problems.push(`${sheet}: selector "${prelude}"`);
        }
        if (media === "unknown" && decls.length > 0) problems.push(`${sheet}: media under "${prelude}"`);
        for (const d of decls) {
          if (expand(d) === null) problems.push(`${sheet}: value "${d.prop}: ${d.value}" under "${prelude}"`);
        }
        if (media === true && complex && decls.length > 0) rules.push({ selector: prelude, complex, decls, order: order++, sheet, media });
      }
      i = end + 1;
    }
  };
  for (const s of sheets) walk(s.css.replace(/\/\*[\s\S]*?\*\//g, ""), s.name, true);
  return { rules, problems };
}

/* ── the cascade ── */

type Mode = "wrap" | "nowrap" | "inherit";

/** A declaration as its effect on text-wrap-mode, or null when the value isn't understood. */
export function expand(d: Decl): Mode | null {
  const v = d.value.trim();
  if (v === "inherit" || v === "unset" || v === "revert" || v === "revert-layer") return "inherit";
  if (v === "initial") return "wrap";
  if (d.prop === "white-space") {
    if (v === "normal" || v === "pre-wrap" || v === "pre-line" || v === "break-spaces") return "wrap";
    if (v === "nowrap" || v === "pre") return "nowrap";
    const parts = v.split(/\s+/);
    if (parts.includes("nowrap")) return "nowrap";
    if (parts.includes("wrap")) return "wrap";
    return null;
  }
  if (d.prop === "text-wrap-mode") return v === "wrap" || v === "nowrap" ? v : null;
  // text-wrap: <mode> || <style>; a style alone resets the mode to its initial value, wrap.
  const parts = v.split(/\s+/);
  if (parts.some((p) => !["wrap", "nowrap", "balance", "pretty", "stable", "auto"].includes(p))) return null;
  return parts.includes("nowrap") ? "nowrap" : "wrap";
}

export type Winner = { mode: "wrap" | "nowrap"; rule: Rule | null; selector: string | null; specificity: Specificity | null; decl: Decl | null; inheritedFrom: string | null };

export function computedTextWrapMode(el: El, rules: Rule[]): Winner {
  const hits: { rule: Rule; spec: Specificity; decl: Decl; index: number; selector: string }[] = [];
  for (const rule of rules) {
    const specs = (rule.complex ?? []).filter((cx) => matches(cx, el)).map(specificity);
    if (specs.length === 0) continue;
    const spec = specs.sort(cmpSpec).at(-1)!;
    rule.decls.forEach((decl, index) => hits.push({ rule, spec, decl, index, selector: rule.selector }));
  }
  hits.sort((a, b) => Number(a.decl.important) - Number(b.decl.important) || cmpSpec(a.spec, b.spec) || a.rule.order - b.rule.order || a.index - b.index);
  const top = hits.at(-1);
  const parentMode = (): Winner => (el.parent && el.parent.tag !== "#root" ? { ...computedTextWrapMode(el.parent, rules), inheritedFrom: el.parent.tag } : { mode: "wrap", rule: null, selector: null, specificity: null, decl: null, inheritedFrom: "initial" });
  if (!top) return parentMode();
  const mode = expand(top.decl)!;
  if (mode === "inherit") return parentMode();
  return { mode, rule: top.rule, selector: top.selector, specificity: top.spec, decl: top.decl, inheritedFrom: null };
}
