import { describe, it, expect, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ViewToggle } from "@/components/ViewToggle";

/** Every element in a returned tree, depth first. */
function walk(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((child) => walk(child, out));
  else if (node && typeof node === "object" && "props" in node) {
    out.push(node as ReactElement);
    walk((node as ReactElement<{ children?: ReactNode }>).props.children, out);
  }
  return out;
}

describe("ViewToggle, link mode", () => {
  const hrefFor = (view: "table" | "board") => (view === "board" ? "/x?view=board" : "/x");
  const anchor = (markup: string, label: string) => markup.match(new RegExp(`<a [^>]*>${label}</a>`))?.[0] ?? "";
  const html = renderToStaticMarkup(<ViewToggle value="board" hrefFor={hrefFor} />);

  it("renders two anchors labelled Board and List, Board first, with the hrefs the builder returns", () => {
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(anchor(html, "List")).toContain('href="/x"');
    expect(html.indexOf(">Board<")).toBeLessThan(html.indexOf(">List<"));
    expect(anchor(html, "Board")).toContain('href="/x?view=board"');
    expect(html).not.toContain("<button");
  });

  it("marks the current one, and only that one, with aria-current=page", () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(anchor(html, "Board")).toContain('aria-current="page"');
    expect(anchor(html, "List")).not.toContain("aria-current");
  });

  it("sits in a labelled nav of the one shared pill", () => {
    expect(html).toMatch(/^<nav class="vs-switch" aria-label="View"/);
  });

  it("takes any options and a label: Weekly review's three, the deck's own hrefs, and the calendar's two", () => {
    const three = renderToStaticMarkup(
      <ViewToggle value="sheet" label="Deck view" views={[{ value: "board", label: "Board" }, { value: "sheet", label: "List", href: "/own" }, { value: "cards", label: "Cards" }]} hrefFor={(v) => `/r?view=${v}`} />,
    );
    expect(three.match(/<a /g)).toHaveLength(3);
    expect(three).toContain('aria-label="Deck view"');
    expect(three).toContain('href="/own"');
    expect(three).toContain('href="/r?view=cards"');
    expect(anchor(three, "List")).toContain('aria-current="page"');
  });
});

describe("ViewToggle, controlled mode", () => {
  it("renders two buttons whose aria-current matches the value, inside the same pill", () => {
    const html = renderToStaticMarkup(<ViewToggle value="board" onChange={() => {}} />);
    expect(html).toMatch(/^<div class="vs-switch" role="group" aria-label="View"/);
    expect(html).toMatch(/<button type="button">List<\/button>/);
    expect(html).toMatch(/<button type="button" aria-current="true">Board<\/button>/);
    expect(html).not.toContain("<a ");
  });

  it("calls the change handler with 'table' and 'board' from each button's click handler", () => {
    const onChange = vi.fn();
    const buttons = walk(ViewToggle({ value: "table", onChange })).filter((el) => el.type === "button");
    expect(buttons).toHaveLength(2);
    const click = (label: string) => {
      const button = buttons.find((el) => el.props && (el.props as { children?: ReactNode }).children === label)!;
      (button.props as { onClick: () => void }).onClick();
    };
    click("Board");
    expect(onChange).toHaveBeenLastCalledWith("board");
    click("List");
    expect(onChange).toHaveBeenLastCalledWith("table");
  });
});

describe("ViewToggle, shared look", () => {
  it("uses the same wrapper class in both modes", () => {
    const link = renderToStaticMarkup(<ViewToggle value="table" hrefFor={() => "/"} />);
    const controlled = renderToStaticMarkup(<ViewToggle value="table" onChange={() => {}} />);
    for (const html of [link, controlled]) expect(html).toContain('class="vs-switch"');
  });
});
