/**
 * lectual/no-glued-jsx-text — JSX text that will render glued to the value next to it.
 *
 * Why this exists: on 2026-10-19 the "No firm access yet" card rendered
 * "tayloramcghee@gmail.comis signed in". The source was correct —
 * `{email} is signed in, but isn&apos;t a member…` — but Next 16.2.7's SWC
 * compiler DROPS the leading whitespace of a JSX text node when that text
 * (a) contains an HTML entity (&apos; &amp; &mdash; …) and (b) wraps onto
 * another line. It compiled to `children: [email, "is signed in…"]`. Remove
 * either condition and the space survives, which is why nobody saw it coming.
 *
 * It flags three shapes, all of which render two words with no space:
 *   swcEntity    `{value} isn&apos;t…↵…`      the compiler bug above (also after
 *                                              an element: `<b>x</b> isn&apos;t↵…`)
 *   gluedAfter   `{value}↵  word`              standard JSX: a newline after a
 *                                              value is whitespace JSX removes
 *   gluedBefore  `word↵  {value}`              same, the other way round
 *
 * The fix is always an explicit `{" "}`, which no compiler trims. `--fix` writes it.
 *
 * gluedAfter/gluedBefore only fire next to a value that renders TEXT: not next
 * to `{cond && <Banner/>}` or `{rows.map(…)}`, where no space is wanted.
 * Covered by tests/lint/no-glued-jsx-text.test.ts, which also scans every .tsx
 * file in src/, so `pnpm test` catches a regression as well as `pnpm lint`.
 * Ported from theipgirl/lectual (see PORTED_FROM.md).
 */

const ENTITY = /&(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#x[0-9a-fA-F]+);/;
const SPACE = '{" "}';

/** A sibling that renders something: an element, a fragment, or a non-comment {expression}. */
function isNode(node) {
  if (!node) return false;
  if (node.type === "JSXExpressionContainer") return node.expression.type !== "JSXEmptyExpression";
  return node.type === "JSXElement" || node.type === "JSXFragment";
}

function unwrap(expr) {
  while (["ChainExpression", "TSNonNullExpression", "TSAsExpression", "TSSatisfiesExpression"].includes(expr.type)) {
    expr = expr.expression;
  }
  return expr;
}

/** Does this {expression} render inline text (so a missing space would show)? */
function rendersText(expr) {
  expr = unwrap(expr);
  switch (expr.type) {
    case "JSXElement":
    case "JSXFragment":
      return false;
    case "ConditionalExpression":
      return rendersText(expr.consequent) && rendersText(expr.alternate);
    case "LogicalExpression":
      return rendersText(expr.right);
    case "CallExpression": {
      const c = expr.callee;
      if (c.type === "Identifier" && /^[A-Z]/.test(c.name)) return false; // ChevronRightIcon({...}) → an element
      const name = c.type === "MemberExpression" && !c.computed ? c.property.name : null;
      return name !== "map" && name !== "flatMap"; // a list of elements, not text
    }
    default:
      return true;
  }
}

/**
 * What a value can render at one edge ("start" or "end"): an array of the possible
 * edge strings, or null when that edge is dynamic (`{name}`, `{fmt(x)}`, `${x}` at the
 * edge of a template). `{cond && "x"}` can also render nothing, hence the "".
 */
function edges(expr, side) {
  expr = unwrap(expr);
  switch (expr.type) {
    case "Literal":
      return [typeof expr.value === "string" || typeof expr.value === "number" ? String(expr.value) : ""];
    case "TemplateLiteral": {
      const quasi = side === "start" ? expr.quasis[0] : expr.quasis[expr.quasis.length - 1];
      const text = quasi.value.cooked ?? "";
      return text === "" && expr.expressions.length > 0 ? null : [text];
    }
    case "ConditionalExpression": {
      const a = edges(expr.consequent, side);
      const b = edges(expr.alternate, side);
      return a && b ? [...a, ...b] : null;
    }
    case "LogicalExpression": {
      const r = edges(expr.right, side);
      return r ? ["", ...r] : null;
    }
    default:
      return null;
  }
}

const WORD = /^[\p{L}\p{N}]/u;
const SPACE_OR_EMPTY_END = (s) => s === "" || /\s$/.test(s);

/** `{value}` then text: would the value's END touch the text? (`{" "}`, `"… "` don't.) */
function endsFlush(node) {
  if (node?.type !== "JSXExpressionContainer" || !isNode(node)) return isNode(node); // elements: assume yes
  const e = edges(node.expression, "end");
  return e === null || !e.every(SPACE_OR_EMPTY_END);
}

/**
 * text then `{value}`: does the value START with a word that would glue on? Not when it
 * brings its own spacing or punctuation (`` ` · ${n}` ``, `", " + x`), and not for the
 * suffix idiom `{n === 1 ? "" : "s"}` / `{n === 1 ? " of x" : "s of x"}`, where a branch
 * that is empty or space-led shows the glue on the other branch is deliberate.
 */
function startsWithGluedWord(node) {
  if (node?.type !== "JSXExpressionContainer" || !isNode(node) || !rendersText(node.expression)) return false;
  const e = edges(node.expression, "start");
  if (e === null) return true; // {name}, {fmt(x)} — dynamic, assume a word
  if (e.some((s) => s === "" || /^\s/.test(s))) return false;
  return e.some((s) => WORD.test(s));
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    fixable: "code",
    schema: [],
    docs: { description: "Disallow JSX text that renders with no space next to an adjacent value." },
    messages: {
      swcEntity:
        "This text's leading space is dropped at build time: Next 16's compiler strips it when the " +
        "text contains an HTML entity (like &apos;) and wraps onto another line, so it renders glued " +
        "to what comes before. Start it with {\" \"} instead (`--fix` does this).",
      gluedAfter:
        "This text starts on a new line right after a value, and JSX removes that line break, so the " +
        "two render with no space between them. Add {\" \"} after the value (`--fix` does this).",
      gluedBefore:
        "This text wraps onto a value on the next line, and JSX removes that line break, so the two " +
        "render with no space between them. Add {\" \"} at the end of this line (`--fix` does this).",
    },
  },
  create(context) {
    const source = context.sourceCode;

    function check(children) {
      for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (node.type !== "JSXText") continue;
        const raw = source.getText(node);
        const prev = children[i - 1];
        const next = children[i + 1];
        const [start, end] = node.range;

        // 1. The SWC bug. Leading spaces on the first line, before real text, after
        //    something that doesn't already end in a space of its own.
        const lead = /^[ \t]+(?=\S)/.exec(raw);
        if (lead && endsFlush(prev) && /\r?\n/.test(raw) && ENTITY.test(raw)) {
          context.report({
            node,
            messageId: "swcEntity",
            fix: (fixer) => fixer.replaceTextRange([start, start + lead[0].length], SPACE),
          });
          continue;
        }

        // 2. `{value}↵  word` — first visible character is a letter or digit.
        if (prev?.type === "JSXExpressionContainer" && rendersText(prev.expression) && endsFlush(prev)) {
          const m = /^[ \t]*\r?\n\s*(\S)/u.exec(raw);
          if (m && WORD.test(m[1])) {
            context.report({
              node,
              messageId: "gluedAfter",
              fix: (fixer) => fixer.insertTextBeforeRange([start, end], SPACE),
            });
            continue;
          }
        }

        // 3. `word↵  {value}` — last visible character is a letter, digit or
        //    sentence punctuation (an opening "(" or "$" before a value is meant to touch it).
        if (startsWithGluedWord(next)) {
          const m = /(\S)([ \t]*\r?\n\s*)$/u.exec(raw);
          if (m && /[\p{L}\p{N},.;:!?]/u.test(m[1])) {
            const breakAt = end - m[2].length;
            context.report({
              node,
              messageId: "gluedBefore",
              fix: (fixer) => fixer.insertTextAfterRange([breakAt, breakAt], SPACE),
            });
          }
        }
      }
    }

    return {
      JSXElement: (node) => check(node.children),
      JSXFragment: (node) => check(node.children),
    };
  },
};

export default rule;
