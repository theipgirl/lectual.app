import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BoardCard } from "@/components/ui/Board";

const globals = readFileSync("src/app/globals.css", "utf8");
const rule = (selector: string) => {
  const i = globals.indexOf(`${selector} {`);
  expect(i, selector).toBeGreaterThan(-1);
  return globals.slice(i, globals.indexOf("}", i));
};

describe("a board card shows its name and its quiet line", () => {
  it("the name wraps to two lines, never one line cut with an ellipsis", () => {
    const title = rule(".lx-board-card-title");
    expect(title).not.toMatch(/white-space:\s*nowrap/);
    expect(title).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(title).toMatch(/-webkit-line-clamp:\s*2/);
  });

  it("the quiet line under the name wraps too", () => {
    const meta = rule(".lx-board-card-meta");
    expect(meta).not.toMatch(/white-space:\s*nowrap/);
    expect(meta).not.toMatch(/text-overflow:\s*ellipsis/);
  });

  it("a chip that does not fit beside the name drops under it", () => {
    expect(rule(".lx-board-card-top")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("a card with a menu and no foot line leaves no empty strip at its foot", () => {
    const html = renderToStaticMarkup(createElement(BoardCard, { href: "/m/1", title: "Acme", chip: createElement("span", null, "7d"), menu: createElement("button", null, "...") }));
    expect(html).not.toContain("lx-board-card-foot");
    expect(html).toContain("lx-board-card-chiprow");
    const noChip = renderToStaticMarkup(createElement(BoardCard, { href: "/m/1", title: "Acme", menu: createElement("button", null, "...") }));
    expect(noChip).not.toContain("lx-board-card-foot");
  });

  it("a card with a foot line keeps the menu on it", () => {
    const html = renderToStaticMarkup(createElement(BoardCard, { href: "/m/1", title: "Acme", foot: "Review", menu: createElement("button", null, "...") }));
    expect(html).toContain("lx-board-card-foot");
  });
});
