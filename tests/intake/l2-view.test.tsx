import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CompareView from "@/app/dashboard/intake/_components/CompareView";
import { shapeCompareSide } from "@/lib/intake/compare";

const lead = (id: string) => ({ id, first_name: "Dominique", last_name: id === "a" ? "Okonkwo" : "Okonkwo-Reyes", business_name: "Textiles", mark_text: null, email: "d@example.test", referral_source: "UGW", created_at: "2026-09-03T15:00:00Z" });
const counts = { timeline: { status: "ok" as const, count: 4 }, tasks: { status: "unavailable" as const }, proposals: { status: "off" as const } };
const html = (state: Parameters<typeof CompareView>[0]["state"]) => renderToStaticMarkup(<CompareView state={state} titleId="t1" />);

describe("the compare panel", () => {
  it("is a labelled modal dialog with Close, both leads side by side, a link to each and NO merge action", () => {
    const out = html({ status: "ok", data: { a: shapeCompareSide(lead("a"), { status: "ok", name: "Follow-Up" }, counts, { now: new Date("2026-11-10T14:00:00Z") }), b: shapeCompareSide(lead("b"), { status: "ok", name: "Follow-Up" }, counts, { now: new Date("2026-11-10T14:00:00Z") }) } });
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain('aria-labelledby="t1"');
    expect(out).toContain("Close");
    expect(out).toContain("Dominique Okonkwo-Reyes");
    expect(out).toMatch(/href="\/dashboard\/leads\/a\/?"/);
    expect(out).toMatch(/href="\/dashboard\/leads\/b\/?"/);
    expect(out).toContain("Couldn&#x27;t load");
    expect(out).toContain("Nothing is merged here");
    expect(out).not.toMatch(/merge<|Merge/);
  });
  it("loading, failed and gone are their own words, never an empty comparison", () => {
    expect(html({ status: "loading" })).toContain("Loading both leads");
    expect(html({ status: "failed", error: "Can't show these leads right now. Close this and try again." })).toContain('role="alert"');
    expect(html({ status: "ok", data: { a: { status: "gone", id: "a" }, b: shapeCompareSide(lead("b"), { status: "ok", name: "S" }, counts, { now: new Date("2026-11-10T14:00:00Z") }) } })).toContain("This lead couldn&#x27;t be found");
  });
});

describe("source guards", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  it("the compare action resolves the role before any read, and counts proposals only for the proposals roles", () => {
    const src = read("src/app/dashboard/intake/actions.ts");
    const body = src.slice(src.indexOf("export async function loadCompareAction"));
    expect(body.indexOf("resolveCurrentRole(db)")).toBeGreaterThan(-1);
    expect(body.indexOf("resolveCurrentRole(db)")).toBeLessThan(body.indexOf("loadCompare("));
    expect(body).toContain("rules.mayCountProposals");
    expect(body).toContain("showEmail: rules.showEmail");
  });
  it("the Geist override is the Leads workspace's class only, not .intake-root (Reconcile keeps its look)", () => {
    expect(read("src/app/dashboard/intake/leads.css")).not.toContain(".intake-root.intake-root");
    expect(read("src/app/dashboard/intake/_components/IntakeWorkspace.tsx")).toContain('className="lp-root ix-leads"');
  });
  it("the error row's status role is on an inner div, and the screen-reader words come from the glossary", () => {
    const t = read("src/app/dashboard/intake/_components/IntakeTable.tsx");
    expect(t).toContain('<div role="status">{error}</div>');
    expect(t).not.toMatch(/<td[^>]*role="status"/);
    expect(t).not.toContain(">Actions<");
    expect(read("src/app/dashboard/intake/_components/CompareView.tsx")).not.toContain(">Field<");
  });
  it("the resize handle ends a drag on cancel and lost capture, and carries aria-valuenow/min/max", () => {
    expect(read("src/app/dashboard/intake/_components/useColWidths.ts")).toMatch(/pointercancel[\s\S]*lostpointercapture/);
    const t = read("src/app/dashboard/intake/_components/IntakeTable.tsx");
    for (const a of ["aria-valuenow", "aria-valuemin", "aria-valuemax"]) expect(t).toContain(a);
  });
});

describe("css rules", () => {
  const css = readFileSync("src/app/dashboard/intake/leads.css", "utf8");
  it("has no dark block at all (the dashboard is light-only; a dark OS must not get dark pills on the cream page)", () => {
    expect(css).not.toContain("prefers-color-scheme");
    expect(css).not.toContain('data-theme="dark"');
  });
  it("the card scrolls by default and is overflow visible only after a measurement said the table fits", () => {
    const table = readFileSync("src/app/dashboard/intake/_components/IntakeTable.tsx", "utf8");
    expect(table).toContain("useState(true)");
    expect(css).toContain('.ix-sheet .rse-scroll[data-scroll="false"] { overflow: visible; }');
    expect(css).not.toMatch(/\.ix-sheet \.rse-scroll\s*\{[^}]*overflow:\s*visible/);
  });
  it("the Intake-only 13px header and the 14px phone controls are scoped, and the Sheet's CSS file is untouched by them", () => {
    expect(css).toContain(".ix-leads .rv-owner .rse-tbl thead th");
    expect(css).toMatch(/max-width: 640px\) \{\s*\.ix-marker-dup, \.ix-temp, \.ix-card \.ix-touch, \.ix-cmp-note, \.ix-cmp-close, \.ix-cmp-table tbody th \{ font-size: 14px; \}/);
  });
  it("a drag in progress is torn down when the table unmounts", () => {
    const h = readFileSync("src/app/dashboard/intake/_components/useColWidths.ts", "utf8");
    expect(h).toContain("teardown.current?.()");
  });
});

describe("one typeface and the colours (CSS)", () => {
  const css = readFileSync("src/app/dashboard/intake/leads.css", "utf8");
  it("the Leads page overrides every mono variable to Geist, and the file names no Courier or monospace", () => {
    expect(css).not.toMatch(/courier-prime\), monospace/);
    const block = css.slice(css.indexOf(".ix-leads.ix-leads"));
    for (const v of ["--font-courier-prime", "--font-jetbrains-mono", "--font-mono", "--mono"]) expect(block).toContain(`${v}: var(--font-geist)`);
  });
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // The temperature colours are defined once, in globals.css :root (light only). The assistant chip uses the shared --ok and --tint-ok.
  const globals = readFileSync("src/app/globals.css", "utf8");
  const tokens = () => {
    const m = /:root \{([\s\S]*?)\n\}/.exec(globals);
    if (!m) throw new Error("scope");
    return Object.fromEntries([...m[1].matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/g)].map((x) => [x[1], x[2]]));
  };
  it("temperature text reaches 4.5:1 on its own background (light), filled and outlined", () => {
    const t = tokens();
    for (const tone of ["hot", "warm", "cold"]) {
      expect(ratio(t[`tp-${tone}-fg`], t[`tp-${tone}-bg`]), `${tone} filled`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t[`tp-${tone}-fg`], t["card"]), `${tone} outlined`).toBeGreaterThanOrEqual(4.5);
    }
    expect(css).toContain("--asst-fg: var(--ok)");
    expect(css).toContain("--asst-bg: var(--tint-ok)");
  });
});
