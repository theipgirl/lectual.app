import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { splitNoteEntries } from "@/lib/matters/tracker-import";
import {
  activityPayloadForMessage,
  activityTypeFor,
  buildEmailEvidence,
  cadenceFor,
  cadenceLine,
  classifyEmail,
  corroborate,
  isPlaceholderEmail,
  matchMessageToLeads,
  namesMatch,
  recoverEmail,
  renderEmailReport,
  resolveMatch,
  staffInitialsFor,
  type EmailDirectoryMember,
  type EvidenceLead,
  type Touch,
} from "@/lib/intake/email-match";
import {
  fetchThreads,
  mergeThreadResponses,
  parseThreadsResponse,
  type ThreadMessage,
} from "@/lib/intake/email-threads";

/**
 * §12.2's pure layer, against the synthetic /api/mail/threads fixture. There is
 * no database here and no network: every name, mark and address is invented,
 * and the only firm domain in play is the one the fixture's mailbox carries.
 */

const RESPONSE = parseThreadsResponse(
  JSON.parse(readFileSync(new URL("../fixtures/intake/mail-threads.json", import.meta.url), "utf8")),
  "trademark@rpblawfirm.com",
);

const MESSAGES = RESPONSE.messages;
const byId = (id: string): ThreadMessage => {
  const found = MESSAGES.find((m) => m.id === id);
  if (!found) throw new Error(`fixture has no message ${id}`);
  return found;
};

const DIRECTORY: EmailDirectoryMember[] = [
  { userId: "user-dawn", email: "support@rpblawfirm.com", displayName: "Dawn Otiti" },
  { userId: "user-rayn", email: "rayn@rpblawfirm.com", displayName: "Rayn Lathome" },
  { userId: "user-taylor", email: "info@rpblawfirm.com", displayName: "Taylor McGhee" },
  { userId: "user-rebecca", email: "rebecca@rpblawfirm.com", displayName: "Rebecca Beliard" },
];

function lead(over: Partial<EvidenceLead> & Pick<EvidenceLead, "id" | "firstName" | "lastName">): EvidenceLead {
  return {
    businessName: null,
    email: `${over.id}@intake.invalid`,
    markText: null,
    stageName: "Follow-Up",
    assignedTo: null,
    lastOutboundAt: null,
    lastInboundAt: null,
    ...over,
  };
}

const LEADS: EvidenceLead[] = [
  lead({
    id: "lead-amara",
    firstName: "Amara",
    lastName: "Nwosu",
    email: "amara.nwosu@example.com",
    markText: "NWOSU NATURALS",
    stageName: "Preliminary Search",
  }),
  lead({ id: "lead-kwame", firstName: "Kwame", lastName: "Boateng", markText: "SANKOFA BREW" }),
  lead({ id: "lead-aya", firstName: "Mimi", lastName: "Toussaint" }),
  lead({
    id: "lead-patricia",
    firstName: "Patricia",
    lastName: "Morgan",
    email: "patricia.morgan@example.com",
    markText: "MORGAN METHOD",
  }),
  lead({ id: "lead-renee", firstName: "Renee", lastName: "Dubois", markText: "MAISON RENEE" }),
  lead({ id: "lead-jordan-design", firstName: "Jordan", lastName: "Ellis", businessName: "Ellis Design Co" }),
  lead({ id: "lead-jordan-bakes", firstName: "Jordan", lastName: "Ellis", businessName: "Ellis Bakes" }),
  lead({ id: "lead-hollis", firstName: "Hollis", lastName: "Vance", markText: "VANCE & CO" }),
  lead({
    id: "lead-desmond",
    firstName: "Desmond",
    lastName: "Okafor",
    email: "desmond.okafor@example.com",
    markText: "OKAFOR ROAST",
  }),
];

// ── the fixture itself ───────────────────────────────────────────────────────

describe("the mail-threads fixture", () => {
  it("parses as an ok, untruncated window of 25 messages in both directions", () => {
    expect(RESPONSE.status).toBe("ok");
    expect(RESPONSE.truncated).toBe(false);
    expect(MESSAGES).toHaveLength(25);
    expect(MESSAGES.some((m) => m.direction === "inbound")).toBe(true);
    expect(MESSAGES.some((m) => m.direction === "outbound")).toBe(true);
  });

  it("never carries a body — the endpoint does not fetch one", () => {
    for (const m of MESSAGES) {
      expect(Object.keys(m)).not.toContain("body");
      expect(m.preview.length).toBeLessThanOrEqual(300);
    }
  });
});

// ── name normalization ───────────────────────────────────────────────────────

describe("namesMatch", () => {
  it("accepts a nickname written in parentheses, in either direction", () => {
    expect(namesMatch("Mireille (Mimi) Toussaint", "Mimi Toussaint")).toBe(true);
    expect(namesMatch("Mimi Toussaint", "Mireille (Mimi) Toussaint")).toBe(true);
    // The given name on the record still matches the record.
    expect(namesMatch("Mireille (Mimi) Toussaint", "Mireille Toussaint")).toBe(true);
  });

  it("drops honorifics and middle names", () => {
    expect(namesMatch("Dr. Patricia Morgan", "Patricia Morgan")).toBe(true);
    expect(namesMatch("Theo R. Vandermeer", "Theo Vandermeer")).toBe(true);
    expect(namesMatch("Hollis Vance, Esq.", "Hollis Vance")).toBe(true);
  });

  it("folds diacritics and case", () => {
    expect(namesMatch("Renée Dubois", "Renee Dubois")).toBe(true);
    expect(namesMatch("renee DUBOIS", "Renée Dubois")).toBe(true);
  });

  it("requires the last name", () => {
    expect(namesMatch("Amara Okafor", "Amara Nwosu")).toBe(false);
    expect(namesMatch("Jordan Ellis", "Jordan Elias")).toBe(false);
  });

  it("matches a mononym on the last name alone", () => {
    expect(namesMatch("Okonjo", "Okonjo")).toBe(true);
    expect(namesMatch("Chidi Okonjo", "Okonjo")).toBe(true);
  });

  it("refuses to read a name out of an address in the name slot", () => {
    expect(namesMatch("amara.nwosu@example.com", "Amara Nwosu")).toBe(false);
    expect(namesMatch(null, "Amara Nwosu")).toBe(false);
    expect(namesMatch("", "Amara Nwosu")).toBe(false);
  });
});

describe("isPlaceholderEmail", () => {
  it("treats the reserved .invalid TLD, and no address at all, as a placeholder", () => {
    expect(isPlaceholderEmail("kwame.boateng@intake.invalid")).toBe(true);
    expect(isPlaceholderEmail(null)).toBe(true);
    expect(isPlaceholderEmail("")).toBe(true);
    expect(isPlaceholderEmail("amara.nwosu@example.com")).toBe(false);
  });
});

// ── matching ─────────────────────────────────────────────────────────────────

describe("matchMessageToLeads", () => {
  it("scores a real participant address at 1.0", () => {
    expect(matchMessageToLeads(byId("m03"), LEADS)).toEqual([
      { leadId: "lead-amara", confidence: 1, basis: "email" },
    ]);
  });

  it("scores name + mark at 0.9 and name alone at 0.7", () => {
    expect(matchMessageToLeads(byId("m06"), LEADS)[0]).toEqual({
      leadId: "lead-kwame",
      confidence: 0.9,
      basis: "name",
    });
    expect(matchMessageToLeads(byId("m07"), LEADS)).toEqual([
      { leadId: "lead-aya", confidence: 0.7, basis: "name" },
    ]);
  });

  it("scores a mark in the subject with no name agreement at 0.5", () => {
    expect(matchMessageToLeads(byId("m15"), LEADS)).toEqual([
      { leadId: "lead-hollis", confidence: 0.5, basis: "mark" },
    ]);
  });

  it("never matches on a placeholder address, which every address-less lead shares", () => {
    const twins = [
      lead({ id: "lead-a", firstName: "Ada", lastName: "Stone", email: "shared@intake.invalid" }),
      lead({ id: "lead-b", firstName: "Bo", lastName: "Reed", email: "shared@intake.invalid" }),
    ];
    const message: ThreadMessage = {
      ...byId("m03"),
      from: { name: null, address: "shared@intake.invalid" },
      to: [],
      cc: [],
      subject: "hello",
    };
    expect(matchMessageToLeads(message, twins)).toEqual([]);
  });

  it("returns every candidate, strongest first", () => {
    const candidates = matchMessageToLeads(byId("m14"), LEADS);
    expect(candidates.map((c) => c.leadId)).toEqual(["lead-jordan-bakes", "lead-jordan-design"]);
    expect(candidates.every((c) => c.confidence === 0.7)).toBe(true);
  });

  it("ignores a mark shorter than three characters rather than matching half the inbox", () => {
    const shortMark = [lead({ id: "lead-go", firstName: "Ida", lastName: "Quill", markText: "GO" })];
    expect(matchMessageToLeads(byId("m19"), shortMark)).toEqual([]);
  });
});

describe("resolveMatch", () => {
  it("returns null when no lead is a candidate at all", () => {
    expect(resolveMatch(matchMessageToLeads(byId("m18"), LEADS))).toBe(null);
  });

  it("resolves the single candidate at or above 0.7", () => {
    expect(resolveMatch(matchMessageToLeads(byId("m01"), LEADS))).toEqual({
      leadId: "lead-amara",
      confidence: 1,
      basis: "email",
    });
  });

  it("refuses when two leads both clear 0.7", () => {
    const resolved = resolveMatch(matchMessageToLeads(byId("m14"), LEADS));
    expect(resolved).toMatchObject({ ambiguous: true });
    expect(resolved && "candidates" in resolved && resolved.candidates).toHaveLength(2);
  });

  it("refuses a mark-only candidate — 0.5 is below the logging threshold", () => {
    expect(resolveMatch(matchMessageToLeads(byId("m15"), LEADS))).toMatchObject({ ambiguous: true });
  });
});

describe("recoverEmail", () => {
  const kwame = LEADS.find((l) => l.id === "lead-kwame")!;

  it("recovers a real address from a 0.9 match onto a placeholder lead", () => {
    expect(recoverEmail(kwame, { confidence: 0.9 }, byId("m06"))).toBe("kwame@sankofabrew.example");
  });

  it("recovers nothing from a 0.7 match", () => {
    const aya = LEADS.find((l) => l.id === "lead-aya")!;
    expect(recoverEmail(aya, { confidence: 0.7 }, byId("m07"))).toBe(null);
  });

  it("recovers nothing for a lead that already has a real address", () => {
    const amara = LEADS.find((l) => l.id === "lead-amara")!;
    expect(recoverEmail(amara, { confidence: 1 }, byId("m03"))).toBe(null);
  });

  it("prefers the participant whose display name is the lead's over a cc'd third party", () => {
    const message: ThreadMessage = {
      ...byId("m06"),
      cc: [{ name: "Ada Ledger CPA", address: "ada@ledgercpa.example" }],
    };
    expect(recoverEmail(kwame, { confidence: 0.9 }, message)).toBe("kwame@sankofabrew.example");
  });

  it("refuses to guess when no participant name matches and more than one is possible", () => {
    const message: ThreadMessage = {
      ...byId("m06"),
      to: [
        { name: null, address: "one@sankofabrew.example" },
        { name: null, address: "two@sankofabrew.example" },
      ],
    };
    expect(recoverEmail(kwame, { confidence: 0.9 }, message)).toBe(null);
  });

  it("never returns a firm address — the mailbox's own domain is excluded", () => {
    const message: ThreadMessage = { ...byId("m06"), to: [] };
    expect(recoverEmail(kwame, { confidence: 0.9 }, message)).toBe(null);
  });
});

// ── classification ───────────────────────────────────────────────────────────

describe("classifyEmail", () => {
  const cases: Array<[string, string]> = [
    ["Your legal strategy session link", "strategy-session-link"],
    ["Strategy Session confirmation", "strategy-session-link"],
    ["Discovery call — next steps", "discovery-call"],
    ["Post-consultation summary", "post-consult"],
    ["Post consult notes", "post-consult"],
    ["Following our call today", "post-consult"],
    ["Following up on your search", "follow-up"],
    ["Just checking in", "follow-up"],
    ["Circling back", "follow-up"],
    ["Your follow-up", "follow-up"],
    ["Engagement letter attached", "loe-invoice"],
    ["LOE and deposit", "loe-invoice"],
    ["Your invoice is ready", "loe-invoice"],
    ["Welcome to RPB Law", "welcome"],
    ["Please complete the questionnaire", "questionnaire"],
    ["Your intake form", "questionnaire"],
    ["Your interest form", "questionnaire"],
    ["Opinion letter attached", "opinion-letter"],
    ["Search opinion for your mark", "opinion-letter"],
    ["Re: your logo files", "other"],
  ];
  for (const [subject, type] of cases) {
    it(`files "${subject}" as ${type}`, () => {
      expect(classifyEmail(subject, "").type).toBe(type);
    });
  }

  it("does not read LOE out of the middle of another word", () => {
    expect(classifyEmail("Aloe branding files", "").type).toBe("other");
  });

  it("prefers the earlier rule when the firm's own vocabulary overlaps", () => {
    expect(classifyEmail("Post-consult follow up", "").type).toBe("post-consult");
    expect(classifyEmail("Welcome to your strategy session", "").type).toBe("strategy-session-link");
  });

  it("files a dispute thread as other, flagged sensitive", () => {
    expect(classifyEmail("Opposing counsel letter re OKAFOR ROAST", "")).toEqual({
      type: "other",
      sensitive: true,
    });
    for (const phrase of ["litigation", "dispute", "lawsuit", "settlement", "bar complaint"]) {
      expect(classifyEmail(`Re: ${phrase}`, "").sensitive).toBe(true);
    }
  });

  it("finds a sensitive phrase in the preview as well as the subject", () => {
    expect(classifyEmail("Quick question", "Their opposing counsel sent this yesterday.").sensitive).toBe(
      true,
    );
  });
});

// ── sender attribution ───────────────────────────────────────────────────────

describe("staffInitialsFor", () => {
  it("resolves a role mailbox to the person it belongs to", () => {
    expect(staffInitialsFor("support@rpblawfirm.com", DIRECTORY)).toBe("DO");
    expect(staffInitialsFor("INFO@rpblawfirm.com", DIRECTORY)).toBe("TM");
    expect(staffInitialsFor("rayn@rpblawfirm.com", DIRECTORY)).toBe("RL");
  });

  it("returns null for the shared mailbox and for anyone off the roster", () => {
    expect(staffInitialsFor("trademark@rpblawfirm.com", DIRECTORY)).toBe(null);
    expect(staffInitialsFor("amara.nwosu@example.com", DIRECTORY)).toBe(null);
    expect(staffInitialsFor(null, DIRECTORY)).toBe(null);
  });
});

// ── cadence ──────────────────────────────────────────────────────────────────

describe("cadenceFor", () => {
  const forLead = (ids: string[]) => cadenceFor(ids.map(byId), DIRECTORY);

  it("counts both directions, dates the last of each, and says whether they replied", () => {
    const cadence = forLead(["m21", "m01", "m02", "m03"]);
    expect(cadence.outboundCount).toBe(3);
    expect(cadence.inboundCount).toBe(1);
    expect(cadence.lastOutboundAt).toBe("2026-08-10T14:02:00Z");
    expect(cadence.lastInboundAt).toBe("2026-08-11T09:12:00Z");
    expect(cadence.replied).toBe(true);
  });

  it("takes the median gap between consecutive outbound touches", () => {
    // 7.28 → 8.3 is 6 days, 8.3 → 8.10 is 7: an even count, so the mean of the two.
    expect(forLead(["m21", "m01", "m02", "m03"]).medianGapDays).toBe(6.5);
    // 8.1 → 8.5 → 8.13 is 4 and 8.
    expect(forLead(["m04", "m05", "m06"]).medianGapDays).toBe(6);
    // 8.2 → 8.6 → 8.16 is 4 and 10.
    expect(forLead(["m11", "m12", "m13"]).medianGapDays).toBe(7);
  });

  it("has no median gap below two outbound touches", () => {
    expect(forLead(["m07", "m08"]).medianGapDays).toBe(null);
    expect(forLead(["m03"]).medianGapDays).toBe(null);
  });

  it("is not replied when the last touch is the firm's", () => {
    expect(forLead(["m16", "m17"]).replied).toBe(false);
    expect(forLead(["m04", "m05", "m06"]).replied).toBe(false);
  });

  it("drops a message with no timestamp rather than sorting it to the front", () => {
    const cadence = forLead(["m21", "m01", "m02", "m03", "m25"]);
    expect(cadence.touches).toHaveLength(4);
    expect(cadence.touches.some((t) => t.messageId === "m25")).toBe(false);
    expect(cadence.replied).toBe(true);
  });

  it("attributes each touch to a person, or leaves the shared mailbox unattributed", () => {
    const cadence = forLead(["m04", "m05", "m06"]);
    expect(cadence.touches.map((t) => t.staffInitials)).toEqual([null, "TM", "DO"]);
    expect(cadence.touches[0].fromAddress).toBe("trademark@rpblawfirm.com");
  });

  it("renders a cadence line the report can print verbatim", () => {
    expect(cadenceLine(forLead(["m21", "m01", "m02", "m03"]))).toBe(
      "3 out · 1 in · last out 2026-08-10 · last in 2026-08-11 · median gap 6.5 d · replied",
    );
  });
});

// ── corroboration ────────────────────────────────────────────────────────────

describe("corroborate", () => {
  const touches: Touch[] = cadenceFor(["m04", "m05", "m06"].map(byId), DIRECTORY).touches;
  const NOW = new Date("2026-09-14T12:00:00Z");

  it("pairs a dated note with the outbound touch of the same day", () => {
    const notes = splitNoteEntries("DO welcome email 8.1.26 TAM sent questionnaire 8.5.26", NOW);
    const rows = corroborate(notes, touches);
    expect(rows.filter((r) => r.status === "corroborated").map((r) => r.noteDate)).toEqual([
      "2026-08-01",
      "2026-08-05",
    ]);
    // The 8.13 send nobody logged.
    expect(rows.filter((r) => r.status === "email-only").map((r) => r.touchAt)).toEqual([
      "2026-08-13T12:00:00Z",
    ]);
  });

  it("accepts a day either side, and no more", () => {
    const inside = splitNoteEntries("DO sent LOE 8.14.26", NOW);
    expect(corroborate(inside, touches).find((r) => r.noteDate === "2026-08-14")?.status).toBe(
      "corroborated",
    );

    const outside = splitNoteEntries("DO sent LOE 8.15.26", NOW);
    expect(corroborate(outside, touches).find((r) => r.noteDate === "2026-08-15")?.status).toBe(
      "note-only",
    );
  });

  it("honours a widened tolerance when asked", () => {
    const notes = splitNoteEntries("DO sent LOE 8.15.26", NOW);
    expect(corroborate(notes, touches, 2).find((r) => r.noteDate === "2026-08-15")?.status).toBe(
      "corroborated",
    );
  });

  it("claims each touch once, so two nearby notes cannot both point at one send", () => {
    const notes = splitNoteEntries("DO sent LOE 8.13.26 RL chased it 8.14.26", NOW);
    const rows = corroborate(notes, touches);
    expect(rows.filter((r) => r.noteDate === "2026-08-13")[0].status).toBe("corroborated");
    expect(rows.filter((r) => r.noteDate === "2026-08-14")[0].status).toBe("note-only");
  });

  it("ignores notes with no date or no initials — neither can be confirmed", () => {
    const notes = splitNoteEntries("waiting on the client", NOW);
    expect(notes).toHaveLength(1);
    expect(corroborate(notes, touches).some((r) => r.status === "note-only")).toBe(false);
  });

  it("never reports an inbound message as a missing note", () => {
    const withReply = cadenceFor(["m07", "m08"].map(byId), DIRECTORY).touches;
    const rows = corroborate([], withReply);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "email-only", touchAt: "2026-08-06T10:00:00Z" });
  });
});

// ── the whole pass ───────────────────────────────────────────────────────────

describe("buildEmailEvidence", () => {
  const NOW = new Date("2026-09-14T12:00:00Z");
  const notesByLeadId = new Map([
    [
      "lead-kwame",
      splitNoteEntries("DO welcome email 8.1.26 TAM sent questionnaire 8.5.26 RL prelim search 7.1.26", NOW),
    ],
  ]);

  const report = buildEmailEvidence({
    messages: MESSAGES,
    leads: LEADS,
    directory: DIRECTORY,
    notesByLeadId,
  });

  const evidenceFor = (leadId: string) => {
    const found = report.leads.find((l) => l.lead.id === leadId);
    if (!found) throw new Error(`no evidence for ${leadId}`);
    return found;
  };

  it("accounts for every message exactly once", () => {
    const { totals } = report;
    expect(totals.messages).toBe(25);
    expect(totals.matched + totals.ambiguous + totals.unmatched).toBe(25);
  });

  it("matches the leads the fixture is about and nobody else", () => {
    expect(report.leads.map((l) => l.lead.id).sort()).toEqual([
      "lead-amara",
      "lead-aya",
      "lead-desmond",
      "lead-hollis",
      "lead-kwame",
      "lead-patricia",
      "lead-renee",
    ]);
  });

  it("reports the two Jordan Ellis threads and the mark-only one as ambiguous, never logged", () => {
    expect(report.ambiguous.map((a) => a.message.id).sort()).toEqual(["m14", "m15", "m24"]);
    const logged = report.leads.flatMap((l) => l.matched.map((m) => m.message.id));
    for (const id of ["m14", "m15", "m24"]) expect(logged).not.toContain(id);
  });

  it("leaves vendor mail unmatched", () => {
    expect(report.unmatched.map((m) => m.id).sort()).toEqual(["m18", "m19", "m20"]);
  });

  it("recovers the placeholder address from the 0.9 match and nothing weaker", () => {
    expect(evidenceFor("lead-kwame").recoveredEmail).toBe("kwame@sankofabrew.example");
    expect(evidenceFor("lead-aya").recoveredEmail).toBe(null);
    expect(evidenceFor("lead-renee").recoveredEmail).toBe(null);
    expect(report.totals.recoveries).toBe(1);
  });

  it("drops the preview of a sensitive thread everywhere it is carried", () => {
    const desmond = evidenceFor("lead-desmond");
    const sensitive = desmond.matched.find((m) => m.message.id === "m16");
    expect(sensitive).toMatchObject({ sensitive: true, type: "other" });
    expect(sensitive?.message.preview).toBe("");
    // The non-sensitive reply on the same thread keeps its own preview.
    expect(desmond.matched.find((m) => m.message.id === "m17")?.message.preview).not.toBe("");
    expect(report.totals.sensitive).toBe(1);
  });

  it("lists the senders seen, separating people from the shared mailbox", () => {
    const kwame = evidenceFor("lead-kwame");
    expect(kwame.senderInitials).toEqual(["DO", "TM"]);
    expect(kwame.senderMailboxes).toEqual(["trademark@rpblawfirm.com"]);
  });

  it("flags a lead whose newest touch is an inbound one the row had not seen", () => {
    expect(evidenceFor("lead-amara").newReply).toBe(true);
    expect(evidenceFor("lead-kwame").newReply).toBe(false);

    const alreadyKnown = buildEmailEvidence({
      messages: MESSAGES,
      leads: LEADS.map((l) =>
        l.id === "lead-amara" ? { ...l, lastInboundAt: "2026-08-11T09:12:00Z" } : l,
      ),
      directory: DIRECTORY,
    });
    expect(alreadyKnown.leads.find((l) => l.lead.id === "lead-amara")?.newReply).toBe(false);
  });

  it("does not re-flag a reply the row already holds in PostgREST's +00:00 form", () => {
    // The mail side is Graph's "…Z"; the column this script wrote it to reads
    // back as "…+00:00". Compared as strings those differ at index 19 and the
    // SAME instant looks newer forever — the bell would ring on every run.
    const sameInstant = buildEmailEvidence({
      messages: MESSAGES,
      leads: LEADS.map((l) =>
        l.id === "lead-amara" ? { ...l, lastInboundAt: "2026-08-11T09:12:00+00:00" } : l,
      ),
      directory: DIRECTORY,
    });
    expect(sameInstant.leads.find((l) => l.lead.id === "lead-amara")?.newReply).toBe(false);
  });

  it("carries the corroboration table through per lead", () => {
    const rows = evidenceFor("lead-kwame").corroboration;
    expect(rows.map((r) => r.status)).toEqual(["note-only", "corroborated", "corroborated", "email-only"]);
  });
});

// ── activity payload ─────────────────────────────────────────────────────────

describe("activity rows", () => {
  it("names the crm_activity type by direction", () => {
    expect(activityTypeFor("outbound")).toBe("email_sent");
    expect(activityTypeFor("inbound")).toBe("email_received");
  });

  it("writes the §12.2 payload, and no preview or body — not even a redacted one", () => {
    const payload = activityPayloadForMessage({
      message: byId("m06"),
      confidence: 0.9,
      basis: "name",
      type: "loe-invoice",
      sensitive: false,
    });
    expect(payload).toMatchObject({
      source: "intake-email-sync",
      message_id: "m06",
      conversation_id: "c-kwame",
      direction: "outbound",
      type: "loe-invoice",
      from: "support@rpblawfirm.com",
      to: ["kwame@sankofabrew.example"],
      mailbox: "trademark@rpblawfirm.com",
      basis: "name",
      confidence: 0.9,
    });
    expect(Object.keys(payload)).not.toContain("preview");
    expect(Object.keys(payload)).not.toContain("body");
  });
});

// ── rendering ────────────────────────────────────────────────────────────────

describe("renderEmailReport", () => {
  const markdown = renderEmailReport(
    buildEmailEvidence({ messages: MESSAGES, leads: LEADS, directory: DIRECTORY }),
    {
      orgName: "RPB Law",
      mailboxes: ["trademark@rpblawfirm.com", "intake@rpblawfirm.com"],
      since: "2026-07-20T00:00:00.000Z",
      until: null,
      apply: false,
    },
  );

  it("says it wrote nothing, and says what it is not", () => {
    expect(markdown).toContain("DRY RUN");
    expect(markdown).toContain("Nothing here was sent, drafted, or written to Lawmatics");
  });

  it("keeps the ambiguous, unmatched and sensitive sections even when they are not empty", () => {
    expect(markdown).toContain("## Ambiguous — reported, never logged (3)");
    expect(markdown).toContain("## Unmatched (3)");
    expect(markdown).toContain("## Sensitive threads (1)");
  });

  it("prints no preview text anywhere", () => {
    expect(markdown).not.toContain("Their opposing counsel sent this yesterday");
    expect(markdown).not.toContain("Please complete the attached questionnaire");
  });

  it("names the recovered address next to the row's placeholder", () => {
    expect(markdown).toContain("**kwame@sankofabrew.example** (recovered");
  });
});

// ── merging two mailboxes ────────────────────────────────────────────────────

describe("mergeThreadResponses", () => {
  it("counts a thread cc'd to both shared boxes as one touch", () => {
    const second = {
      ...RESPONSE,
      mailbox: "intake@rpblawfirm.com",
      messages: RESPONSE.messages.map((m) => ({ ...m, mailbox: "intake@rpblawfirm.com" })),
    };
    const merged = mergeThreadResponses([RESPONSE, second]);
    expect(merged.messages).toHaveLength(25);
    expect(merged.duplicates).toBe(25);
    // First mailbox on the command line wins, so the activity row names it.
    expect(merged.messages.every((m) => m.mailbox === "trademark@rpblawfirm.com")).toBe(true);
    expect(merged.complete).toBe(true);
  });

  it("is not complete when any mailbox failed — an unread box is never an empty one", () => {
    const failed = parseThreadsResponse({ status: "error", detail: "graph 503" }, "intake@rpblawfirm.com");
    const merged = mergeThreadResponses([RESPONSE, failed]);
    expect(merged.complete).toBe(false);
    expect(merged.sources.map((s) => s.status)).toEqual(["ok", "error"]);
  });
});

// ── the endpoint client ──────────────────────────────────────────────────────

describe("fetchThreads", () => {
  const call = (impl: typeof fetch) =>
    fetchThreads({
      apiUrl: "https://lawmatics-mcp.example",
      token: "test-token",
      mailbox: "trademark@rpblawfirm.com",
      since: "2026-07-20T00:00:00.000Z",
      fetchImpl: impl,
    });

  it("sends the mailbox and window as params, with a Bearer token", async () => {
    let seen: { url: string; init: RequestInit | undefined } | null = null;
    await call((async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ status: "ok", messages: [] }), { status: 200 });
    }) as typeof fetch);

    const captured = seen as unknown as { url: string; init: RequestInit };
    expect(captured.url).toContain("/api/mail/threads");
    expect(captured.url).toContain("mailbox=trademark%40rpblawfirm.com");
    expect(captured.url).toContain("since=2026-07-20");
    expect((captured.init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("reads an ok window", async () => {
    const res = await call((async () =>
      new Response(JSON.stringify({ status: "ok", count: 1, messages: [MESSAGES[0]] }), {
        status: 200,
      })) as typeof fetch);
    expect(res.status).toBe("ok");
    expect(res.messages).toHaveLength(1);
  });

  it("turns a 404 into an error, not an empty mailbox", async () => {
    // The endpoint answers a non-allowlisted mailbox with a bare 404 so that
    // "wrong address" and "not allowed" are indistinguishable from outside.
    const res = await call((async () => new Response(null, { status: 404 })) as typeof fetch);
    expect(res.status).toBe("error");
    expect(res.messages).toEqual([]);
    expect(res.detail).toContain("404");
  });

  it("turns a transport failure into an error rather than throwing", async () => {
    const res = await call((async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch);
    expect(res).toMatchObject({ status: "error", detail: "ECONNREFUSED", messages: [] });
  });

  it("never reports a non-ok body as ok", async () => {
    const res = await call((async () =>
      new Response(JSON.stringify({ status: "not-configured", detail: "Graph not enabled" }), {
        status: 503,
      })) as typeof fetch);
    expect(res.status).toBe("not-configured");
    expect(res.messages).toEqual([]);
  });
});
