// Source scanner shared by the Sprint 31 grep tests. It reads .ts/.tsx files, drops
// comments, and returns the text a person could read: string literals and JSX text.
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "../..");

export function walk(dir: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  const st = fs.statSync(abs);
  if (st.isFile()) {
    if (/\.(ts|tsx)$/.test(abs)) out.push(path.relative(ROOT, abs));
    return out;
  }
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

export type Candidate = { text: string; line: number; kind: "string" | "jsx" };

function prevSignificant(code: string): string {
  for (let k = code.length - 1; k >= 0; k--) if (!/\s/.test(code[k])) return code[k];
  return "";
}

/** Blank out comments, keep line structure, and collect string literals. */
export function stripAndCollect(src: string, keepStrings = false): { code: string; strings: Candidate[] } {
  let code = "";
  const strings: Candidate[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/" && src[i - 1] !== ":") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") {
          code += "\n";
          line++;
        }
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "/" && /[(,=:[!&|?{};]|^$/.test(prevSignificant(code))) {
      // A regular expression literal: skip it, so a quote inside it cannot open a string.
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") j += 2;
        else {
          if (src[j] === "[") inClass = true;
          else if (src[j] === "]") inClass = false;
          else if (src[j] === "/" && !inClass) break;
          j++;
        }
      }
      if (src[j] === "/") {
        code += " ";
        i = j + 1;
        continue;
      }
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      const start = line;
      let j = i + 1;
      let text = "";
      let ok = false;
      while (j < n) {
        if (src[j] === "\\") {
          text += src[j] + (src[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (src[j] === q) {
          ok = true;
          break;
        }
        if (src[j] === "\n") {
          if (q !== "`") break;
          line++;
        }
        text += src[j];
        j++;
      }
      if (ok) {
        strings.push({ text, line: start, kind: "string" });
        code += q + (keepStrings ? text : text.replace(/[^\n]/g, " ")) + q;
        i = j + 1;
        continue;
      }
    }
    if (c === "\n") line++;
    code += c;
    i++;
  }
  return { code, strings };
}

/**
 * JSX text: runs that hold a letter and sit between tags. A run is bounded on the left by ">" or by
 * the "}" that closes an expression, and on the right by "<" or by the "{" that opens one, so
 * `<p>a {x} this deployment {y} b</p>` yields "a", "this deployment" and "b". A run bounded by a brace
 * on a side is dropped when it reads like code ("} else {", "} function f() {").
 */
export function jsxText(code: string): Candidate[] {
  const out: Candidate[] = [];
  const re = /([>}])([^<>{}]*[A-Za-z][^<>{}]*)(?=[<{])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const before = code.slice(0, m.index);
    const line = before.split("\n").length;
    const raw = m[2];
    const text = raw.replace(/\s+/g, " ").trim();
    // An arrow function or a comparison between a ">" and a "<" is code, not text.
    if (/=>|==|\breturn\b/.test(text) || /;/.test(text.replace(/&[a-z#0-9]+;/gi, ""))) continue;
    const next = code[m.index + m[0].length];
    if ((m[1] === "}" || next === "{") && CODE_LIKE.test(text)) continue;
    if (text) out.push({ text, line, kind: "jsx" });
  }
  return out;
}

const CODE_LIKE = /[=()[\]]|\b(function|const|let|var|return|else|if|for|while|switch|case|import|export|from|type|interface|async|await|catch|try|finally|default|extends|implements)\b/;

export function candidatesOf(file: string): Candidate[] {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const { code, strings } = stripAndCollect(src);
  const ins = strings.filter((s) => /\s/.test(s.text.trim()) || /^[A-Z]/.test(s.text.trim()));
  return [...ins, ...jsxText(code)];
}
