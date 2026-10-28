import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PERF_FORM } from "../intake-forms/helpers/perf-harness";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { nextConfirm } from "@/lib/ui/inline-confirm";
import type { IntakeFormRecord } from "@/lib/intake-forms/store";

/**
 * Sprint 36 part A: the Forms page fixes (ux_audit_admin 12.1 to 12.10).
 */

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"');
const ORIGIN = "https://app.example.test";

async function workspace(over: Partial<IntakeFormRecord> = {}, canEdit = true) {
  vi.resetModules();
  vi.doMock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
  vi.doMock("../../src/app/dashboard/forms/actions", () => ({ saveIntakeFormAction: vi.fn() }));
  const { IntakeFormsWorkspace } = await import("../../src/app/dashboard/forms/_components/IntakeFormsWorkspace");
  return text(
    renderToStaticMarkup(
      <IntakeFormsWorkspace
        form={{ ...PERF_FORM, ...over }}
        orgName="RPB Law"
        packages={{ status: "ok", items: [] }}
        origin={ORIGIN}
        canEdit={canEdit}
        tab="setup"
        range={30}
        performance={null}
        results={null}
      />,
    ),
  );
}

const head = (html: string) => html.slice(html.indexOf('class="lx-page-head ifm-head"'), html.indexOf('<nav class="ifm-tabs"'));
const share = (html: string) => html.slice(html.indexOf('id="ifm-sec-share"'));

describe("builder header (12.2)", () => {
  it("holds the status, a Share jump and Save, and no QR / Copy link / Preview", async () => {
    const h = head(await workspace());
    expect(h).toContain("Live");
    expect(h).toContain('href="#ifm-sec-share"');
    expect(h).toContain("Save changes");
    for (const gone of ["QR code", "Copy link", "Preview"]) expect(h).not.toContain(gone);
    expect(h.match(/<(a|button)[ >]/g)).toHaveLength(3); // the back link, Share and Save
  });

  it("has QR, Copy link and Preview inside the Share section for a live form", async () => {
    const html = share(await workspace());
    const s = html.slice(0, html.indexOf("ifm-save-row"));
    for (const label of ["QR code", "Copy link", "Preview"]) expect(s).toContain(label);
    expect(s).not.toContain("disabled");
  });

  it("shows the not-live sentence and disabled controls for a draft or archived form", async () => {
    for (const status of ["draft", "archived"] as const) {
      const s = share(await workspace({ status }));
      expect(s).toContain("Not live yet. Publish the form to share it.");
      expect(s).toContain('aria-describedby="ifm-notlive"');
      expect(s).not.toContain("utm_source");
    }
  });

  it("puts Save next to the form, after the Share section", async () => {
    const html = await workspace();
    expect(html.indexOf("Save changes", html.indexOf('id="ifm-sec-share"'))).toBeGreaterThan(-1);
  });
});

describe("names (12.3)", () => {
  it("has the tabs Setup, Results, Performance and no Form setup", async () => {
    const html = await workspace();
    const nav = html.slice(html.indexOf('<nav class="ifm-tabs"'), html.indexOf("</nav>", html.indexOf('<nav class="ifm-tabs"')));
    expect([...nav.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1])).toEqual(["Setup", "Results", "Performance"]);
    expect(html).not.toContain("Form setup");
  });
});

describe("assistant, share and compliance wording (12.4 to 12.6)", () => {
  it("drops the roadmap sentence and the field that nothing reads", async () => {
    const html = await workspace();
    expect(html).not.toContain("doesn't chat freely");
    expect(html).not.toContain("What the assistant knows");
  });

  it("says 'Put this on your website' and 'Websites allowed to show this form' with a plain helper", async () => {
    const s = share(await workspace());
    expect(s).toContain("Put this on your website");
    expect(s).toContain("Embed on a website (for your web person)");
    expect(s).toContain("Websites allowed to show this form");
    expect(s).toContain("Leave empty to allow any website. Add your own website to stop others from embedding it.");
    expect(s).toContain('placeholder="yourfirm.com"');
    for (const jargon of ["Allowed domains", "Embed snippet", "example.com or *.example.com", "Any site can embed this."]) expect(s).not.toContain(jargon);
  });

  it("explains why the compliance card is there", async () => {
    expect(await workspace({ receivesReferrals: true })).toContain("This applies because your firm receives referred founders from Lectual.");
    expect(await workspace({ receivesReferrals: false })).not.toContain("Compliance");
  });

  it("lets a viewer copy links but not change the allowed websites", async () => {
    const s = share(await workspace({}, false));
    expect(s).toContain("Copy link");
    expect(s).toMatch(/<fieldset class="ifm-bare" disabled/);
  });
});

describe("the list (12.7 to 12.10)", () => {
  const items = [
    { id: "i1", name: "UGW 2026 booth", slug: "ugw-2026", url: "https://app.example.test/i/ugw-2026", sourceTag: "UGW 2026", kind: "intake" as const, status: "live" as const, stats: { captured: 3, completed: 2, unfinished: 1, median: "4 min", rate: "66.7%" } },
    { id: "i2", name: "Old page", slug: "old", url: "https://app.example.test/i/old", sourceTag: null, kind: "assessment" as const, status: "draft" as const, stats: null },
  ];
  async function list(canEdit = true) {
    vi.resetModules();
    vi.doMock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
    vi.doMock("../../src/app/dashboard/forms/actions", () => ({ createIntakeFormAction: vi.fn(), duplicateIntakeFormAction: vi.fn(), setIntakeArchivedAction: vi.fn() }));
    const { IntakeList } = await import("../../src/app/dashboard/forms/_components/IntakeList");
    return text(renderToStaticMarkup(<IntakeList items={items} canEdit={canEdit} statsFailed={false} />));
  }

  it("the shell label for the Forms pages is Forms and is not repeated beside the h1", async () => {
    const { sectionLabelFor, showSectionLabel } = await import("../../src/lib/section-label");
    expect(sectionLabelFor("/dashboard/forms/")).toBe("Forms");
    expect(sectionLabelFor("/dashboard/forms/?form=abc")).toBe("Forms");
    expect(showSectionLabel("/dashboard/forms/")).toBe(false);
  });

  it("is called Forms, with Results and Performance actions", async () => {
    const html = await list();
    expect(html).toContain('<h1 class="lx-h1">Forms</h1>');
    expect(html).not.toContain("Intake forms");
    expect(html).toContain(">Results<");
    expect(html).toContain(">Performance<");
    expect(html).not.toContain(">Numbers<");
  });

  it("has two create buttons with a one-line explanation each, and no Type select", async () => {
    const html = await list();
    expect(html).toContain("New form");
    expect(html).toContain("New scored assessment (for events)");
    expect(html).toContain("A chat or form that collects contact details and answers.");
    expect(html).toContain("A short scored quiz for a booth or event, with a result for the person.");
    expect(html).not.toContain("<select");
    expect(html).toContain('data-kind="intake"');
    expect(html).toContain('data-kind="assessment"');
    expect(html).not.toContain("New intake");
  });

  it("shows no create buttons to a viewer", async () => {
    expect(await list(false)).not.toContain("New scored assessment");
  });

  it("draws every action as lx-btn-sm lx-btn-ghost and uses no ifl-act", async () => {
    const html = await list();
    expect(html).not.toMatch(/\bifl-act\b/);
    const actions = html.split('class="ifl-actions"').slice(1).map((a) => a.slice(0, a.indexOf("</article>")));
    expect(actions).toHaveLength(2);
    for (const a of actions) {
      const cls = [...a.matchAll(/<(?:a|button)[^>]*class="([^"]+)"/g)].map((m) => m[1]);
      expect(cls.length).toBeGreaterThanOrEqual(4);
      for (const c of cls) expect(c).toContain("lx-btn-sm lx-btn-ghost");
    }
  });

  it("says 'Typical time (median)'", async () => {
    const html = await list();
    expect(html).toContain("<dt>Typical time (median)</dt>");
    expect(html).not.toContain("Median time");
  });

  it("archives through the inline confirm: asking calls nothing, Cancel calls nothing, only Confirm fires", () => {
    expect(nextConfirm("idle", "ask")).toEqual({ state: "asking", fire: false });
    expect(nextConfirm("asking", "cancel")).toEqual({ state: "idle", fire: false });
    expect(nextConfirm("asking", "confirm")).toEqual({ state: "idle", fire: true });
    const asking = renderToStaticMarkup(<InlineConfirm label="Archive" question="Archive it?" confirmLabel="Archive" initial="asking" onConfirm={() => {}} />);
    expect(asking).toContain("Archive it?");
    expect(asking).toContain("Cancel");
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(tsx|ts|css)$/.test(n) ? [p] : [];
  });
}

describe("the Forms sources", () => {
  const files = sources("src/app/dashboard/forms");
  const all = files.map((f) => [f, readFileSync(f, "utf8")] as const);
  it("have no window.confirm, ifl-act or 'Form setup' left", () => {
    for (const [f, s] of all) {
      expect(s, f).not.toContain("window.confirm");
      expect(s, f).not.toMatch(/\bifl-act\b/);
      expect(s, f).not.toContain("Form setup");
    }
  });
  it("say nothing about migrations or table numbers in visible text", () => {
    const page = readFileSync("src/app/dashboard/forms/page.tsx", "utf8");
    expect(page).toContain('"Forms isn\'t switched on for your firm yet"');
    expect(readFileSync("src/app/dashboard/forms/_components/IntakeDrawer.tsx", "utf8")).not.toMatch(/migration/i);
  });
  it("archive calls the action only from the confirm", () => {
    const s = readFileSync("src/app/dashboard/forms/_components/IntakeList.tsx", "utf8");
    expect(s.match(/setIntakeArchivedAction\(i\.id, true\)/g)).toHaveLength(1);
    expect(s).toMatch(/<InlineConfirm[\s\S]*?onConfirm=\{\(\) => run\(\(\) => setIntakeArchivedAction\(i\.id, true\)/);
  });
});

beforeEach(() => vi.restoreAllMocks());
