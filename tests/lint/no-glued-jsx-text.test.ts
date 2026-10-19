// lectual/no-glued-jsx-text — the guard against words rendering glued together.
//
// 2026-10-19: lectual's "No firm access yet" card read "tayloramcghee@gmail.comis
// signed in". The source had the space; Next 16.2.7's SWC compiler dropped it, because
// the text after `{email}` contained an HTML entity (&apos;) AND wrapped onto a second
// line. This app had the same bug on nine screens, its own No firm access card and
// Today among them. See eslint-rules/no-glued-jsx-text.mjs.
//
// Two layers, both pure-logic (no DB, never skipped):
//   1. RuleTester: what the rule flags, what it deliberately leaves alone, and that
//      `--fix` writes the right `{" "}`.
//   2. A scan of EVERY .tsx under src/, so `pnpm test` catches a regression even
//      when nobody runs `pnpm lint`.
import { describe, it, expect } from "vitest";
import { ESLint, RuleTester } from "eslint";
import nextTs from "eslint-config-next/typescript";
import path from "node:path";
import rule from "../../eslint-rules/no-glued-jsx-text.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

// The TypeScript parser `pnpm lint` itself uses, borrowed from Next's config (it is
// not a direct dependency, so it can't be imported by name).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parser: any = (nextTs as Array<{ languageOptions?: { parser?: unknown } }>).find(
  (c) => c.languageOptions?.parser,
)!.languageOptions!.parser;

const tester = new RuleTester({
  languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

// Each case is one component body; `jsx` keeps them readable.
const jsx = (body: string) => `export const C = (p: any) => (${body});`;

tester.run("no-glued-jsx-text", rule, {
  valid: [
    // The fixed card: an explicit space survives every compiler.
    jsx(`<p>{p.email}{" "}is signed in, but isn&apos;t a member.\n  Ask your admin.\n</p>`),
    // The compiler bug needs BOTH an entity and a line break — either alone is fine.
    jsx(`<p>{p.email} is signed in, but is not a member.\n  Ask your admin.\n</p>`),
    jsx(`<p>{p.email} is signed in, but isn&apos;t a member.</p>`),
    // No neighbour before the text: nothing to glue to.
    jsx(`<p>Isn&apos;t this\n  fine</p>`),
    // An explicit space already sits before the text.
    jsx(`<p><a href="/s">Skills</a>{" "}\n  page — isn&apos;t live\n</p>`),
    // Pluralization: the glue between "record" and "s" is the point.
    jsx(`<p>{p.n} record\n  {p.n === 1 ? "" : "s"} written</p>`),
    jsx(`<p>{p.n} set\n  {p.n === 1 ? " of initials" : "s of initials"} matched</p>`),
    // Values that bring their own spacing or punctuation.
    jsx("<p>Charged at signing\n  {p.at ? ` · ${p.at}` : \"\"}</p>"),
    jsx("<p>The pull stopped short\n  {p.why ? `: ${p.why}` : \".\"} The counts</p>"),
    jsx("<p>for your session\n  {p.name ? `, ${p.name}` : ''}. Skip</p>"),
    // Values that render elements, not text: no space is wanted.
    jsx(`<p>Go to queue\n  {ChevronRightIcon({ size: 13 })}</p>`),
    jsx(`<div>Heading\n  {p.rows.map((r: any) => <div key={r}>{r}</div>)}</div>`),
    jsx(`<div>Heading\n  {p.show && <div>banner</div>}</div>`),
    // Text that opens onto its value on purpose.
    jsx(`<p>(\n  {p.count}\n)</p>`),
  ],
  invalid: [
    {
      // THE bug, verbatim shape: NoFirmAccessCard before the fix.
      code: jsx(`<p>{p.email} is signed in, but isn&apos;t a member.\n  Ask your admin.\n</p>`),
      output: jsx(`<p>{p.email}{" "}is signed in, but isn&apos;t a member.\n  Ask your admin.\n</p>`),
      errors: [{ messageId: "swcEntity" }],
    },
    {
      // Same bug after a pluralized value ("recordsinto"), and with &amp; / &mdash;.
      code: jsx(`<p>{p.n} record{p.n === 1 ? "" : "s"} into this firm&apos;s\n  pipeline.</p>`),
      output: jsx(`<p>{p.n} record{p.n === 1 ? "" : "s"}{" "}into this firm&apos;s\n  pipeline.</p>`),
      errors: [{ messageId: "swcEntity" }],
    },
    {
      code: jsx(`<p>{p.who} &mdash; here\n  text</p>`),
      output: jsx(`<p>{p.who}{" "}&mdash; here\n  text</p>`),
      errors: [{ messageId: "swcEntity" }],
    },
    {
      // After an element, too.
      code: jsx(`<p><b>{p.x}</b> isn&apos;t\n  ok</p>`),
      output: jsx(`<p><b>{p.x}</b>{" "}isn&apos;t\n  ok</p>`),
      errors: [{ messageId: "swcEntity" }],
    },
    {
      // Plain JSX: a line break right after a value is removed.
      code: jsx(`<p>{p.email}\n  is signed in</p>`),
      output: jsx(`<p>{p.email}{" "}\n  is signed in</p>`),
      errors: [{ messageId: "gluedAfter" }],
    },
    {
      // …including after a pluralized value ("itemsremaining").
      code: jsx(`<p>{p.n} item{p.n === 1 ? "" : "s"}\n  remaining</p>`),
      output: jsx(`<p>{p.n} item{p.n === 1 ? "" : "s"}{" "}\n  remaining</p>`),
      errors: [{ messageId: "gluedAfter" }],
    },
    {
      // And the other way round ("Signed in asTaylor").
      code: jsx(`<p>Signed in as\n  {p.name}</p>`),
      output: jsx(`<p>Signed in as{" "}\n  {p.name}</p>`),
      errors: [{ messageId: "gluedBefore" }],
    },
    {
      code: jsx(`<p>Total:\n  {p.total}</p>`),
      output: jsx(`<p>Total:{" "}\n  {p.total}</p>`),
      errors: [{ messageId: "gluedBefore" }],
    },
  ],
});

describe("no glued JSX text anywhere in src/", () => {
  it("finds no violations in any .tsx file", async () => {
    const root = path.resolve(__dirname, "../..");
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ["**/*.tsx"],
          languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
          plugins: { lectual: { rules: { "no-glued-jsx-text": rule } } },
          rules: { "lectual/no-glued-jsx-text": "error" },
        },
      ],
    });
    const results = await eslint.lintFiles(["src/**/*.tsx"]);
    expect(results.length).toBeGreaterThan(100); // the glob really matched the app

    // Only this rule's findings: the files' own `eslint-disable` comments name
    // Next rules this minimal config doesn't load, which ESLint reports as noise.
    const found = results.flatMap((r) =>
      r.messages
        .filter((m) => m.ruleId === "lectual/no-glued-jsx-text")
        .map((m) => `${path.relative(root, r.filePath)}:${m.line} — ${m.message}`),
    );
    expect(found, "Words would render glued together. Run `pnpm lint --fix` or add {\" \"}.").toEqual([]);
  }, 120_000);
});
