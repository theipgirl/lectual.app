import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describeNotification } from "@/lib/notifications/describe";

const LEAD = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";

const row = (kind: string, payload: unknown, extra: Record<string, unknown> = {}) => ({
  kind,
  lead_id: LEAD,
  matter_id: null,
  payload,
  ...extra,
});
const sentence = (kind: string, payload: unknown, actorName?: string | null) =>
  describeNotification(row(kind, payload), { actorName }).sentence;

describe("describeNotification sentences (F1)", () => {
  it("renders each existing kind", () => {
    expect(sentence("assigned", { lead_name: "Ana Ruiz" }, "Taylor")).toBe("Taylor assigned you Ana Ruiz");
    expect(sentence("mentioned", { lead_name: "Ana Ruiz", preview: "hi" }, "Dawn")).toBe("Dawn mentioned you on Ana Ruiz");
    expect(sentence("lead_replied", { lead_name: "Ana Ruiz" })).toBe("Ana Ruiz replied");
    expect(sentence("time_running", { hours: 8 })).toBe("Your timer has been running 8h");
  });

  it("renders the consult-outcome source for each outcome", () => {
    const base = { source: "consult_outcome", lead_name: "Ana Ruiz" };
    expect(sentence("mentioned", { ...base, outcome: "no_show" })).toBe("No-show logged on Ana Ruiz");
    expect(sentence("mentioned", { ...base, outcome: "reschedule_requested" })).toBe("Reschedule requested on Ana Ruiz");
    expect(sentence("mentioned", { ...base, outcome: "rebooked_after_no_show" })).toBe("Rebooked after no-show: Ana Ruiz");
    expect(sentence("mentioned", { ...base, outcome: "something_new" })).toBe("Consult outcome logged on Ana Ruiz");
  });

  it("renders the approval source with the headline", () => {
    expect(sentence("mentioned", { source: "approval_needed", queue_id: "q-1", headline: "Follow-up — Ana Ruiz" })).toBe(
      "A draft is waiting for your approval: Follow-up — Ana Ruiz",
    );
    expect(sentence("mentioned", { source: "approval_needed", queue_id: "q-1" })).toBe("A draft is waiting for your approval");
  });

  it("truncates a very long headline", () => {
    const out = sentence("mentioned", { source: "approval_needed", headline: "x".repeat(500) });
    expect(out.length).toBeLessThan(200);
    expect(out.endsWith("…")).toBe(true);
  });

  it("renders the future dedicated kinds the same as their mentioned forms", () => {
    const outcome = { lead_name: "Ana Ruiz", outcome: "no_show" };
    expect(sentence("consult_outcome", outcome)).toBe(sentence("mentioned", { ...outcome, source: "consult_outcome" }));
    const approval = { queue_id: "q-1", headline: "Draft" };
    expect(sentence("approval_needed", approval)).toBe(sentence("mentioned", { ...approval, source: "approval_needed" }));
    expect(describeNotification(row("approval_needed", approval)).icon).toBe("approval");
    expect(describeNotification(row("consult_outcome", outcome)).icon).toBe("outcome");
  });

  it("gives the old form (mentioned + source) and the dedicated kind the same label, icon, sentence and href", () => {
    const outcome = { lead_name: "Ana Ruiz", outcome: "no_show" };
    const approval = { queue_id: "q-1", headline: "Draft", lead_name: "Ana Ruiz" };
    const pairs: Array<[string, unknown]> = [
      ["consult_outcome", outcome],
      ["approval_needed", approval],
    ];
    for (const [kind, payload] of pairs) {
      const oldForm = describeNotification(row("mentioned", { ...(payload as object), source: kind }));
      const newForm = describeNotification(row(kind, { ...(payload as object), source: kind }));
      expect(newForm).toEqual(oldForm);
      // The dedicated kind needs no `source` to read the same.
      expect(describeNotification(row(kind, payload))).toEqual(oldForm);
    }
  });

  it("is neutral for an unknown kind, an unknown source and missing names, and never throws", () => {
    expect(sentence("brand_new_kind", { lead_name: "Ana Ruiz" })).toBe("Something changed on Ana Ruiz");
    expect(sentence("mentioned", { source: "from_the_future", lead_name: "Ana Ruiz" })).toBe("Something changed on Ana Ruiz");
    expect(sentence("brand_new_kind", {})).toBe("Something changed");
    expect(sentence("assigned", {})).toBe("Someone assigned you a lead");
    expect(sentence("mentioned", {}, null)).toBe("Someone mentioned you on a lead");
    for (const payload of [null, undefined, "text", ["a"], 42, true]) {
      for (const kind of ["assigned", "mentioned", "lead_replied", "time_running", "x"]) {
        expect(() => describeNotification(row(kind, payload))).not.toThrow();
        expect(describeNotification(row(kind, payload)).sentence.length).toBeGreaterThan(0);
      }
    }
    expect(sentence("lead_replied", null)).toBe("A lead replied");
  });

  it("builds a lead_replied sentence from the lead name only", () => {
    const out = describeNotification(
      row("lead_replied", {
        lead_name: "Ana Ruiz",
        subject: "SECRET-SUBJECT",
        preview: "SECRET-PREVIEW",
        body: "SECRET-BODY",
        from: "secret-sender@example.com",
      }),
      { actorName: "Dawn" },
    );
    expect(out.sentence).toBe("Ana Ruiz replied");
    expect(JSON.stringify(out)).not.toMatch(/SECRET|secret-sender/);
  });

  it("shows markup in a headline as plain text", () => {
    const { sentence: s } = describeNotification(
      row("mentioned", { source: "approval_needed", headline: "<img src=x onerror=alert(1)>" }),
    );
    const html = renderToStaticMarkup(createElement("p", null, s));
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });
});

describe("describeNotification links (F2)", () => {
  it("links a lead row to the lead, a matter-only row to the matter", () => {
    expect(describeNotification(row("assigned", {})).href).toBe(`/dashboard/leads/${LEAD}/`);
    expect(describeNotification(row("time_running", {}, { lead_id: null, matter_id: MATTER })).href).toBe(
      `/dashboard/matters/${MATTER}/`,
    );
  });

  it("links an approval to the queue item even when it also has a lead", () => {
    const out = describeNotification(row("mentioned", { source: "approval_needed", queue_id: "q_abc-1" }));
    expect(out.href).toBe("/dashboard/queue/q_abc-1/");
  });

  it("gives no link for an id that fails its pattern, or no entity at all", () => {
    expect(describeNotification(row("mentioned", { source: "approval_needed", queue_id: "../../etc" })).href).toBeNull();
    expect(describeNotification(row("mentioned", { source: "approval_needed", queue_id: "a b" })).href).toBeNull();
    expect(describeNotification(row("mentioned", { source: "approval_needed" })).href).toBeNull();
    expect(describeNotification(row("assigned", {}, { lead_id: "not-a-uuid" })).href).toBeNull();
    expect(describeNotification(row("assigned", {}, { lead_id: null, matter_id: "nope" })).href).toBeNull();
    expect(describeNotification(row("assigned", {}, { lead_id: null, matter_id: null })).href).toBeNull();
  });
});

describe("describeNotification: a client accepted a proposal (Sprint 19)", () => {
  const PROPOSAL = "44444444-4444-4444-8444-444444444444";
  const accepted = { source: "proposal_accepted", proposal_id: PROPOSAL, headline: "Sevetri Wilson accepted Concierge · legal $4,950" };

  it("reads as 'Proposal accepted' with the headline and links to the proposal, not the queue", () => {
    const out = describeNotification(row("approval_needed", accepted));
    expect(out).toEqual({
      icon: "approval",
      label: "Proposal accepted",
      sentence: "Sevetri Wilson accepted Concierge · legal $4,950",
      href: `/dashboard/proposals/${PROPOSAL}/`,
    });
    expect(out.sentence).not.toContain("A draft is waiting");
  });

  it("reads the same under the older 'mentioned' kind", () => {
    expect(describeNotification(row("mentioned", accepted)).label).toBe("Proposal accepted");
  });

  it("a malformed payload gives a neutral sentence and no link", () => {
    const out = describeNotification(row("approval_needed", { source: "proposal_accepted", proposal_id: "../x", headline: 7 }));
    expect(out.sentence).toBe("A client accepted a proposal");
    expect(out.href).toBeNull();
    expect(describeNotification(row("approval_needed", { source: "proposal_accepted" })).href).toBeNull();
  });

  it("clips a long headline", () => {
    expect(describeNotification(row("approval_needed", { ...accepted, headline: "x".repeat(500) })).sentence.length).toBeLessThanOrEqual(120);
  });

  it("an approval_needed row with a queue id still reads the old sentence and links to the queue", () => {
    const out = describeNotification(row("approval_needed", { source: "approval_needed", queue_id: "q_abc-1", headline: "Follow-up — Ana Ruiz" }));
    expect(out.label).toBe("Needs approval");
    expect(out.sentence).toBe("A draft is waiting for your approval: Follow-up — Ana Ruiz");
    expect(out.href).toBe("/dashboard/queue/q_abc-1/");
  });
});
