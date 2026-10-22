import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const resolveFirmSession = vi.fn();
const pickHubRecordsAction = vi.fn();
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: (...a: unknown[]) => resolveFirmSession(...a) }));
vi.mock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));
vi.mock("@/lib/onboarding/hub-actions", () => ({
  pickHubRecordsAction: (...a: unknown[]) => pickHubRecordsAction(...a),
  resetHubProgressAction: vi.fn(),
  markHubFlowAction: vi.fn(),
  hideHubCardAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard/getting-started/" }));

import GettingStartedPage, { metadata } from "@/app/dashboard/getting-started/page";
import { GettingStartedCard } from "@/components/onboarding/GettingStartedCard";
import { recordNote } from "@/components/onboarding/FlowList";
import { hubTracks, visibleFlows } from "@/lib/onboarding/hub";

const ALL = ["mailbox", "proposals", "agents", "agent-toolkit", "document-center"];
const OK_PICKS = { lead: { status: "ok", id: "L1" }, matter: { status: "ok", id: "M1" } };

const session = (role: string, meta: Record<string, unknown> = {}, modules: string[] | null = ALL) => ({
  kind: "ok",
  user: { email: "a@b.co", user_metadata: meta },
  role,
  org: { id: "o1", name: "Hartwell IP", slug: "h", modules },
});

const render = async (node: Promise<unknown> | unknown) => renderToStaticMarkup((await node) as never);

beforeEach(() => {
  resolveFirmSession.mockReset();
  pickHubRecordsAction.mockReset();
  pickHubRecordsAction.mockResolvedValue(OK_PICKS);
});

describe("Getting started page", () => {
  it("is titled through the shared helper", () => {
    expect(metadata.title).toBe("Getting started · Lectual");
  });

  it("shows the heading, one section per track with N of M, Start for open flows and a Reset control", async () => {
    resolveFirmSession.mockResolvedValue(session("owner"));
    const html = await render(GettingStartedPage());
    expect(html).toContain("<h1");
    expect(html).toContain("Getting started");
    const tracks = hubTracks({ role: "owner", modules: ALL, aiConfigured: true });
    expect(tracks).toHaveLength(5);
    for (const t of tracks) {
      expect(html).toContain(`>${t.title}<`);
      expect(html).toContain(`0 of ${t.flows.length} done`);
    }
    expect(html.match(/>Start</g)).toHaveLength(tracks.flatMap((t) => t.flows).length);
    expect(html).not.toContain(">Run again<");
    expect(html).toContain(">Reset progress<");
    expect(html).toContain(`0 of ${tracks.flatMap((t) => t.flows).length} guides done`);
  });

  it("draws a check and Run again for a finished flow, and counts it", async () => {
    resolveFirmSession.mockResolvedValue(session("owner", { lectual_hub: { version: 1, done: ["intake-leads", "intake-board"] } }));
    const html = await render(GettingStartedPage());
    expect(html.match(/>Run again</g)).toHaveLength(2);
    expect(html.match(/gs-check is-done/g)).toHaveLength(2);
    expect(html).toContain("2 of 5 done");
    expect(html).toContain("(done)");
  });

  it("shows no Admin track and no Reconcile flow to a non-admin role", async () => {
    resolveFirmSession.mockResolvedValue(session("attorney"));
    const html = await render(GettingStartedPage());
    expect(html).not.toContain(">Admin<");
    expect(html).not.toContain("Reconcile stages");
    expect(html).toContain(">Intake<");
  });

  it("reads a malformed progress flag as zero done without crashing", async () => {
    resolveFirmSession.mockResolvedValue(session("owner", { lectual_hub: { version: "x", done: 5 } }));
    const html = await render(GettingStartedPage());
    expect(html).toContain("0 of 5 done");
    expect(html).not.toContain(">Run again<");
  });

  it("when the module list can't be read, gated guides are dropped and the page says so", async () => {
    resolveFirmSession.mockResolvedValue(session("owner", {}, null));
    const html = await render(GettingStartedPage());
    expect(html).toContain("Some guides couldn&#x27;t be checked");
    expect(html).not.toContain("Agents draft, people decide");
    expect(html).not.toContain("A proposal from a lead");
    expect(html).toContain("Your leads and last touch");
  });

  it("when the record pick fails, the page still renders and says records couldn't be loaded", async () => {
    pickHubRecordsAction.mockResolvedValue({ lead: { status: "unavailable" }, matter: { status: "none" } });
    resolveFirmSession.mockResolvedValue(session("owner"));
    const html = await render(GettingStartedPage());
    expect(html).toContain("Your leads couldn&#x27;t be loaded");
    expect(html).toContain("No matter to open yet");
    expect(html).toContain(">Start<");
  });

  it("renders nothing for a signed-out session, and a quiet note for a role with no guides", async () => {
    resolveFirmSession.mockResolvedValue({ kind: "signed-out", redirectTo: "/sign-in" });
    expect(await GettingStartedPage()).toBeNull();
    resolveFirmSession.mockResolvedValue(session("mystery"));
    expect(await render(GettingStartedPage())).toContain("no guides to show");
  });

  it("recordNote only speaks about the kinds a flow opens", () => {
    const flow = visibleFlows({ role: "owner", modules: ALL, aiConfigured: true }).find((f) => f.id === "intake-lead")!;
    expect(recordNote(flow, { lead: { status: "ok", id: "a" }, matter: { status: "unavailable" } })).toBeNull();
    expect(recordNote(flow, { lead: { status: "none" }, matter: { status: "ok", id: "m" } })).toMatch(/No lead to open/);
  });
});

describe("Today card", () => {
  it("renders 'Getting started · N of M done' with a link to the page and a Hide control", async () => {
    resolveFirmSession.mockResolvedValue(session("owner", { lectual_hub: { version: 1, done: ["intake-leads"] } }));
    const html = await render(GettingStartedCard());
    expect(html).toContain("Getting started · 1 of 24 done".replace("24", String(visibleFlows({ role: "owner", modules: ALL, aiConfigured: true }).length)));
    expect(html).toMatch(/href="\/dashboard\/getting-started\/?"/);
    expect(html).toContain(">Hide<");
  });

  it("renders nothing when complete, when hidden, and for signed-out or unresolvable roles", async () => {
    const every = visibleFlows({ role: "viewer", modules: ALL, aiConfigured: true }).map((f) => f.id);
    resolveFirmSession.mockResolvedValue(session("viewer", { lectual_hub: { version: 1, done: every } }));
    expect(await GettingStartedCard()).toBeNull();
    resolveFirmSession.mockResolvedValue(session("viewer", { lectual_hub: { version: 1, done: [], hidden_card: true } }));
    expect(await GettingStartedCard()).toBeNull();
    resolveFirmSession.mockResolvedValue({ kind: "signed-out", redirectTo: "/x" });
    expect(await GettingStartedCard()).toBeNull();
    resolveFirmSession.mockResolvedValue({ kind: "no-access", user: {} });
    expect(await GettingStartedCard()).toBeNull();
    resolveFirmSession.mockResolvedValue(session("mystery"));
    expect(await GettingStartedCard()).toBeNull();
  });

  it("a failed read still shows a card with the link and no count", async () => {
    resolveFirmSession.mockRejectedValue(new Error("secret db detail"));
    const html = await render(GettingStartedCard());
    expect(html).toMatch(/href="\/dashboard\/getting-started\/?"/);
    expect(html).toContain("Getting started");
    expect(html).not.toMatch(/\d+ of \d+ done/);
    expect(html).not.toContain(">Hide<");
    expect(html).not.toContain("secret");
  });
});
