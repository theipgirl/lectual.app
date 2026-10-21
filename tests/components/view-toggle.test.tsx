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
  /** The one anchor with this label, as a string, so attribute order doesn't matter. */
  const anchor = (markup: string, label: string) => markup.match(new RegExp(`<a [^>]*>${label}</a>`))?.[0] ?? "";
  const html = renderToStaticMarkup(<ViewToggle value="board" hrefFor={hrefFor} />);

  it("renders two anchors labelled Table and Board, with the hrefs the builder returns", () => {
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(anchor(html, "Table")).toContain('href="/x"');
    expect(anchor(html, "Board")).toContain('href="/x?view=board"');
    expect(html).not.toContain("<button");
  });

  it("marks the current one, and only that one, with aria-current and `on`", () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html.match(/class="on"/g)).toHaveLength(1);
    expect(anchor(html, "Board")).toContain('aria-current="page"');
    expect(anchor(html, "Board")).toContain('class="on"');
    expect(anchor(html, "Table")).not.toContain("aria-current");
    expect(anchor(html, "Table")).not.toContain("class=");
  });

  it("sits in a nav carrying the shared classes", () => {
    expect(html).toMatch(/^<nav class="lx-segs lx-view-toggle" aria-label="View">/);
  });

  it("marks Table current when the value is table", () => {
    const table = renderToStaticMarkup(<ViewToggle value="table" hrefFor={hrefFor} />);
    expect(anchor(table, "Table")).toContain('aria-current="page"');
    expect(anchor(table, "Table")).toContain('class="on"');
    expect(anchor(table, "Board")).not.toContain("aria-current");
  });
});

describe("ViewToggle, controlled mode", () => {
  it("renders two buttons whose aria-pressed matches the value, inside the same classes", () => {
    const html = renderToStaticMarkup(<ViewToggle value="board" onChange={() => {}} />);
    expect(html).toMatch(/^<div class="lx-segs lx-view-toggle" role="group" aria-label="View">/);
    expect(html).toMatch(/<button type="button" aria-pressed="false">Table<\/button>/);
    expect(html).toMatch(/<button type="button" aria-pressed="true" class="on">Board<\/button>/);
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
    click("Table");
    expect(onChange).toHaveBeenLastCalledWith("table");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe("ViewToggle, shared look", () => {
  it("uses the same wrapper classes in both modes", () => {
    const link = renderToStaticMarkup(<ViewToggle value="table" hrefFor={() => "/"} />);
    const controlled = renderToStaticMarkup(<ViewToggle value="table" onChange={() => {}} />);
    for (const html of [link, controlled]) expect(html).toContain('class="lx-segs lx-view-toggle"');
  });
});
