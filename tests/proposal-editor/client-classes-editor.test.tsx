import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/dashboard/proposals/[id]/actions", () => ({
  addNameAction: vi.fn(),
  removeNameAction: vi.fn(),
  saveAdjustmentsAction: vi.fn(),
  saveDetailsAction: vi.fn(),
  saveIncludesAction: vi.fn(),
  saveMessageAction: vi.fn(),
  saveNameAction: vi.fn(),
  savePricingAction: vi.fn(),
}));

import { NameCard, NameRowsProvider, type NameValues } from "@/components/proposal-editor/Sections";
import { parseName } from "@/lib/proposal-editor/form";
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
      <NameCard proposalId="prop-1" updatedAt="t" editable issues={[]} value={value} packageName="Essential" />
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
  return f;
}

describe("editor: Client describes this class / Let the client add classes", () => {
  it("draws a 'Client describes this class' box per class, checked for an open one, and the add-classes number", () => {
    const html = render();
    expect(html.match(/<span>Client describes this class<\/span>/g)?.length).toBe(2);
    expect(html).toMatch(/<input type="checkbox" name="class\.1\.clientEntry" checked=""\/>/);
    expect(html).toMatch(/<input type="checkbox" name="class\.0\.clientEntry"\/>/);
    expect(html).toContain('aria-label="Question the client answers"');
    const tag = /<input[^>]*name="clientAddMax"[^>]*>/.exec(html)?.[0] ?? "";
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
    form.set("nameId", "p");
    form.set("name", "Prosperall");
    form.set("mark.0.kind", "word"); // a <select>, which the input scan above does not read
    const r = parseName(form, content, () => "x");
    if (!r.ok) throw new Error(r.error);
    expect(r.value.classes).toEqual([
      { id: "p-c1", label: "Software", preselected: true },
      { id: "p-c2", label: DEFAULT_CLIENT_ENTRY_PROMPT, preselected: true, client_entry: true },
    ]);
    expect(r.value.client_add).toEqual({ max: 3 });
  });

  it("off by default: no open class and 0 posts no client_add", () => {
    const value: NameValues = { ...VALUE, classes: [{ id: "p-c1", label: "Software", preselected: true }], clientAddMax: undefined };
    const html = render(value);
    expect(html).toMatch(/name="clientAddMax"[^>]*value="0"/);
    const form = postedForm(html);
    form.set("nameId", "p");
    form.set("name", "Prosperall");
    form.set("mark.0.kind", "word"); // a <select>, which the input scan above does not read
    const r = parseName(form, sevetri(), () => "x");
    if (!r.ok) throw new Error(r.error);
    expect("client_add" in r.value).toBe(false);
    expect(r.value.classes).toEqual([{ id: "p-c1", label: "Software", preselected: true }]);
  });
});
