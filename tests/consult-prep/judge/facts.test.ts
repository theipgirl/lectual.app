import { describe, expect, it } from "vitest";
import type { BriefFacts } from "@/lib/consult-prep/brief";
import { judgeFactsFromBrief } from "@/lib/consult-prep/judge/facts";
import { markIsGrounded } from "@/lib/consult-prep/judge/judge";
import { mapIntakeLabel } from "@/lib/consult-prep/lawmatics-intake";

const lead = { id: "l1", firstName: "Dana", lastName: "Ruiz", businessName: "Sankofa Brewing", email: "dana@client.example", phone: "555-0100", practiceArea: "Trademark", markText: "SANKOFA", referralSource: "Booth", referralDetail: "UGW 2026", stage: "Consultation Scheduled", lawmaticsId: null };
const intake = { practiceArea: null, inquiry: "We brew beer and want to protect our name.", mark: null, productsServices: "Craft beer", company: null, useInCommerce: "Since 2022", competitors: null, goals: "Expand", consultFeePaid: null, website: "https://sankofa.example", referralSource: "Instagram" };
const facts = (over: Partial<BriefFacts> = {}): BriefFacts => ({
  lead,
  startsAt: "2026-11-25T19:00:00.000Z",
  joinUrl: null,
  preparedAt: "2026-11-24T19:10:00.000Z",
  tz: "America/New_York",
  lawmatics: { state: "ok", intake, other: [{ label: "Entity type", value: "LLC" }], submittedAt: null, contactEmail: "dana@client.example" },
  answers: { state: "ok", blocks: [{ label: "Intake form", at: "2026-11-20", pairs: [{ question: "Any other marks?", answer: "A logo" }], score: null } as never] },
  files: { state: "ok", files: [], more: 0 },
  mail: { state: "ok", summary: { received: 0, sent: 0, newestReceived: null, subjects: [], withheld: 0 } },
  meetings: { state: "ok", meetings: [] },
  ...over,
});

describe("judgeFactsFromBrief", () => {
  it("maps the lead and the Lawmatics answers, and never carries an address", () => {
    const j = judgeFactsFromBrief(facts());
    expect(j).toMatchObject({ clientName: "Dana Ruiz", company: "Sankofa Brewing", mark: "SANKOFA", practiceArea: "Trademark", inquiry: "We brew beer and want to protect our name.", useInCommerce: "Since 2022", website: "https://sankofa.example", referralSource: "Instagram" });
    expect(j.sessionTime).toBe("Wed Nov 25, 2:00 PM EST");
    expect(JSON.stringify(j)).not.toContain("dana@client.example");
    expect(JSON.stringify(j)).not.toContain("555-0100");
  });

  it("every named value sits under a label that maps to its own fact, so it grounds a mark the same way", () => {
    const j = judgeFactsFromBrief(facts());
    expect(j.intake.find((p) => p.value === "SANKOFA")).toBeTruthy();
    expect(mapIntakeLabel(j.intake.find((p) => p.value === "SANKOFA")!.label)).toBe("mark");
    expect(mapIntakeLabel(j.intake.find((p) => p.value === "Since 2022")!.label)).toBe("useInCommerce");
    expect(markIsGrounded("sankofa", j)).toBe(true);
    expect(markIsGrounded("Nova Sphere", j)).toBe(false);
    expect(j.intake.map((p) => p.label)).toEqual(expect.arrayContaining(["Entity type", "Any other marks?"]));
  });

  it("with nothing read, every fact is null and the intake is empty, never the word null", () => {
    const j = judgeFactsFromBrief(facts({ lawmatics: { state: "unavailable" }, answers: { state: "unavailable" }, startsAt: null, lead: { ...lead, markText: null, businessName: null, practiceArea: null, referralSource: null, referralDetail: null } }));
    expect(j).toMatchObject({ mark: null, company: null, practiceArea: null, inquiry: null, sessionTime: null, referralSource: null });
    expect(j.intake).toEqual([]);
  });

  it("strips tags from answers and caps the pairs", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ label: `Q${i}`, value: `<b>A${i}</b>` }));
    const j = judgeFactsFromBrief(facts({ lawmatics: { state: "ok", intake, other: many, submittedAt: null, contactEmail: null } }));
    expect(j.intake.length).toBe(40);
    expect(JSON.stringify(j.intake)).not.toContain("<");
  });
});
