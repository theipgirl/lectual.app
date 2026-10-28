import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeadsLoadFailed, NoLeadStages } from "@/app/dashboard/intake/_components/LeadsNotices";
import { LEADS_LOAD_FAILED_BODY, LEADS_LOAD_FAILED_TITLE, NO_LEAD_STAGES } from "@/lib/ui/words";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));

const SENTINEL = "SENTINEL relation crm_lead does not exist";
const root = path.resolve(__dirname, "../..");
const walkSrc = (dir: string): string[] =>
  readdirSyncRecursive(path.join(root, dir));
import fs from "node:fs";
function readdirSyncRecursive(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? readdirSyncRecursive(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("the Leads notices", () => {
  it("the failed-read card has the exact title and body", () => {
    const html = renderToStaticMarkup(<LeadsLoadFailed />);
    expect(html).toContain("Can&#x27;t show your leads right now.");
    expect(html).toContain("Can&#x27;t show your leads right now. Refresh to try again.");
    expect(LEADS_LOAD_FAILED_TITLE).toBe("Can't show your leads right now.");
    expect(LEADS_LOAD_FAILED_BODY).toBe("Can't show your leads right now. Refresh to try again.");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("broken read");
  });

  it("the no-stages card has the exact body and a plain title", () => {
    const html = renderToStaticMarkup(<NoLeadStages />);
    expect(html).toContain("No lead stages yet");
    expect(html).toContain("Your lead stages haven&#x27;t been set up yet. An owner or admin can add them in Settings.");
    expect(NO_LEAD_STAGES).toBe("Your lead stages haven't been set up yet. An owner or admin can add them in Settings.");
  });

  it("the old sentences appear nowhere in src", () => {
    for (const file of walkSrc("src")) {
      const text = fs.readFileSync(file, "utf8");
      expect(text, file).not.toContain("broken read");
      expect(text, file).not.toContain("no pre-conversion stage");
      expect(text, file).not.toContain("not an empty pipeline");
    }
  });
});

describe("the Leads page when the lead read throws", () => {
  beforeEach(() => vi.resetModules());

  it("shows the fixed sentence, not the thrown text, and logs the cause", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("@/lib/pipeline", async (original) => ({
      ...(await original<typeof import("@/lib/pipeline")>()),
      listStages: vi.fn(async () => {
        throw new Error(SENTINEL);
      }),
    }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
    vi.doMock("@/lib/matters", async (original) => ({ ...(await original<typeof import("@/lib/matters")>()), leadActivitySince: vi.fn(async () => []) }));
    vi.doMock("@/lib/queue/lead-pending", () => ({ loadPendingApprovalsByLead: vi.fn(async () => ({ status: "ok", byLead: {} })) }));
    vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
    vi.doMock("@/lib/stage-keeper/read", () => ({ loadAgentMoves: vi.fn(async () => ({ status: "unavailable" })) }));
    vi.doMock("@/lib/intake/stage-decisions-read", () => ({ loadStageDecisions: vi.fn(async () => ({ status: "unavailable" })) }));
    const { default: Page } = await import("@/app/dashboard/intake/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Can&#x27;t show your leads right now. Refresh to try again.");
    expect(html).not.toContain("SENTINEL");
    expect(html).not.toMatch(/empty|Nobody|No leads/i);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("is titled Leads, and the lead page's back link reads Leads", async () => {
    vi.doMock("@/lib/pipeline", async (original) => ({ ...(await original<typeof import("@/lib/pipeline")>()) }));
    const { metadata } = await import("@/app/dashboard/intake/page");
    expect(String(metadata.title)).toBe("Leads · Lectual");
    const lead = fs.readFileSync(path.join(root, "src/app/dashboard/leads/[id]/page.tsx"), "utf8");
    expect(lead).toMatch(/className="lx-back">\s*← \{LEADS_NAME\}/);
    expect(lead).not.toContain("← Intake");
  });
});
