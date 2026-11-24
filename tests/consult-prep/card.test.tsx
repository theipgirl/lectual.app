import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { consultPrepCardView, type CardInputs } from "@/lib/consult-prep/card";
import type { SendRecord } from "@/lib/consult-prep/sends";
import type { ConsultPrepCardData } from "@/lib/consult-prep/card-load";
import { canRerunConsultPrep } from "@/lib/consult-prep/roles";
import { ROLES } from "@/lib/auth/roles";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/dashboard/leads/[id]/consult-prep-actions", () => ({ rerunConsultPrepAction: async () => ({}) }));

const { ConsultPrepCard } = await import("@/components/leads/ConsultPrepCard");

const KEY = "lead-1:e1:2026-11-25T19:00:00.000Z";
const send = (over: Partial<SendRecord>): SendRecord => ({ leadId: "lead-1", prepKey: KEY, kind: "booked", resendId: "r", scheduledFor: null, status: "sent", at: "2026-11-24T19:10:00.000Z", ...over });
const inputs = (over: Partial<CardInputs> = {}): CardInputs => ({
  agents: "on",
  setting: "on",
  markers: { status: "ok", value: [] },
  sends: { status: "ok", value: [] },
  recipients: { status: "ok", value: { names: ["Rebecca"], cc: ["info@firm.example"] } },
  emailOn: true,
  adminTier: true,
  tz: "America/New_York",
  ...over,
});
const prepared = { status: "ok" as const, value: [{ prepKey: KEY, queueItemId: "q-1", at: "2026-11-24T19:10:00.000Z" }] };

describe("the Consult prep card's status line", () => {
  it("prepared, emailed to the recipient with the cc, and the reminders that are scheduled", () => {
    const v = consultPrepCardView(
      inputs({
        markers: prepared,
        sends: {
          status: "ok",
          value: [send({}), send({ kind: "24h", status: "scheduled", scheduledFor: "2026-11-24T19:00:00.000Z" }), send({ kind: "1h", status: "scheduled", scheduledFor: "2026-11-25T18:00:00.000Z" })],
        },
      }),
    );
    expect(v).toMatchObject({ kind: "prepared", queueItemId: "q-1" });
    expect((v as { lines: string[] }).lines[0]).toBe("Prepared Nov 24, 2:10 PM · emailed to Rebecca, cc info@firm.example · reminders: a day before, Nov 24, 2:00 PM; an hour before, Nov 25, 1:00 PM");
  });

  it("not prepared yet, when nothing has run and nothing is wrong", () => {
    expect(consultPrepCardView(inputs())).toEqual({ kind: "not-prepared", reason: "not-yet", lines: ["Not prepared yet: it runs when the lead is in Consultation Scheduled."] });
  });

  it("the setting off says so (never for a role that can't see the setting)", () => {
    expect(consultPrepCardView(inputs({ setting: "off" }))).toMatchObject({ kind: "not-prepared", reason: "off", lines: ["Prep is off for your firm."] });
    expect(consultPrepCardView(inputs({ setting: "unknown" }))).toMatchObject({ reason: "not-yet" });
  });

  it("no recipients: the sentence, with the Settings link for the admin tier and an ask for everyone else", () => {
    const none = { status: "ok" as const, value: { names: [], cc: [] } };
    expect(consultPrepCardView(inputs({ recipients: none }))).toMatchObject({ kind: "not-prepared", reason: "no-recipients", lines: ["No one is set to receive consult prep. Set it in Settings → Team."] });
    expect((consultPrepCardView(inputs({ recipients: none, adminTier: false })) as { lines: string[] }).lines[0]).toBe("No one is set to receive consult prep. An owner or admin can set it in Settings → Team.");
  });

  it("a prepared lead with no recipients says the brief was not emailed and why", () => {
    const v = consultPrepCardView(inputs({ markers: prepared, recipients: { status: "ok", value: { names: [], cc: [] } } })) as { lines: string[] };
    expect(v.lines[0]).toBe("Prepared Nov 24, 2:10 PM · not emailed");
    expect(v.lines[1]).toContain("No one is set to receive consult prep.");
  });

  it("email not switched on is said in the platform's voice", () => {
    const v = consultPrepCardView(inputs({ markers: prepared, emailOn: false })) as { lines: string[] };
    expect(v.lines[0]).toContain("not emailed (Email isn't switched on for your firm yet. Lectual will turn it on.)");
  });

  it("a failed booked email says it will be tried again; a cancelled reminder is not listed", () => {
    const failed = consultPrepCardView(inputs({ markers: prepared, sends: { status: "ok", value: [send({ status: "failed", resendId: null })] } })) as { lines: string[] };
    expect(failed.lines[0]).toContain("the email couldn't be sent and will be tried again");
    const cancelled = consultPrepCardView(inputs({ markers: prepared, sends: { status: "ok", value: [send({}), send({ kind: "1h", status: "scheduled", scheduledFor: "2026-11-25T18:00:00.000Z", at: "2026-11-24T19:11:00.000Z" }), send({ kind: "1h", status: "cancelled", scheduledFor: "2026-11-25T18:00:00.000Z", at: "2026-11-24T20:00:00.000Z" })] } })) as { lines: string[] };
    expect(cancelled.lines[0]).not.toContain("reminders");
  });

  it("the newest prep is the one shown, and its own sends only", () => {
    const old = "lead-1:e0:2026-11-20T19:00:00.000Z";
    const v = consultPrepCardView(
      inputs({
        markers: { status: "ok", value: [{ prepKey: old, queueItemId: "q-old", at: "2026-11-19T10:00:00.000Z" }, { prepKey: KEY, queueItemId: "q-new", at: "2026-11-24T19:10:00.000Z" }] },
        sends: { status: "ok", value: [send({ prepKey: old, kind: "1h", status: "scheduled", scheduledFor: "2026-11-20T18:00:00.000Z" })] },
      }),
    );
    expect(v).toMatchObject({ kind: "prepared", queueItemId: "q-new" });
    expect((v as { lines: string[] }).lines[0]).not.toContain("reminders");
  });

  it("a failed read of the markers or the sends is 'couldn't load', never 'not prepared yet'", () => {
    expect(consultPrepCardView(inputs({ markers: { status: "unavailable" } }))).toEqual({ kind: "unavailable" });
    expect(consultPrepCardView(inputs({ sends: { status: "unavailable" } }))).toEqual({ kind: "unavailable" });
    expect(consultPrepCardView(inputs({ agents: "unreadable" }))).toEqual({ kind: "unavailable" });
  });

  it("an unreadable recipient list is said, never 'no one is set'", () => {
    const v = consultPrepCardView(inputs({ recipients: { status: "unavailable" } })) as { lines: string[] };
    expect(v.lines.join(" ")).toContain("Who gets consult prep couldn't be read.");
    expect(v.lines.join(" ")).not.toContain("No one is set");
  });

  it("the card is hidden for a firm without the Assistants feature", () => {
    expect(consultPrepCardView(inputs({ agents: "off" }))).toEqual({ kind: "hidden" });
  });
});

const draw = (data: ConsultPrepCardData, over: { canRerun?: boolean; adminTier?: boolean } = {}) =>
  renderToStaticMarkup(<ConsultPrepCard data={data} leadId="lead-1" canRerun={over.canRerun ?? true} adminTier={over.adminTier ?? true} />);

describe("the Consult prep card", () => {
  const view = consultPrepCardView(inputs({ markers: prepared, sends: { status: "ok", value: [send({})] } }));
  it("has no input of any kind: no form field, no select, no textarea, no zoom link, no practice area", () => {
    const html = draw({ view, brief: { status: "ok", text: "Consult prep for Dana" } });
    expect(html).not.toMatch(/<(input|select|textarea|form)\b/);
    expect(html).not.toMatch(/practice area|zoom link|session date/i);
  });
  it("keeps the anchor and the tour hook once, and shows the brief as text inside a closed details", () => {
    const html = draw({ view, brief: { status: "ok", text: "Consult prep for Dana <b>x</b>" } });
    expect(html.split('id="prep-consult"').length - 1).toBe(1);
    expect(html.split('data-tour="lead-prep"').length - 1).toBe(1);
    expect(html).toMatch(/<details><summary>View the brief<\/summary><pre[^>]*>Consult prep for Dana &lt;b&gt;x&lt;\/b&gt;<\/pre><\/details>/);
    expect(html).not.toContain("<details open");
  });
  it("Re-run prep only for the roles that may, behind a confirm", () => {
    expect(draw({ view, brief: { status: "none" } })).toContain("Re-run prep");
    expect(draw({ view, brief: { status: "none" } }, { canRerun: false })).not.toContain("Re-run prep");
    for (const role of ROLES) expect(canRerunConsultPrep(role), role).toBe(["owner", "admin", "senior_admin", "attorney"].includes(role));
    expect(canRerunConsultPrep(null)).toBe(false);
  });
  it("each brief state has its own sentence; the card says couldn't load for a failed read", () => {
    expect(draw({ view, brief: { status: "unavailable" } })).toContain("The brief couldn&#x27;t be loaded. Refresh to try again.");
    expect(draw({ view, brief: { status: "missing" } })).toContain("The brief is no longer in Approvals.");
    expect(draw({ view, brief: { status: "not-kept" } })).toContain("The brief isn&#x27;t kept in Lectual because approvals aren&#x27;t connected for your firm.");
    const html = draw({ view: { kind: "unavailable" }, brief: { status: "none" } });
    expect(html).toContain("Couldn&#x27;t load consult prep. Refresh to try again.");
    expect(html).not.toContain("Re-run prep");
  });
  it("draws nothing for a firm without the Assistants feature", () => {
    expect(draw({ view: { kind: "hidden" }, brief: { status: "none" } })).toBe("");
  });
});

describe("the old form is gone", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (f: string) => readFileSync(path.join(root, f), "utf8");
  it("no prepConsultAction, no PrepConsult form, no queuePrepConsultDrafts", () => {
    expect(read("src/app/dashboard/leads/[id]/actions.ts")).not.toMatch(/prepConsultAction/);
    expect(read("src/components/leads/LeadExtras.tsx")).not.toMatch(/PrepConsult\b/);
    expect(read("src/app/dashboard/leads/[id]/page.tsx")).not.toMatch(/PrepConsult\b|hasAgentToolkit|Prep this consult/);
    let found = false;
    try {
      read("src/lib/prep-consult/generate.ts");
      found = true;
    } catch {
      found = false;
    }
    expect(found).toBe(false);
  });
});
