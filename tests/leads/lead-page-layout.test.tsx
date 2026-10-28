import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LeadStatusRow } from "@/components/leads/LeadStatusRow";
import { NeedsAttentionCard } from "@/components/leads/NeedsAttentionCard";
import { ComposerTabs } from "@/components/leads/ComposerTabs";
import { CollapsibleAside } from "@/components/leads/CollapsibleAside";
import { ContactActions } from "@/components/leads/ContactActions";
import { WaitingOnRebecca } from "@/components/leads/WaitingOnRebecca";
import { contactLinks, lastHeardLabel } from "@/lib/leads/status-row";
import { needsAttention } from "@/lib/leads/needs-attention";

const root = path.resolve(__dirname, "../..");
const page = readFileSync(path.join(root, "src/app/dashboard/leads/[id]/page.tsx"), "utf8");
const css = readFileSync(path.join(root, "src/components/leads/lead-page.css"), "utf8");
const NOW = Date.parse("2026-10-27T12:00:00Z");

describe("F1: lead page order", () => {
  it("draws the sections in the Sprint 33 order", () => {
    const order = [
      "<LeadStatusRow",
      "<NeedsAttentionCard>",
      "<ComposerTabs",
      'data-tour="lead-timeline"',
      'id="prep-consult"',
      "<ConsultDetailsSection",
      "<LinkedMeetings",
      "<LeadProposalsCard",
      "<AnswersCard",
      "<DocumentsCard",
      "<SequencesCard",
      "<TemperatureCard",
    ].map((m) => page.indexOf(m, page.indexOf("return (")));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("status row: Stage pill, Temperature, Owner when known, last heard", () => {
    const html = renderToStaticMarkup(
      <LeadStatusRow stageName="Consult Held" temperatureLabel="Hot" ownerName="Dawn Reyes" lastActivityAt="2026-10-24T12:00:00Z" now={NOW} />,
    );
    expect(html).toContain("Consult Held");
    expect(html).toContain("Temperature: <b>Hot</b>");
    expect(html).toContain("Owner: <b>Dawn Reyes</b>");
    expect(html).toContain("Last heard from 3 days ago");
    const none = renderToStaticMarkup(<LeadStatusRow stageName={null} temperatureLabel={null} ownerName={null} lastActivityAt={null} now={NOW} />);
    expect(none).not.toContain("Owner");
    expect(none).toContain("Not rated");
    expect(none).toContain("No contact yet");
  });

  it("lastHeardLabel never makes up an age", () => {
    expect(lastHeardLabel(null, NOW)).toBe("No contact yet");
    expect(lastHeardLabel("garbage", NOW)).toBe("No contact yet");
    expect(lastHeardLabel("2026-11-30T00:00:00Z", NOW)).toBe("No contact yet");
    expect(lastHeardLabel("2026-10-27T01:00:00Z", NOW)).toBe("Last heard from today");
    expect(lastHeardLabel("2026-10-26T01:00:00Z", NOW)).toBe("Last heard from 1 day ago");
  });
});

describe("F2: one Needs attention card", () => {
  const empty = { status: "ok" as const, byLead: {} };
  const base = { leadId: "l1", consult: null, approvals: empty, clientEmailProposals: 0, stageSuggestions: 0 };

  it("is hidden with nothing waiting and shown for each kind of item", () => {
    expect(needsAttention(base)).toBe(false);
    expect(needsAttention({ ...base, consult: { status: "ok", event: null } })).toBe(false);
    expect(needsAttention({ ...base, consult: { status: "database-update-needed" } })).toBe(false);
    expect(needsAttention({ ...base, approvals: { status: "unconfigured" } })).toBe(false);
    expect(needsAttention({ ...base, consult: { status: "ok", event: {} } })).toBe(true);
    expect(needsAttention({ ...base, approvals: { status: "ok", byLead: { l1: [{ queueId: "q", headline: "h", kind: "other", createdAt: null }] } } })).toBe(true);
    expect(needsAttention({ ...base, clientEmailProposals: 1 })).toBe(true);
    expect(needsAttention({ ...base, stageSuggestions: 2 })).toBe(true);
  });

  it("a failed read still opens the card, never an empty one", () => {
    expect(needsAttention({ ...base, approvals: { status: "unavailable" } })).toBe(true);
    expect(needsAttention({ ...base, consult: { status: "unavailable" } })).toBe(true);
    const html = renderToStaticMarkup(
      <NeedsAttentionCard>
        {WaitingOnRebecca({ leadId: "l1", approvals: { status: "unavailable" }, now: NOW, bare: true })}
      </NeedsAttentionCard>,
    );
    expect(html).toContain("Needs attention");
    expect(html).toContain("Can&#x27;t show what&#x27;s waiting for approval right now.");
    expect(html.match(/<section/g)).toHaveLength(1);
  });

  it("the Waiting-on-attorney card is not rendered when empty", () => {
    expect(WaitingOnRebecca({ leadId: "l1", approvals: empty, now: NOW })).toBeNull();
  });
});

describe("F3: rare forms are collapsed and anchors kept", () => {
  it("wraps the consult outcome form in a closed details", () => {
    expect(page).toMatch(/<details className="lx-card lx-disclosure" id="log-consult-outcome">\s*<summary>Log a consult outcome<\/summary>/);
    expect(page).not.toMatch(/<details[^>]*\sopen/);
  });
  it("keeps each anchor and data-tour token exactly once", () => {
    for (const token of ['id="prep-consult"', 'data-tour="lead-prep"', 'data-tour="lead-timeline"', 'data-tour="lead-head"']) {
      expect(page.split(token).length - 1).toBe(1);
    }
  });
  it("the by-hand consult details form is a closed details", () => {
    const src = readFileSync(path.join(root, "src/components/leads/ConsultDetailsSection.tsx"), "utf8");
    expect(src).toMatch(/<details className="lx-card lx-disclosure">\s*<summary>Record consult details by hand<\/summary>/);
  });
});

describe("F4: phone header and aside", () => {
  it("Call and Email links exist only for what the lead has", () => {
    expect(contactLinks({ phone: "(555) 123-4567", email: "a@b.co" })).toEqual({ call: "tel:5551234567", email: "mailto:a@b.co" });
    expect(contactLinks({ phone: null, email: "" })).toEqual({ call: null, email: null });
    expect(renderToStaticMarkup(<ContactActions phone={null} email={null} />)).toBe("");
    const html = renderToStaticMarkup(<ContactActions phone="555-123-4567" email={null} />);
    expect(html).toContain('href="tel:5551234567"');
    expect(html).not.toContain("mailto:");
  });
  it("the aside is a details titled Details and tags, first on phones", () => {
    const html = renderToStaticMarkup(<CollapsibleAside>x</CollapsibleAside>);
    expect(html).toContain("<summary>Details and tags</summary>");
    expect(css).toMatch(/max-width: 640px[\s\S]*\.lx-split-lead > \.lx-aside \{[^}]*order: -1/);
    expect(css).toMatch(/\.lx-split-lead > \.lx-col \{ display: contents; \}/);
    expect(page).toContain('className="lx-split lx-split-lead"');
  });
  it("lead-page.css uses tokens only (no hex colours)", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("P1: composer tabs", () => {
  it("is a tablist with Text and Voice, only the active panel shown", () => {
    const html = renderToStaticMarkup(<ComposerTabs text={<p>TEXT</p>} voice={<p>VOICE</p>} />);
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toMatch(/id="composer-tab-text"[^>]*aria-selected="true"/);
    expect(html).toMatch(/id="composer-panel-voice"[^>]*hidden/);
    expect(html).not.toMatch(/id="composer-panel-text"[^>]*hidden/);
  });
  it("handles arrow keys", () => {
    const src = readFileSync(path.join(root, "src/components/leads/ComposerTabs.tsx"), "utf8");
    for (const k of ["ArrowRight", "ArrowLeft", "Home", "End"]) expect(src).toContain(k);
  });
});
