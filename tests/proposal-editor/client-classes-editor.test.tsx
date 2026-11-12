import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/dashboard/proposals/[id]/actions", () => ({ addNameAction: vi.fn(), removeNameAction: vi.fn() }));

import { NameCard, NameRowsProvider, type NameValues } from "@/components/proposal-editor/Sections";
import { parseName } from "@/lib/proposal-editor/form";
import { brandForm } from "@/lib/proposal-editor/save-draft";
import { DEFAULT_CLIENT_ENTRY_PROMPT } from "@/lib/proposals/client-classes";
import { sevetri } from "../proposals/fixture";

/** The page builds NameValues from the stored brand name exactly like this (proposals/[id]/page.tsx). */
const VALUE: NameValues = {
  id: "p",
  name: "Prosperall",
  what: "",
  note: "",
  overrideBase: "",
  overridePerClass: "",
  marks: [{ id: "p-word", kind: "word", desc: "Words only", preselected: true }],
  classes: [
    { id: "p-c1", label: "Software", preselected: true, clientEntry: false },
    { id: "p-c2", label: DEFAULT_CLIENT_ENTRY_PROMPT, preselected: true, clientEntry: true },
  ],
  clientAddMax: "3",
};

function render(value: NameValues = VALUE) {
  return renderToStaticMarkup(
    <NameRowsProvider names={[value]}>
      <NameCard index={0} editable issues={[]} value={value} packageName="Essential" firmPackages={["Essential", "Concierge"]} brandCount={1} />
    </NameRowsProvider>,
  );
}

/** What the browser would post from the rendered inputs (names and values; checkboxes only when checked). */
function postedForm(html: string): FormData {
  const f = new FormData();
  for (const m of html.matchAll(/<input([^>]*)>/g)) {
    const attrs = m[1];
    const name = /name="([^"]+)"/.exec(attrs)?.[1];
    if (!name) continue;
    const isBox = /type="checkbox"/.test(attrs);
    if (isBox && !/checked=""/.test(attrs)) continue;
    const value = isBox ? "on" : (/value="([^"]*)"/.exec(attrs)?.[1] ?? "");
    f.append(name, value);
  }
  // The editor posts every brand under `b.<n>.`; the save strips the prefix and hands the brand parser what it always read.
  return brandForm(f, 0);
}

describe("editor: Let the client describe this / Let the client add classes", () => {
  it("draws a 'Let the client describe this' box per class, checked for an open one, and the add-classes number", () => {
    const html = render();
    expect(html.match(/<span>Let the client describe this<\/span>/g)?.length).toBe(2);
    expect(html).toMatch(/<input type="checkbox" name="b\.0\.class\.1\.clientEntry" checked=""\/>/);
    expect(html).toMatch(/<input type="checkbox" name="b\.0\.class\.0\.clientEntry"\/>/);
    expect(html).toContain('aria-label="Question the client answers"');
    const tag = /<input[^>]*name="b.0.clientAddMax"[^>]*>/.exec(html)?.[0] ?? "";
    expect(tag).toContain('type="number"');
    expect(tag).toContain('min="0"');
    expect(tag).toContain('max="10"');
    expect(tag).toContain('value="3"');
    expect(tag).toContain('aria-describedby="pe-client-add-p"');
    expect(html).toContain("Let the client add classes");
  });

  it("round-trips: what the card posts parses back to the same open class and client_add", () => {
    const content = sevetri();
    const form = postedForm(render());
    form.set("mark.0.kind", "word"); // a <select>, which the input scan above does not read
    const r = parseName(form, content, () => "x");
    if (!r.ok) throw new Error(r.error);
    expect(r.value.classes).toEqual([
      { id: "p-c1", label: "Software", preselected: true },
      { id: "p-c2", label: DEFAULT_CLIENT_ENTRY_PROMPT, preselected: true, client_entry: true },
    ]);
    expect(r.value.client_add).toEqual({ max: 3 });
  });

  it("the default: no open class and a blank number post no client_add (5, or none on a fixed offer)", () => {
    const value: NameValues = { ...VALUE, classes: [{ id: "p-c1", label: "Software", preselected: true }], clientAddMax: "" };
    const html = render(value);
    expect(html).toMatch(/<input[^>]*name="b.0.clientAddMax"[^>]*value=""/);
    expect(html).toContain("Blank is the default: up to 5");
    const form = postedForm(html);
    form.set("mark.0.kind", "word"); // a <select>, which the input scan above does not read
    const r = parseName(form, sevetri(), () => "x");
    if (!r.ok) throw new Error(r.error);
    expect("client_add" in r.value).toBe(false);
    expect(r.value.classes).toEqual([{ id: "p-c1", label: "Software", preselected: true }]);
  });
});
