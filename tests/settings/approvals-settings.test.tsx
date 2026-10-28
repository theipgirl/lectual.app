import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MEMBERS, U } from "../queue/routing-fixtures";

const state = vi.hoisted(() => ({
  role: "owner" as string | null,
  proposals: true,
  settings: null as null | Record<string, unknown>,
  directory: [] as unknown[],
  directoryFails: false,
  settingsFail: false,
  saved: [] as unknown[],
}));

vi.mock("@/lib/auth/current-role", () => ({ currentRole: async () => state.role }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: async () => state.proposals }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/members/directory", () => ({
  listMemberDirectory: async () => {
    if (state.directoryFails) throw new Error("down");
    return state.directory;
  },
}));
vi.mock("@/lib/proposals/store", () => ({
  getProposalSettings: async () => {
    if (state.settingsFail) throw new Error("down");
    return state.settings;
  },
  saveProposalSettings: async (input: unknown) => {
    state.saved.push(input);
    return {};
  },
}));

const directory = MEMBERS.map((m) => ({ userId: m.userId, email: m.email, displayName: m.displayName, role: m.role, identified: true }));

function form(fields: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
}

beforeEach(() => {
  state.role = "owner";
  state.proposals = true;
  state.directory = directory;
  state.directoryFails = false;
  state.settingsFail = false;
  state.saved = [];
  state.settings = {
    org_id: "o",
    approver_user_ids: [U.rebecca],
    default_pay_url: "https://pay.example.com",
    notify_email: "a@example.com",
    pricing: { lawmatics_loe_fields: { enabled: true }, packages: [{ package: "Basic" }], approval_routing: { welcome_email: U.caitlyn } },
  };
});

describe("saveApprovalRoutingAction", () => {
  async function run(fields: [string, string][]) {
    const { saveApprovalRoutingAction } = await import("@/app/dashboard/settings/approvals/actions");
    return saveApprovalRoutingAction({}, form(fields));
  }

  it("saves valid picks, keeping approvers, pay link, notify address and every other pricing key", async () => {
    const r = await run([["kind.stalled_followup", U.caitlyn], ["kind.post_consult_email", U.rebecca], ["kind.welcome_email", ""]]);
    expect(r).toEqual({ saved: true });
    expect(state.saved).toEqual([
      {
        approverUserIds: [U.rebecca],
        defaultPayUrl: "https://pay.example.com",
        notifyEmail: "a@example.com",
        pricing: {
          lawmatics_loe_fields: { enabled: true },
          packages: [{ package: "Basic" }],
          approval_routing: { stalled_followup: U.caitlyn, post_consult_email: U.rebecca },
        },
      },
    ]);
  });

  it("creates the row with no approvers when none exists", async () => {
    state.settings = null;
    expect(await run([["kind.welcome_email", U.caitlyn]])).toEqual({ saved: true });
    expect(state.saved[0]).toEqual({ approverUserIds: [], defaultPayUrl: null, notifyEmail: null, pricing: { approval_routing: { welcome_email: U.caitlyn } } });
  });

  it.each([
    ["a non-member id", [["kind.stalled_followup", U.ghost]] as [string, string][], /isn't on your team/],
    ["an attorney-only kind routed to a paralegal", [["kind.engagement_letter", U.caitlyn]] as [string, string][], /attorney or an owner/],
    ["an unknown kind", [["kind.made_up", U.rebecca]] as [string, string][], /isn't one of the options/],
    ["a viewer as owner", [["kind.internal_briefing", U.viewer]] as [string, string][], /can't go to/],
  ])("refuses %s and saves nothing", async (_n, fields, message) => {
    const r = await run(fields);
    expect(r.error).toMatch(message);
    expect(state.saved).toEqual([]);
  });

  it("refuses a caller below the admin tier, signed out, and a firm without the feature", async () => {
    for (const role of ["attorney", "paralegal", "viewer", null]) {
      state.role = role;
      expect((await run([["kind.welcome_email", U.caitlyn]])).error).toMatch(/Senior admin or above/);
    }
    state.role = "admin";
    state.proposals = false;
    expect((await run([["kind.welcome_email", U.caitlyn]])).error).toMatch(/isn't switched on for your firm yet/);
    expect(state.saved).toEqual([]);
  });

  it("an unreadable member list or unreadable settings saves nothing", async () => {
    state.directoryFails = true;
    expect((await run([["kind.welcome_email", U.caitlyn]])).error).toMatch(/couldn't load your team/);
    state.directoryFails = false;
    state.settingsFail = true;
    expect((await run([["kind.welcome_email", U.caitlyn]])).error).toMatch(/Nothing was changed/);
    expect(state.saved).toEqual([]);
  });

  it("a Proposal-settings save keeps approval_routing (parseSettingsPricing spreads the stored pricing)", async () => {
    const { parseSettingsPricing } = await import("@/lib/proposal-editor/form");
    const existing = { approval_routing: { welcome_email: U.caitlyn } };
    const parsed = parseSettingsPricing(new FormData(), existing);
    if (parsed.ok) expect(parsed.value.approval_routing).toEqual(existing.approval_routing);
    else expect(parsed.ok).toBe(true);
  });
});

describe("Settings -> Approvals page", () => {
  async function page() {
    vi.resetModules();
    const { default: Page } = await import("@/app/dashboard/settings/approvals/page");
    return renderToStaticMarkup(await Page());
  }

  it("the admin tier gets one row per kind with the right options", async () => {
    const html = await page();
    for (const label of ["Follow-up for a stalled lead", "Post-consult and proposal emails", "Welcome emails", "Engagement letters", "Opinion and clearance letters", "Internal briefings and digests", "Partnership and other follow-ups", "Other client emails"]) expect(html).toContain(label);
    expect((html.match(/<select/g) ?? []).length).toBe(8);
    expect((html.match(/Usual approvers \(default\)/g) ?? []).length).toBe(8);
    const select = (kind: string) => html.slice(html.indexOf(`id="route-${kind}"`), html.indexOf("</select>", html.indexOf(`id="route-${kind}"`)));
    // attorney-only: attorney and owner tier only
    expect(select("engagement_letter")).toContain("Rebecca");
    expect(select("engagement_letter")).toContain("Taylor");
    expect(select("engagement_letter")).not.toContain("Caitlyn");
    // routine: every staff member, never the viewer
    expect(select("stalled_followup")).toContain("Caitlyn");
    expect(select("stalled_followup")).not.toContain("Vic");
    // the saved choice is selected
    expect(select("welcome_email")).toMatch(new RegExp(`value="${U.caitlyn}" selected`));
  });

  it("is notFound for everyone below the admin tier and when signed out", async () => {
    for (const role of ["attorney", "intake", "viewer", null]) {
      state.role = role;
      await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("a firm without the proposals feature gets the plain sentence and no form", async () => {
    state.proposals = false;
    const html = await page();
    expect(html).toContain("isn&#x27;t switched on for your firm yet");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<form");
  });

  it("unreadable members or settings: an alert and no form (never an empty dropdown)", async () => {
    state.directoryFails = true;
    let html = await page();
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("<select");
    state.directoryFails = false;
    state.settingsFail = true;
    html = await page();
    expect(html).not.toContain("<form");
  });

  it("exports a title", async () => {
    const mod = await import("@/app/dashboard/settings/approvals/page");
    expect(String(mod.metadata.title)).toContain("Lectual");
  });
});
