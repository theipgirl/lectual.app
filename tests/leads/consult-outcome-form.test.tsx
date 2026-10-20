import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/dashboard/leads/[id]/outcome-actions", () => ({ logConsultOutcomeAction: vi.fn() }));

import { ConsultOutcomeForm } from "@/components/leads/ConsultOutcomeForm";

describe("ConsultOutcomeForm", () => {
  const html = renderToStaticMarkup(<ConsultOutcomeForm leadId="lead-1" />);

  it("offers the three outcomes in the firm's words", () => {
    expect(html).toContain("No-show");
    expect(html).toContain("Asked to reschedule");
    expect(html).toContain("Rebooked after no-show");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain('value="no_show"');
    expect(html).toContain('value="reschedule_requested"');
    expect(html).toContain('value="rebooked_after_no_show"');
  });

  it("has an optional note, the lead id, and says nothing is sent", () => {
    expect(html).toContain("<textarea");
    expect(html).not.toMatch(/<textarea[^>]*required/);
    expect(html).toContain('name="leadId"');
    expect(html).toContain("Nothing is sent to the client");
  });

  it("does not pre-select an outcome, so Log outcome starts disabled", () => {
    expect(html).not.toMatch(/type="radio"[^>]*checked/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Log outcome/);
  });
});

describe("lead page", () => {
  it("renders the form only under canWrite", () => {
    const source = readFileSync(path.resolve(__dirname, "../../src/app/dashboard/leads/[id]/page.tsx"), "utf8");
    expect(source).toMatch(/\{canWrite && \(\s*<section[^>]*>\s*<ConsultOutcomeForm leadId=\{lead\.id\} \/>/);
  });
});
