import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "@/components/markdown/Markdown";

const md = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("Markdown blocks (F1)", () => {
  it("renders headings h1 through h6", () => {
    expect(md("## Pricing")).toMatch(/<h2>Pricing<\/h2>/);
    for (let level = 1; level <= 6; level++) {
      expect(md(`${"#".repeat(level)} Title`)).toContain(`<h${level}>Title</h${level}>`);
    }
  });

  it("does not treat a hashtag or seven hashes as a heading", () => {
    expect(md("#hashtag")).not.toContain("<h1");
    expect(md("####### seven")).not.toMatch(/<h[1-6]/);
  });

  it("renders bold, italic and inline code", () => {
    expect(md("**Warm**")).toContain("<strong>Warm</strong>");
    expect(md("*it*")).toContain("<em>it</em>");
    expect(md("_it_")).toContain("<em>it</em>");
    expect(md("`x`")).toContain("<code>x</code>");
    expect(md("***both***")).toContain("<strong><em>both</em></strong>");
  });

  it("leaves snake_case and a lone asterisk alone", () => {
    expect(md("send_to_client now")).not.toContain("<em>");
    expect(md("2 * 3 * 4")).not.toContain("<em>");
  });

  it("renders bullet and numbered lists", () => {
    const ul = md("- a\n- b");
    expect(count(ul, /<ul>/g)).toBe(1);
    expect(count(ul, /<li>/g)).toBe(2);
    const ol = md("1. a\n2. b");
    expect(ol).toContain("<ol>");
    expect(count(ol, /<li>/g)).toBe(2);
    expect(md("3. a\n4. b")).toContain('<ol start="3">');
  });

  it("renders one level of nested list inside an li", () => {
    const html = md("- a\n  - b\n  - c\n- d");
    expect(html).toMatch(/<li>a<ul><li>b<\/li><li>c<\/li><\/ul><\/li><li>d<\/li>/);
  });

  it("renders blockquotes, rules and fenced code", () => {
    expect(md("> q")).toContain("<blockquote><p>q</p></blockquote>");
    expect(md("---")).toContain("<hr");
    expect(md("a\n\n***\n\nb")).toContain("<hr");
    const code = md("```\n**not bold**\n# not a heading\n```");
    expect(code).toContain("<pre><code>**not bold**\n# not a heading</code></pre>");
    expect(code).not.toContain("<strong>");
    expect(code).not.toContain("<h1");
  });

  it("runs an unterminated fence to the end", () => {
    expect(md("```\nabc")).toContain("<pre><code>abc</code></pre>");
  });

  it("keeps single newlines in a paragraph as line breaks", () => {
    expect(md("Hi Ana,\nThanks")).toContain("<p>Hi Ana,<br/>Thanks</p>");
  });

  it("separates a paragraph from a list that follows it", () => {
    const html = md("Items:\n- a\n- b");
    expect(html).toContain("<p>Items:</p>");
    expect(count(html, /<li>/g)).toBe(2);
  });
});

describe("Markdown tables (F2)", () => {
  it("renders a pipe table with alignment", () => {
    const html = md("| A | B |\n|---|:-:|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toMatch(/<th style="text-align:center">B<\/th>/);
    expect(html).toMatch(/<td style="text-align:center">2<\/td>/);
    expect(html).toContain("<td>1</td>");
    expect(html).not.toContain("|---|");
    expect(html).not.toContain("|");
  });

  it("applies right alignment from --:", () => {
    expect(md("| A |\n|--:|\n| 1 |")).toMatch(/<td style="text-align:right">1<\/td>/);
  });

  it("renders a ragged row without throwing, padding the missing cells", () => {
    const html = md("| A | B | C |\n|---|---|---|\n| 1 |");
    expect(count(html, /<td/g)).toBe(3);
  });

  it("works without leading and trailing pipes", () => {
    expect(md("A | B\n--|--\n1 | 2")).toContain("<table>");
  });

  it("treats a pipe line with no separator row as a paragraph", () => {
    const html = md("| A | B |\n| 1 | 2 |");
    expect(html).not.toContain("<table");
    expect(html).toContain("<p>");
  });

  it("renders inline formatting inside cells", () => {
    expect(md("| A |\n|---|\n| **x** |")).toContain("<td><strong>x</strong></td>");
  });
});

describe("Untrusted text is inert (F3)", () => {
  it("escapes raw HTML", () => {
    const html = md("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    const img = md("<img src=x onerror=alert(1)>");
    expect(img).not.toContain("<img");
    expect(img).toContain("&lt;img");
  });

  it("escapes HTML inside emphasis, links, headings, cells and code", () => {
    for (const text of [
      "**<script>x</script>**",
      "[<script>x</script>](https://a.example)",
      "# <script>x</script>",
      "| A |\n|---|\n| <script>x</script> |",
      "`<script>x</script>`",
      "> <script>x</script>",
      "- <script>x</script>",
    ]) {
      const html = md(text);
      expect(html, text).not.toContain("<script");
    }
  });

  it("never produces an img tag, even for image syntax", () => {
    const html = md("![x](https://a.example/p.png)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("a.example");
  });

  it("drops every unsafe link target but keeps the text", () => {
    const hostile = [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "\tjavascript:alert(1)",
      "data:text/html,<b>x</b>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "//evil.example",
      "/dashboard/",
    ];
    for (const url of hostile) {
      const html = md(`[x](${url})`);
      expect(html, url).not.toMatch(/href=/i);
      expect(html, url).not.toMatch(/href="\s*javascript:/i);
      expect(html, url).toContain("x");
    }
  });

  it("links http, https and mailto with a safe rel", () => {
    const https = md("[x](https://a.example)");
    expect(https).toContain('href="https://a.example"');
    expect(https).toContain('rel="noopener noreferrer"');
    expect(md("[x](http://a.example/p?q=1)")).toContain('href="http://a.example/p?q=1"');
    expect(md("[x](mailto:a@b.example)")).toContain('href="mailto:a@b.example"');
  });

  it("keeps balanced parentheses in a URL and ignores a title", () => {
    expect(md("[x](https://a.example/a_(b))")).toContain('href="https://a.example/a_(b)"');
    expect(md('[x](https://a.example "A title")')).toContain('href="https://a.example"');
  });

  it("does not nest a link inside a link", () => {
    const html = md("[a [b](https://b.example) c](https://a.example)");
    expect(count(html, /<a /g)).toBeLessThanOrEqual(1);
  });

  it("honours a backslash escape", () => {
    expect(md("\\*not bold\\*")).not.toContain("<em>");
    expect(md("\\*not bold\\*")).toContain("*not bold*");
  });
});

describe("Malformed and hostile input (F4)", () => {
  it("renders broken syntax without throwing", () => {
    for (const text of ["**unterminated", "[", "[x](", "[x]", "](", "", "\r\n\r\n", "a\r\nb", "`", "``", "| |", "|", "> ", "- ", "1.", "#", "```", "![", "![x]("]) {
      expect(() => md(text), JSON.stringify(text)).not.toThrow();
    }
  });

  it("normalises CRLF line endings", () => {
    const html = md("# T\r\n\r\n- a\r\n- b\r\n");
    expect(html).toContain("<h1>T</h1>");
    expect(count(html, /<li>/g)).toBe(2);
    expect(html).not.toContain("\r");
  });

  it("parses 200,000 characters of pathological input in under a second", () => {
    const n = 200_000;
    const inputs: Record<string, string> = {
      stars: "*".repeat(n),
      brackets: "[".repeat(n),
      openLinks: "[a](".repeat(n / 4),
      boldNoClose: "**a ".repeat(n / 4),
      emNoClose: "*a ".repeat(n / 3),
      underscores: "_a".repeat(n / 2),
      backticks: "`".repeat(n),
      alternatingTicks: "`a``".repeat(n / 4),
      quotes: "> ".repeat(n / 2),
      nestedQuoteLines: ">".repeat(1000) + "x",
      bullets: "- ".repeat(n / 2),
      bulletLines: "- a\n".repeat(n / 4),
      nestedIndent: "- a\n  - b\n".repeat(n / 10),
      pipes: "|".repeat(n),
      pipeLines: "| a | b |\n".repeat(n / 10),
      spacesHeading: "# " + " ".repeat(n) + "x",
      hashes: "#".repeat(n),
      tableWide: "|a".repeat(n / 2) + "\n" + "|-".repeat(n / 2),
      closedLater: "[a](".repeat(n / 8) + ")".repeat(n / 8),
      images: "![a](".repeat(n / 5),
    };
    let worst = 0;
    for (const [name, text] of Object.entries(inputs)) {
      const t0 = performance.now();
      md(text);
      const ms = performance.now() - t0;
      expect(ms, name).toBeLessThan(1000);
      worst = Math.max(worst, ms);
    }
    expect(worst).toBeLessThan(1000);
  });
});
