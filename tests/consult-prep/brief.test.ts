import { describe, expect, it } from "vitest";
import { BRIEF_FOOTER, CLIENT_WORDS_HEADING, NEXT_UPDATE_LINE, briefOwnWording, briefSubject, renderConsultBrief, sessionText, type BriefFacts } from "@/lib/consult-prep/brief";
import { hasJudgmentContent } from "@/lib/prep-consult/prep-consult";

const lead = { id: "l1", firstName: "Dana", lastName: "Ruiz", businessName: "Sankofa Brewing", email: "dana@client.example", phone: "555-0100", practiceArea: "Trademark", markText: "SANKOFA", referralSource: "Booth", referralDetail: "UGW 2026", stage: "Consultation Scheduled", lawmaticsId: null };
const facts = (over: Partial<BriefFacts> = {}): BriefFacts => ({
  lead,
  startsAt: "2026-11-25T19:00:00.000Z",
  joinUrl: "https://zoom.example/j/9",
  preparedAt: "2026-11-24T19:10:00.000Z",
  tz: "America/New_York",
  lawmatics: { state: "not-linked" },
  answers: { state: "ok", blocks: [] },
  files: { state: "ok", files: [], more: 0 },
  mail: { state: "ok", summary: { received: 0, sent: 0, newestReceived: null, subjects: [], withheld: 0 } },
  meetings: { state: "ok", meetings: [] },
  ...over,
});

describe("the consult brief", () => {
  it("has the skill's sections in order, ends with the footer, and the same facts in text and HTML", () => {
    const b = renderConsultBrief(facts());
    const order = ["Consult prep for Dana Ruiz", "Client snapshot", "What they need", "Mark(s)", "Lawmatics intake answers", CLIENT_WORDS_HEADING, "Files on file", "Prior contact", "Questions to cover"].map((h) => b.text.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, c) => a - c)).toEqual(order);
    expect(b.text.endsWith(BRIEF_FOOTER)).toBe(true);
    expect(BRIEF_FOOTER).toBe("Internal. Prepared by Lectual for the firm. Not legal advice. Never forward to the client.");
    expect(b.html).toContain("Client snapshot");
    expect(b.html).toContain(BRIEF_FOOTER);
    expect(b.text).toContain("Session: Wed Nov 25, 2:00 PM EST, join: https://zoom.example/j/9");
    expect(b.text).toContain("Prepared: Tue Nov 24, 2:10 PM EST");
    expect(b.text).toContain(NEXT_UPDATE_LINE);
    expect(b.text).toContain("Not drafted yet.");
  });

  it("a missing fact reads 'not recorded', never blank and never invented; no consult reads 'not recorded yet'", () => {
    const b = renderConsultBrief(facts({ startsAt: null, joinUrl: null, lead: { ...lead, phone: null, practiceArea: null, markText: null, businessName: null } }));
    expect(b.text).toContain("Session: not recorded yet");
    expect(b.text).toContain("- Phone: not recorded");
    expect(b.text).toContain("- Practice area: not recorded");
    expect(b.text).toContain("- Their inquiry: not recorded");
    expect(b.text).toContain("- not recorded"); // the mark
    expect(b.subject).toBe("Consult prep: Dana Ruiz · time not set");
  });

  it("with a session but no link, the join link is 'not recorded'", () => {
    expect(renderConsultBrief(facts({ joinUrl: null })).text).toContain("join link: not recorded");
  });

  it("practice area comes from the lead, else Lawmatics; what they need from their own answers, else Lawmatics", () => {
    const lawmatics = { state: "ok" as const, other: [], submittedAt: null, contactEmail: null, intake: { practiceArea: "Copyright", inquiry: "Wants to register a song", mark: "SONG", productsServices: null, company: null, useInCommerce: null, competitors: null, goals: null, consultFeePaid: null, website: null, referralSource: null } };
    const fromLm = renderConsultBrief(facts({ lawmatics, lead: { ...lead, practiceArea: null } })).text;
    expect(fromLm).toContain("- Practice area: Copyright");
    expect(fromLm).toContain("- Their inquiry: Wants to register a song");
    expect(fromLm).toContain("- SONG");
    const own = { state: "ok" as const, blocks: [{ label: "Intake form", at: "2026-11-20T10:00:00Z", score: null, pairs: [{ question: "Describe your business", answer: "Craft beer" }] }] };
    const fromAnswers = renderConsultBrief(facts({ lawmatics, answers: own })).text;
    expect(fromAnswers).toContain("- Describe your business Craft beer");
    expect(fromAnswers).not.toContain("Their inquiry: Wants to register a song");
    expect(fromAnswers).toContain("- Practice area: Trademark"); // the lead's own wins
  });

  it("the HTML escapes every value", () => {
    const evil = `<script>alert(1)</script> & "quotes"`;
    const b = renderConsultBrief(
      facts({
        lead: { ...lead, firstName: evil, businessName: evil, markText: evil },
        answers: { state: "ok", blocks: [{ label: "Intake form", at: "2026-11-20T10:00:00Z", score: null, pairs: [{ question: evil, answer: evil }] }] },
        files: { state: "ok", files: [{ name: evil, type: "file", at: "2026-11-20T10:00:00Z" }], more: 0 },
        mail: { state: "ok", summary: { received: 1, sent: 0, newestReceived: null, subjects: [evil], withheld: 0 } },
        meetings: { state: "ok", meetings: [{ title: evil, at: null, source: "Zoom" }] },
        lawmatics: { state: "ok", other: [{ label: evil, value: evil }], submittedAt: null, contactEmail: null, intake: { practiceArea: null, inquiry: evil, mark: evil, productsServices: evil, company: null, useInCommerce: evil, competitors: null, goals: null, consultFeePaid: null, website: null, referralSource: null } },
      }),
    );
    expect(b.html).not.toContain("<script>");
    expect(b.html).not.toMatch(/<\/script>/);
    expect(b.html).toContain("&lt;script&gt;");
    expect(b.html).toContain("&amp;");
    expect(b.html).toContain("&quot;quotes&quot;");
  });

  it("every recorded value has refusable fragments withheld; only the client's own words are shown as written", () => {
    const b = renderConsultBrief(
      facts({
        lead: { ...lead, markText: "CLASS 25 TEES", businessName: "Pay $500 Brewing", practiceArea: "Trademark class 9" },
        answers: { state: "ok", blocks: [{ label: "Intake form", at: "2026-11-20T10:00:00Z", score: null, pairs: [{ question: "Budget?", answer: "About $5,000 and a Class 25 filing" }] }] },
      }),
    );
    expect(hasJudgmentContent(briefOwnWording(facts({ lead: { ...lead, markText: "CLASS 25 TEES", businessName: "Pay $500 Brewing", practiceArea: "Trademark class 9" } })))).toBe(false);
    expect(b.text).toContain("[omitted]");
    expect(b.text).toContain("A: About $5,000 and a Class 25 filing"); // theirs, as written, in the labelled block
    expect(hasJudgmentContent(briefOwnWording(facts({ answers: { state: "ok", blocks: [{ label: "Intake form", at: "2026-11-20T10:00:00Z", score: null, pairs: [{ question: "Budget?", answer: "About $5,000" }] }] } })))).toBe(false);
  });

  it("the system's own wording passes the judgment guard, including the line about what comes next", () => {
    expect(hasJudgmentContent(briefOwnWording(facts()))).toBe(false);
    expect(hasJudgmentContent(NEXT_UPDATE_LINE)).toBe(false);
    expect(hasJudgmentContent(BRIEF_FOOTER)).toBe(false);
  });

  it("each unreadable source is named, never drawn as 'none'", () => {
    const b = renderConsultBrief(
      facts({
        lawmatics: { state: "unavailable" },
        answers: { state: "unavailable" },
        files: { state: "unavailable" },
        mail: { state: "unavailable" },
        meetings: { state: "unavailable" },
      }),
    );
    expect(b.text).toContain("Couldn't be read: Lawmatics did not answer.");
    expect(b.text).toContain("Couldn't be read: the intake and assessment answers did not answer.");
    expect(b.text).toContain("Couldn't be read: the file list did not answer.");
    expect(b.text).toContain("Mail: couldn't be read");
    expect(b.text).toContain("Meetings: couldn't be read");
    expect(b.text).not.toContain("No files uploaded yet.");
    expect(b.text).not.toContain("none on file");
  });

  it("an empty read is said as empty, and the not-connected and not-set-up cases have their own sentences", () => {
    const b = renderConsultBrief(facts({ lawmatics: { state: "not-connected" }, files: { state: "not-set-up" } }));
    expect(b.text).toContain("Lawmatics isn't connected for this firm");
    expect(b.text).toContain("File storage isn't switched on for your firm yet. Lectual will turn it on.");
    expect(renderConsultBrief(facts()).text).toContain("No files uploaded yet.");
    expect(renderConsultBrief(facts()).text).toContain("No intake or assessment answers on file.");
  });

  it("subjects: booked has no prefix; the reminders say Tomorrow and In 1 hour", () => {
    const f = facts();
    expect(briefSubject({ ...f, send: "booked" })).toBe("Consult prep: Dana Ruiz · Wed Nov 25, 2:00 PM EST");
    expect(briefSubject({ ...f, send: "24h" })).toBe("Tomorrow: Consult prep: Dana Ruiz · Wed Nov 25, 2:00 PM EST");
    expect(briefSubject({ ...f, send: "1h" })).toBe("In 1 hour: Consult prep: Dana Ruiz · Wed Nov 25, 2:00 PM EST");
    expect(renderConsultBrief({ ...f, send: "1h" }).subject.startsWith("In 1 hour: ")).toBe(true);
  });

  it("the session time is in the firm's zone, with the zone named", () => {
    expect(sessionText("2026-07-01T18:00:00.000Z", "America/New_York")).toBe("Wed Jul 1, 2:00 PM EDT");
    expect(sessionText("2026-07-01T18:00:00.000Z", "America/Los_Angeles")).toBe("Wed Jul 1, 11:00 AM PDT");
    expect(sessionText("nonsense", "America/New_York")).toBe("a time that could not be read");
  });
});

describe("review fixes: the emailed copy, the html order, never 'null'", () => {
  it("the emailed copy has no 'Prepared' line (prepared: false); the default copy still does", () => {
    expect(renderConsultBrief(facts()).text).toContain("Prepared:");
    const emailed = renderConsultBrief(facts(), { prepared: false });
    expect(emailed.text).not.toContain("Prepared:");
    expect(emailed.html).not.toContain("Prepared:");
    // a pure function of the facts: another preparedAt, the same email
    expect(renderConsultBrief(facts({ preparedAt: "2026-11-24T21:00:00.000Z" }), { prepared: false })).toEqual(emailed);
  });

  it("the html keeps the line order of the text: a list stays where it is, so 'Meetings' keeps its own items", () => {
    const b = renderConsultBrief(
      facts({
        mail: { state: "ok", summary: { received: 1, sent: 1, newestReceived: "2026-11-20T15:00:00.000Z", subjects: ["Hello there"], withheld: 0 } },
        meetings: { state: "ok", meetings: [{ title: "Intro call", at: "2026-11-01T15:00:00.000Z", source: "zoom" }] },
      }),
    );
    const html = b.html;
    const at = (needle: string) => html.indexOf(needle);
    expect(at("Mail: 1 message received")).toBeLessThan(at("Newest received"));
    expect(at("Newest received")).toBeLessThan(at("Subject: Hello there"));
    expect(at("Subject: Hello there")).toBeLessThan(at("<p>Meetings:</p>"));
    expect(at("<p>Meetings:</p>")).toBeLessThan(at("Intro call"));
    // the lines of Meetings are not above "Meetings:" in a list of their own
    expect(html).toMatch(/<p>Meetings:<\/p><ul><li>Intro call/);
  });

  it("an empty value reads 'not recorded', never 'null'", () => {
    const b = renderConsultBrief(
      facts({
        lawmatics: { state: "ok", intake: { practiceArea: null, inquiry: null, mark: null, productsServices: null, competitors: null, goals: null, consultFeePaid: null, website: null, useInCommerce: null, referralSource: null, company: null } as never, other: [{ label: "Budget", value: "   " }], submittedAt: null, contactEmail: null },
        files: { state: "ok", files: [{ name: "  ", type: "pdf", at: "" }], more: 0 },
        mail: { state: "ok", summary: { received: 1, sent: 0, newestReceived: null, subjects: ["   "], withheld: 0 } },
        meetings: { state: "ok", meetings: [{ title: " ", at: null, source: "zoom" }] },
      }),
    );
    expect(b.text).not.toMatch(/\bnull\b/);
    expect(b.html).not.toMatch(/\bnull\b/);
    expect(b.text).toContain("- Budget: not recorded");
    expect(b.text).toContain("- Subject: not recorded");
  });
});
