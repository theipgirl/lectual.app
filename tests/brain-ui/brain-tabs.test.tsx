import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => ({
  session: { kind: "ok", role: "senior_admin" } as { kind: string; role?: string },
  listFails: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: async () => h.session }));
vi.mock("@/lib/pipeline/stages", () => ({ listStages: async () => [{ id: "st-1", name: "Consult Booked" }] }));
vi.mock("@/app/dashboard/brain/actions", () => {
  const action = async () => ({});
  return {
    createBrainEntryAction: action,
    updateBrainEntryAction: action,
    deleteBrainEntryAction: action,
    proposeClaimAction: action,
    reviewClaimAction: action,
    deleteClaimAction: action,
  };
});
vi.mock("@/lib/brain", () => ({
  listBrainEntries: async () => {
    if (h.listFails) throw new Error("db down");
    return [];
  },
  listClaims: async () => [],
}));

const { default: BrainPage } = await import("@/app/dashboard/brain/page");
const { default: NewEntryForm } = await import("@/app/dashboard/brain/_components/NewEntryForm");
const render = async (tab?: string) => renderToStaticMarkup(await BrainPage({ searchParams: Promise.resolve({ tab }) }));

beforeEach(() => {
  h.session = { kind: "ok", role: "senior_admin" };
  h.listFails = false;
});

describe("Firm notes tabs", () => {
  it("defaults to Knowledge, and a junk tab is Knowledge too", async () => {
    for (const tab of [undefined, "bogus", "claims-extra"]) {
      const html = await render(tab);
      expect(html).toContain("New entry");
      expect(html).not.toContain("Propose a claim");
    }
  });
  it("?tab=claims shows the Claim library and the Propose form, not Knowledge", async () => {
    const html = await render("claims");
    expect(html).toContain("Propose a claim");
    expect(html).toContain("No claims proposed yet");
    expect(html).not.toContain("New entry");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('role="tablist"');
  });
  it("each tab shows its who-can-add sentence for the role", async () => {
    expect(await render()).toContain("You can add and edit firm notes.");
    h.session = { kind: "ok", role: "paralegal" };
    expect(await render()).toContain("Owners, admins and senior admins add firm notes. You can read them.");
    expect(await render("claims")).toContain("You can propose a claim. Owners, admins, senior admins and attorneys review them.");
    h.session = { kind: "ok", role: "attorney" };
    expect(await render("claims")).toContain("You can propose a claim. You can also review claims.");
    h.session = { kind: "ok", role: "viewer" };
    expect(await render("claims")).toContain("You can read the claims but not propose one.");
  });
  it("has the one purpose line and no eyebrow or sign-in card", async () => {
    const html = await render();
    expect(html).toContain("Your assistants use these to match your tone, prices and rules. Nothing here is sent to clients.");
    expect(html).not.toContain("AI tools");
    expect(html).not.toContain("Firm memory");
    expect(html).not.toContain("Sign in");
  });
  it("a session that is not ok is notFound, with no card", async () => {
    h.session = { kind: "signed-out" };
    await expect(BrainPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("a failed load still says so and shows no list", async () => {
    h.listFails = true;
    const html = await render();
    expect(html).toContain("Couldn&#x27;t load your firm notes");
    expect(html).not.toContain("No firm notes yet");
  });
  it("the page source no longer names IP.OS or AI_TOOLS_GROUP", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/brain/page.tsx"), "utf8");
    expect(src).not.toMatch(/IP\.OS|AI_TOOLS_GROUP|Sign in to see your firm notes/);
  });
});

describe("NewEntryForm", () => {
  it("has a Type select with four plain options and no Key field", () => {
    const html = renderToStaticMarkup(<NewEntryForm stages={[{ id: "st-1", name: "Consult Booked" }]} />);
    for (const label of ["Tone of voice", "Prices and packages", "Stage rules", "Other"]) expect(html).toContain(label);
    expect(html).not.toContain('name="key"');
    expect(html).not.toContain(">Key<");
  });
  it("disables Stage rules with a sentence when stages could not be read", () => {
    const html = renderToStaticMarkup(<NewEntryForm stages={null} />);
    expect(html).toMatch(/<option value="stage_rules" disabled/);
    expect(html).toContain("couldn&#x27;t be loaded");
  });
});
