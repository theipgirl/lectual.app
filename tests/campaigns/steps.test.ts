import { describe, it, expect } from "vitest";

import {
  addDelay,
  delayLabel,
  enrollmentStatusLabel,
  enrollmentStatusTone,
  isStepDue,
  leadDisplayName,
  leadTemplateVars,
  renderTemplate,
  sequenceStatusLabel,
  sequenceStatusTone,
  stepTypeLabel,
} from "@/lib/campaigns/steps";

describe("leadDisplayName", () => {
  it("prefers the business name when there is one", () => {
    expect(leadDisplayName({ first_name: "Ada", last_name: "Lovelace", business_name: "Analytical Engines LLC" })).toBe(
      "Analytical Engines LLC",
    );
  });

  it("falls back to the person's full name when there is no business name", () => {
    expect(leadDisplayName({ first_name: "Ada", last_name: "Lovelace", business_name: null })).toBe("Ada Lovelace");
  });

  it("falls back to the full name for a blank business name, not an empty string", () => {
    expect(leadDisplayName({ first_name: "Ada", last_name: "Lovelace", business_name: "   " })).toBe("Ada Lovelace");
  });
});

describe("leadTemplateVars / renderTemplate", () => {
  const lead = { first_name: "Ada", last_name: "Lovelace", business_name: "Analytical Engines LLC", email: "ada@example.com" };

  it("fills every {{token}} the vars provide", () => {
    const vars = leadTemplateVars(lead);
    const rendered = renderTemplate(
      {
        subject: "Hi {{first_name}}",
        body_html: "<p>Dear {{client_name}} ({{email}})</p>",
        body_text: "Dear {{full_name}}",
      },
      vars,
    );
    expect(rendered.subject).toBe("Hi Ada");
    expect(rendered.bodyHtml).toBe("<p>Dear Analytical Engines LLC (ada@example.com)</p>");
    expect(rendered.bodyText).toBe("Dear Ada Lovelace");
  });

  it("leaves an unknown token exactly as typed, rather than blanking it", () => {
    const vars = leadTemplateVars(lead);
    const rendered = renderTemplate({ subject: "Hi {{frist_name}}", body_html: "", body_text: "" }, vars);
    expect(rendered.subject).toBe("Hi {{frist_name}}");
  });

  it("client_name mirrors leadDisplayName (business name over full name)", () => {
    const vars = leadTemplateVars({ ...lead, business_name: null });
    expect(vars.client_name).toBe("Ada Lovelace");
  });
});

describe("stepTypeLabel", () => {
  it("labels every known step type", () => {
    expect(stepTypeLabel("email")).toBe("Email");
    expect(stepTypeLabel("task")).toBe("Internal task");
    expect(stepTypeLabel("wait")).toBe("Wait");
    expect(stepTypeLabel("condition")).toBe("Condition");
  });
});

describe("sequence and enrollment status presentation", () => {
  it("maps a sequence's active flag to a label and a tone", () => {
    expect(sequenceStatusLabel(true)).toBe("Active");
    expect(sequenceStatusLabel(false)).toBe("Paused");
    expect(sequenceStatusTone(true)).toBe("lx-pill-ok");
    expect(sequenceStatusTone(false)).toBe("lx-pill-mute");
  });

  it("maps every enrollment status to a distinct label and tone", () => {
    const statuses = ["active", "paused", "completed", "cancelled"] as const;
    const labels = statuses.map(enrollmentStatusLabel);
    const tones = statuses.map(enrollmentStatusTone);
    expect(new Set(labels).size).toBe(statuses.length);
    expect(labels).toEqual(["Active", "Paused", "Completed", "Cancelled"]);
    expect(tones).toEqual(["lx-pill-ok", "lx-pill-warn", "lx-pill-mute", "lx-pill-risk"]);
  });
});

describe("delayLabel", () => {
  it("calls a zero or negative delay immediate", () => {
    expect(delayLabel(0)).toBe("Immediately");
    expect(delayLabel(-1)).toBe("Immediately");
  });

  it("renders whole days in days, not hours", () => {
    expect(delayLabel(24)).toBe("1 day");
    expect(delayLabel(48)).toBe("2 days");
  });

  it("renders a non-multiple-of-24 delay in hours", () => {
    expect(delayLabel(4)).toBe("4 hours");
    expect(delayLabel(1)).toBe("1 hour");
  });
});

describe("isStepDue / addDelay", () => {
  const now = new Date("2026-09-27T12:00:00.000Z");

  it("is not due with no schedule at all", () => {
    expect(isStepDue(null, now)).toBe(false);
  });

  it("is due exactly at, and after, the scheduled instant", () => {
    expect(isStepDue("2026-09-27T12:00:00.000Z", now)).toBe(true);
    expect(isStepDue("2026-09-27T11:59:59.000Z", now)).toBe(true);
  });

  it("is not due before the scheduled instant", () => {
    expect(isStepDue("2026-09-27T12:00:01.000Z", now)).toBe(false);
  });

  it("addDelay adds exactly delayHours hours, and clamps a negative delay to zero", () => {
    expect(addDelay(now, 24)).toBe("2026-09-28T12:00:00.000Z");
    expect(addDelay(now, 0)).toBe(now.toISOString());
    expect(addDelay(now, -5)).toBe(now.toISOString());
  });
});
