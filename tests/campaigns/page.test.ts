import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The campaign builder page, rendered — only the "Enroll a lead from Intake"
 * picker. A lead who is already a client (signed, paid, a matter opened, a won
 * stage) must not be offered, because enrolling them is refused; the refusal in
 * `enrollLead` stays the real guard (tests/campaigns/stop-triggers.test.ts pins
 * that the picker's list and that refusal agree). What is pinned here is the
 * page: it leaves them out, asks in ONE batched call rather than once per lead,
 * says so when it could not ask, and does not ask when no picker is drawn.
 */

type Lead = { id: string; first_name: string; last_name: string; business_name: string | null; email: string | null };

const SEQUENCE_ID = "3f9a1c00-0000-4000-8000-000000000001";

const h = vi.hoisted(() => ({
  role: "attorney" as string | null,
  leads: [] as unknown[],
  enrolled: [] as { lead_id: string }[],
  leadsFail: false,
  enrollmentsFail: false,
  clients: { status: "ok", clients: new Map() } as unknown,
  clientCalls: [] as string[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/current-role", () => ({ currentRole: async () => h.role }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/pipeline", () => ({
  listLeads: async () => {
    if (h.leadsFail) throw new Error("leads down");
    return h.leads;
  },
}));
vi.mock("@/lib/automation", () => ({
  AUTOMATION_ADMIN_ROLES: ["owner", "admin", "senior_admin"],
  AUTOMATION_STAFF_ROLES: ["owner", "admin", "senior_admin", "attorney", "paralegal"],
  getSequence: async () => ({ id: SEQUENCE_ID, name: "UGW nurture", description: "", active: true }),
  listSteps: async () => [],
  listTemplates: async () => [],
  listEnrollments: async () => {
    if (h.enrollmentsFail) throw new Error("enrollments down");
    return h.enrolled;
  },
  findClientLeads: async (ids: string[]) => {
    h.clientCalls.push(ids);
    if (h.clients instanceof Error) throw h.clients;
    return h.clients;
  },
}));
// The client forms import the page's server actions, which pull in the whole write path.
vi.mock("@/app/dashboard/campaigns/[id]/actions", () => {
  const action = async () => ({});
  return {
    addStepAction: action,
    advanceEnrollmentAction: action,
    deleteStepAction: action,
    enrollLeadAction: action,
    pauseEnrollmentAction: action,
    resumeEnrollmentAction: action,
    stopEnrollmentAction: action,
    toggleSequenceAction: action,
    updateSequenceDetailsAction: action,
  };
});

const { default: Page } = await import("@/app/dashboard/campaigns/[id]/page");

const lead = (id: string, first: string, email: string | null = `${id}@example.com`): Lead => ({
  id,
  first_name: first,
  last_name: "Lead",
  business_name: null,
  email,
});

async function render(): Promise<string> {
  const element = await Page({ params: Promise.resolve({ id: SEQUENCE_ID }) });
  return renderToStaticMarkup(element);
}

/** The lead ids the picker offers, in order. */
function offered(html: string): string[] {
  const select = /<select[^>]*name="leadId"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  if (!select) throw new Error("no lead picker on the page");
  return [...select[1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
}

beforeEach(() => {
  h.role = "attorney";
  h.leads = [lead("l-open", "Open"), lead("l-signed", "Signed"), lead("l-matter", "Matter"), lead("l-enrolled", "Enrolled"), lead("l-plain", "Plain")];
  h.enrolled = [{ lead_id: "l-enrolled" }];
  h.leadsFail = false;
  h.enrollmentsFail = false;
  h.clients = {
    status: "ok",
    clients: new Map([
      ["l-signed", { reason: "signed", at: "2026-10-03T21:10:00Z" }],
      ["l-matter", { reason: "matter_opened", at: "2026-10-05T09:00:00Z" }],
    ]),
  };
  h.clientCalls = [];
});

describe("campaign page — who the enroll picker offers", () => {
  it("leaves out leads who are already clients, and those already enrolled in this campaign", async () => {
    const html = await render();
    expect(offered(html)).toEqual(["l-open", "l-plain"]);
    expect(html).not.toContain("Signed Lead");
    expect(html).not.toContain("Matter Lead");
  });

  it("asks about the clients once, for the leads it would otherwise offer — not once per lead", async () => {
    await render();
    expect(h.clientCalls).toHaveLength(1);
    // Already-enrolled leads are not asked about: they are out of the picker anyway.
    expect(h.clientCalls[0]).toEqual(["l-open", "l-signed", "l-matter", "l-plain"]);
  });

  it("offers everyone not enrolled when nobody is a client", async () => {
    h.clients = { status: "ok", clients: new Map() };
    const html = await render();
    expect(offered(html)).toEqual(["l-open", "l-signed", "l-matter", "l-plain"]);
    expect(html).not.toContain("Couldn&#x27;t check which leads are already clients");
  });

  it("when the clients can't be read it still lists them and says so — a failed read is not 'no clients'", async () => {
    h.clients = { status: "unavailable", error: "quote read failed" };
    const html = await render();
    expect(offered(html)).toEqual(["l-open", "l-signed", "l-matter", "l-plain"]);
    expect(html).toContain("Couldn&#x27;t check which leads are already clients");
  });

  it("says so too when the read itself throws", async () => {
    h.clients = new Error("scoped client down");
    const html = await render();
    expect(offered(html)).toEqual(["l-open", "l-signed", "l-matter", "l-plain"]);
    expect(html).toContain("Couldn&#x27;t check which leads are already clients");
  });

  it("does not ask when there is nobody left to offer", async () => {
    h.leads = [lead("l-enrolled", "Enrolled")];
    const html = await render();
    expect(h.clientCalls).toHaveLength(0);
    expect(offered(html)).toEqual([]);
  });

  it("does not ask when no picker is drawn (a view-only role, or the leads or enrollments couldn't be read)", async () => {
    h.role = "viewer";
    expect(await render()).not.toContain('name="leadId"');

    h.role = "attorney";
    h.leadsFail = true;
    expect(await render()).toContain("Leads couldn&#x27;t be loaded");

    h.leadsFail = false;
    h.enrollmentsFail = true;
    expect(await render()).toContain("Who&#x27;s already enrolled couldn&#x27;t be loaded");

    expect(h.clientCalls).toHaveLength(0);
  });
});
