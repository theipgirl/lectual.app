import { describe, expect, it } from "vitest";
import { decideLinks, type MatchContext } from "@/lib/meetings/match";

const ctx: MatchContext = {
  leads: [
    { id: "lead-dana", email: "Dana@MarkRight.example" },
    { id: "lead-sam-1", email: "sam@shared.example" },
    { id: "lead-sam-2", email: "sam@shared.example" },
    { id: "lead-atty", email: "atty@firm.example" },
  ],
  contacts: [
    { id: "c-dana", email: "dana@markright.example" },
    { id: "c-pat", email: "pat@two.example" },
  ],
  matterContacts: [
    { contactId: "c-dana", matterId: "m-dana" },
    { contactId: "c-pat", matterId: "m-pat-1" },
    { contactId: "c-pat", matterId: "m-pat-2" },
  ],
  matters: [{ id: "m-dana", leadId: "lead-dana" }],
};

describe("attendee-email link rule", () => {
  it("exactly one lead and one matter share an attendee's email → both linked (case-insensitive)", () => {
    expect(decideLinks([{ name: "Dana", email: "DANA@markright.example" }], [], ctx)).toEqual({
      leadId: "lead-dana",
      matterId: "m-dana",
      suggestedLeadId: null,
      suggestedMatterId: null,
    });
  });

  it("two leads share the address → nothing auto-linked, one offered as a suggestion", () => {
    const d = decideLinks([{ name: "Sam", email: "sam@shared.example" }], [], ctx);
    expect(d.leadId).toBeNull();
    expect(d.suggestedLeadId).toBe("lead-sam-1");
  });

  it("a contact on two matters → matter suggested, not linked", () => {
    const d = decideLinks([{ name: "Pat", email: "pat@two.example" }], [], ctx);
    expect(d.matterId).toBeNull();
    expect(d.suggestedMatterId).toBe("m-pat-1");
  });

  it("the firm's own recorder/host is never matched, even if a lead has that address", () => {
    const d = decideLinks([{ name: "Atty", email: "atty@firm.example" }], ["atty@firm.example"], ctx);
    expect(d).toEqual({ leadId: null, matterId: null, suggestedLeadId: null, suggestedMatterId: null });
  });

  it("names alone never match", () => {
    const d = decideLinks([{ name: "Dana", email: null }], [], ctx);
    expect(d.leadId).toBeNull();
    expect(d.suggestedLeadId).toBeNull();
  });
});
