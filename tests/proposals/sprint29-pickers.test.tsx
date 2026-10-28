import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { WhoIsThisFor } from "@/components/proposal-editor/WhoIsThisFor";
import { buildPicker, proposalLeadRecord, proposalMatterRecord } from "@/lib/proposals/new-picker";
import { preselectedLeadId } from "@/lib/proposals/transcript-lead";
import { ConsultsStrip } from "@/components/proposal-list/ConsultsStrip";

vi.mock("@/app/dashboard/proposals/transcript-actions", () => ({ draftProposalFromUploadAction: vi.fn(), draftProposalFromMeetingAction: vi.fn() }));

const { TranscriptDraft } = await import("@/components/proposal-editor/TranscriptDraft");

/** Sprint 29 C: picker rows, the selected marker, and the transcript form opening on the lead it was opened for. */

const text = (html: string) => html.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");

const lead = (id: string, first: string, last: string, business: string | null, email: string | null) => ({ id, first_name: first, last_name: last, business_name: business, email });
const matter = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: "TM",
  title: null,
  mark_text: "ZEPHYR",
  matter_number: "TM-2026-0001",
  owner_name: "Ana Ruiz",
  ...over,
});

function view(kind: "lead" | "matter", selectedId?: string) {
  return buildPicker({
    kind,
    term: "",
    leads: {
      status: "ok",
      records: [
        proposalLeadRecord(lead("l-1", "Ana", "Ruiz", "Zephyr Co", "ana@zephyr.test")),
        proposalLeadRecord(lead("l-2", "Sam", "Lee", null, "sam@x.test")),
        proposalLeadRecord(lead("l-3", "", "", "Solo Brand LLC", "solo@x.test")),
        proposalLeadRecord(lead("l-4", "", "", null, "only@x.test")),
      ],
    },
    matters: { status: "ok", records: [proposalMatterRecord(matter("m-1")), proposalMatterRecord(matter("m-2", { owner_name: null, mark_text: null, title: "Acme filing" }))] },
    selectedId,
  });
}
const render = (v: ReturnType<typeof view>) => text(renderToStaticMarkup(<WhoIsThisFor view={v} chosen={null} />));

describe("picker rows: a bold name and ONE quieter line", () => {
  it("a lead's name is bold, and its line is business then email, with nothing said twice", () => {
    const rows = view("lead").list;
    if (rows.status !== "ok") throw new Error("expected rows");
    expect(rows.rows.map((r) => [r.name, r.secondary])).toEqual([
      ["Ana Ruiz", "Zephyr Co · ana@zephyr.test"],
      ["Sam Lee", "sam@x.test"],
      ["Solo Brand LLC", "solo@x.test"],
      ["only@x.test", null],
    ]);
    const html = render(view("lead"));
    expect(html).toContain('<span class="pe-who-name">Ana Ruiz</span><span class="pe-who-sub">Zephyr Co · ana@zephyr.test</span>');
    // The email of a lead with nothing else is its name and is not repeated.
    expect(html.match(/only@x\.test/g)).toHaveLength(1);
    expect(html.match(/ana@zephyr\.test/g)).toHaveLength(1);
  });

  it("a matter's name is the client, and its line is the mark then the matter number", () => {
    const rows = view("matter").list;
    if (rows.status !== "ok") throw new Error("expected rows");
    expect(rows.rows.map((r) => [r.name, r.secondary])).toEqual([
      ["Ana Ruiz", "ZEPHYR · TM-2026-0001"],
      ["Acme filing", "TM-2026-0001"],
    ]);
  });

  it("each row is one link with one name span and at most one line span", () => {
    const html = render(view("lead"));
    expect(html.match(/<a href="[^"]*" class="pe-who-row"/g)).toHaveLength(4);
    expect(html.match(/class="pe-who-sub"/g)).toHaveLength(3);
    expect(html).not.toContain(" · Zephyr Co · Zephyr Co");
  });
});

describe("the selected row", () => {
  it("has aria-current and a visible 'Selected' marker; the others have neither", () => {
    const html = render(view("lead", "l-2"));
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="true"[^>]*><span class="pe-who-name">Sam Lee<\/span><span class="pe-who-sub">sam@x\.test<\/span><span class="pe-who-mark">Selected<\/span>/);
    expect(html.match(/pe-who-mark/g)).toHaveLength(1);
    expect(render(view("lead"))).not.toContain("Selected");
  });
});

describe("the picker's styles use design tokens and keep a visible focus", () => {
  const css = readFileSync("src/app/dashboard/proposals/proposals.css", "utf8");
  const rules = css.split("\n").filter((line) => /\.pe-who/.test(line));

  it("no hex colour or rgb literal in the picker rules", () => {
    for (const line of rules) expect(line, line).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("focus-visible is drawn with the ox token on the whole row", () => {
    expect(css).toMatch(/\.pe-who a:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ox\)/);
  });

  it("every colour variable it uses is defined in globals.css", () => {
    const globals = readFileSync("src/app/globals.css", "utf8");
    for (const name of new Set(rules.flatMap((l) => [...l.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1])))) expect(globals, name).toContain(`${name}:`);
  });
});

describe("the transcript form opens on the lead it was opened for", () => {
  const leads = [
    { id: "lead-1", label: "Melvin Larry" },
    { id: "lead-2", label: "Rayn Other" },
  ];
  const form = (props: Record<string, unknown>) => text(renderToStaticMarkup(<TranscriptDraft leads={leads} maxChars={5000} {...props} />));

  it("?lead=<id> pre-selects that lead", () => {
    expect(preselectedLeadId("lead-2", leads)).toBe("lead-2");
    const html = form({ defaultLeadId: preselectedLeadId("lead-2", leads) });
    expect(html).toMatch(/<option value="lead-2" selected="">Rayn Other<\/option>/);
    expect(html).not.toMatch(/<option value="lead-1" selected/);
  });

  it("an id that is not in the list (another firm's, malformed, repeated wrongly, or none) leaves the prompt selected", () => {
    for (const requested of ["nobody", "", undefined, ["bad", "lead-1"], " lead-1x "]) expect(preselectedLeadId(requested as never, leads)).toBe("");
    expect(preselectedLeadId(["lead-1", "lead-2"], leads)).toBe("lead-1");
    const html = form({ defaultLeadId: preselectedLeadId("not-mine", leads) });
    expect(html).not.toMatch(/<option value="lead-\d"[^>]*selected/);
    expect(html).toMatch(/<option value="" disabled="" selected="">Choose the lead this call was with/);
  });

  it("a defaultLeadId that is not in the list is ignored by the form itself", () => {
    expect(form({ defaultLeadId: "stranger" })).not.toMatch(/<option value="lead-\d"[^>]*selected/);
  });

  it("the page reads ?lead=, passes it to the form and opens the strip's paste form", () => {
    const page = readFileSync("src/app/dashboard/proposals/page.tsx", "utf8");
    expect(page).toContain("preselectedLeadId(sp.lead, leadsRead.leads)");
    expect(page).toContain("defaultLeadId={preselected}");
    expect(page).toContain("pasteOpen={");
    const strip = text(
      renderToStaticMarkup(
        <ConsultsStrip
          data={{ header: { title: "Consults", status: { kind: "ok", text: "Zoom connected" } }, meetings: { status: "ok", rows: [], more: 0 } } as never}
          canDraft
          draftNote={null}
          paste={<p>form</p>}
          pasteOpen
        />,
      ),
    );
    expect(strip).toContain('<details class="pq-paste" open="">');
    const closed = text(
      renderToStaticMarkup(
        <ConsultsStrip data={{ header: { title: "Consults", status: { kind: "ok", text: "x" } }, meetings: { status: "ok", rows: [], more: 0 } } as never} canDraft draftNote={null} paste={<p>form</p>} />,
      ),
    );
    expect(closed).toContain('<details class="pq-paste">');
  });
});
