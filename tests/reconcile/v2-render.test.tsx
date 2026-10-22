import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceBlock } from "../../src/components/reconcile/EvidenceBlock";
import { NotInLectual } from "../../src/components/reconcile/NotInLectual";
import { ReconcilePreview } from "../../src/components/reconcile/ReconcilePreview";
import { ReconcileTable } from "../../src/components/reconcile/ReconcileTable";
import { SummaryStrip } from "../../src/components/reconcile/SummaryStrip";
import { ConfidenceBadge } from "../../src/components/reconcile/ConfidenceBadge";
import { evidenceLines, lastTouchLine, mailboxLine, rowNotesLine } from "../../src/lib/reconcile/describe";
import { proposeStage } from "../../src/lib/reconcile/propose";
import type { EvidenceItem, NotInLectualItem, ReconcileRow, ReconcileSummary, ReconcileView } from "../../src/lib/reconcile/types";
import { S, STAGES, none, stageName, stageSignal } from "./helpers";

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"');
const strip = (html: string) => text(html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

const E: EvidenceItem[] = [
  { source: "sheet", via: "note", milestone: "proposal_sent", label: "Proposal sent", date: "2026-10-16T00:00:00.000Z", stageId: S.post, snippet: "consult done - proposal sent" },
  { source: "email", via: "mailbox", milestone: "follow_up_sent", label: "Follow-up sent", date: "2026-10-18T09:00:00.000Z", stageId: null },
];

function row(over: Partial<ReconcileRow> = {}): ReconcileRow {
  const sources = { sheet: stageSignal(S.pnc, "1. Potential New Client", "2026-10-12T00:00:00.000Z"), lawmatics: none(), email: none() };
  return {
    leadId: "99999999-0000-4000-8000-000000000001",
    leadName: "Sevetra Wrenfield",
    currentStageId: S.pnc,
    currentStageName: stageName(S.pnc),
    ...sources,
    proposal: proposeStage({ currentStageId: S.pnc }, sources, STAGES, E),
    evidence: E,
    lastTouch: "2026-10-18T09:00:00.000Z",
    mailbox: { status: "ok", messages: 2, sent: 2, received: 0, truncated: false, mailboxes: 1, unread: 0 },
    notes: { status: "ok", count: 1 },
    ...over,
  };
}

describe("evidence lines on a row", () => {
  const html = renderToStaticMarkup(<EvidenceBlock evidence={E} lastTouch="2026-10-18T09:00:00.000Z" mailbox={row().mailbox} notes={{ status: "ok", count: 1 }} />);
  const s = strip(html);

  it("cites each piece with its source and date, newest-first as the proposal ordered them", () => {
    expect(s).toContain("Proposal sent Oct 16 (sheet note)");
    expect(s).toContain("Follow-up sent Oct 18 (mailbox search)");
  });

  it("shows the note snippet (at most 140 characters, from memory) in quotes", () => {
    expect(s).toContain("consult done - proposal sent");
  });

  it("shows the proposed last touch with the year", () => {
    expect(s).toContain("Proposed last touch: Oct 18, 2026");
    expect(html).toContain("data-last-touch");
  });

  it("states what the two fallible reads found", () => {
    expect(s).toContain("Lawmatics notes: 1 read.");
    expect(s).toContain("Mailbox search: 2 messages in the last 120 days.");
  });
});

describe("a read that failed is said in the warn tone, never as 'nothing found'", () => {
  it("mailbox states", () => {
    const html = renderToStaticMarkup(
      <EvidenceBlock evidence={[]} lastTouch={null} mailbox={{ status: "unavailable", code: "module-off", reason: "The Mailboxes module isn't switched on for this firm, or it couldn't be checked, so no mailbox was searched." }} notes={{ status: "unavailable", reason: "Lawmatics notes couldn't be read for this record." }} />,
    );
    const s = strip(html);
    expect(s).toContain("No dated evidence.");
    expect(s).toContain("No dated touch found.");
    expect(s).toContain("Mailbox search: not done. The Mailboxes module isn't switched on");
    expect(s).toContain("Lawmatics notes: couldn't be read.");
    expect(html.match(/class="rc-warn"/g)).toHaveLength(2);
  });

  it("no address is not alarming and a truncated search says so", () => {
    expect(mailboxLine({ status: "unavailable", code: "no-address", reason: "This person has no real email address to search for." })).toMatch(/no real email address/);
    expect(mailboxLine({ status: "ok", messages: 25, sent: 20, received: 5, truncated: true, mailboxes: 2, unread: 1 })).toBe(
      "Mailbox search: 25 messages in the last 120 days, showing the newest 25, 1 of 3 mailboxes couldn't be searched.",
    );
    expect(mailboxLine(undefined)).toBeNull();
    expect(rowNotesLine({ status: "not-read" })).toBe("Lawmatics notes: not read.");
    expect(lastTouchLine(null)).toBe("No dated touch found.");
    expect(evidenceLines(undefined)).toEqual([]);
  });
});

describe("the table gains the evidence column, with the agree / conflict badges", () => {
  const pickable = STAGES.filter((s) => s.category !== "won").map((s) => ({ id: s.id, name: s.name }));
  const html = renderToStaticMarkup(<ReconcileTable rows={[row()]} pickable={pickable} decisions={{}} />);
  const s = strip(html);

  it("has the column and the row's evidence, last touch and proposal", () => {
    expect(s).toContain("Evidence and last touch");
    expect(s).toContain("Proposal sent Oct 16 (sheet note)");
    expect(s).toContain("Proposed last touch: Oct 18, 2026");
    expect(s).toContain("Post Consultation Email Sent");
  });

  it("the badge for a status behind the notes is Conflict", () => {
    expect(html).toContain('data-confidence="conflict"');
    expect(s).toContain("Conflict");
  });

  it("the new One source badge has its own words", () => {
    const html1 = renderToStaticMarkup(<ConfidenceBadge proposal={{ ...row().proposal, confidence: "single_source" }} />);
    expect(strip(html1)).toBe("One source");
  });
});

const person = (over: Partial<NotInLectualItem> = {}): NotInLectualItem => ({
  key: "sheet:17",
  found: "sheet",
  name: "Ottoline Marchbanks",
  detail: "Sheet row 17: 1. Potential New Client (Inkwell)",
  candidate: { found: "sheet", firstName: "Ottoline", lastName: "Marchbanks", businessName: null, email: "o@m.example", sheetKey: "abc", lawmaticsId: null, stageId: S.pnc, practiceArea: "Trademark" },
  evidence: E,
  lastTouch: "2026-10-18T09:00:00.000Z",
  mailbox: { status: "unavailable", code: "gmail-only", reason: "Only Gmail mailboxes are connected and they aren't searched here. Connect an Outlook mailbox to search mail." },
  ...over,
});

describe("Not in Lectual yet", () => {
  it("lists each person with evidence and a Create lead button with an accessible name", () => {
    const html = renderToStaticMarkup(<NotInLectual items={[person(), person({ key: "lm:700", found: "lawmatics", name: "Rosalind Fairweather", detail: 'Lawmatics, stage "Proposal Sent"' })]} total={2} created={{}} busyKey={null} />);
    const s = strip(html);
    expect(s).toContain("Not in Lectual yet");
    expect(s).toContain("Ottoline Marchbanks");
    expect(s).toContain("Rosalind Fairweather");
    expect(s).toContain('Lawmatics, stage "Proposal Sent"');
    expect(html).toContain('aria-label="Create lead for Ottoline Marchbanks"');
    expect(html).toContain('aria-label="Create lead for Rosalind Fairweather"');
    expect(s).toContain("Nothing is created until you press Create lead.");
    expect(s).toContain("Mailbox search: not done. Only Gmail mailboxes");
  });

  it("renders nothing when there is nobody to list", () => {
    expect(renderToStaticMarkup(<NotInLectual items={[]} total={0} created={{}} busyKey={null} />)).toBe("");
  });

  it("while one is being created every button is disabled and that one says so", () => {
    const html = renderToStaticMarkup(<NotInLectual items={[person(), person({ key: "sheet:18", name: "Peregrine Dunmore" })]} total={2} created={{}} busyKey="sheet:17" />);
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
    expect(strip(html)).toContain("Creating…");
  });

  it("after creation shows a link to the lead, not a second button; a refusal is an alert", () => {
    const html = renderToStaticMarkup(
      <NotInLectual items={[person(), person({ key: "sheet:18", name: "Peregrine Dunmore" })]} total={2} created={{ "sheet:17": { leadId: "lead-1" }, "sheet:18": { error: "A lead for this person already exists, so no second one was created." } }} busyKey={null} />,
    );
    // next/link drops the trailing slash when rendered outside the app.
    expect(html).toMatch(/href="\/dashboard\/leads\/lead-1\/?"/);
    expect(html).not.toContain('aria-label="Create lead for Ottoline Marchbanks"');
    expect(html).toContain('role="alert"');
    expect(strip(html)).toContain("Created. Upload the sheet again to reconcile this lead.");
  });

  it("says how many more are not listed", () => {
    expect(strip(renderToStaticMarkup(<NotInLectual items={[person()]} total={140} created={{}} busyKey={null} />))).toContain("139 more are not listed here.");
  });

  it("a click asks the screen to create exactly that person", () => {
    const calls: string[] = [];
    const tree = NotInLectual({ items: [person()], total: 1, created: {}, busyKey: null, onCreate: (i) => calls.push(i.key) }) as unknown as { props: { children: unknown } };
    const find = (node: unknown): Array<{ props?: Record<string, unknown> }> => {
      if (!node || typeof node !== "object") return [];
      const n = node as { props?: { children?: unknown; onClick?: unknown } };
      return [n, ...(Array.isArray(n.props?.children) ? n.props!.children.flatMap(find) : find(n.props?.children))];
    };
    const button = find(tree).find((n) => typeof n.props?.onClick === "function");
    (button!.props!.onClick as () => void)();
    expect(calls).toEqual(["sheet:17"]);
  });
});

const SUMMARY: ReconcileSummary = {
  fileName: "book.csv",
  sectionsLine: "Read: Trademark intake (3 sections, 1,170 rows). Skipped: Tasks, Contracts.",
  notes: { status: "unavailable", reason: "Lawmatics notes couldn't be read for this record." },
  mailbox: { searched: 3, unavailable: 2, note: "Only Gmail mailboxes are connected and they aren't searched here. Connect an Outlook mailbox to search mail." },
  mappingNote: "The firm's own stage mapping couldn't be read, so the default stage names were used. Check each proposal before accepting it.",
  notInLectual: [person()],
  notInLectualTotal: 1,
  confidence: { agree: 0, sheet_only: 0, single_source: 1, conflict: 1, no_evidence: 0 },
  needsMatter: 0,
  alreadyThere: 0,
  lawmatics: { status: "ok", records: 4, matched: 1 },
  email: { status: "ok", leadsWithMail: 1, note: null },
  sheet: { rowsRead: 1200, intakeRows: 1100, blankRows: 40 },
  sheetRowsWithoutLead: [{ row: 17, owner: "Ottoline Marchbanks", mark: "Inkwell", status: "1. Potential New Client" }],
  refused: [],
  ambiguousLeads: 0,
  leadsTruncated: false,
};

describe("the summary", () => {
  const s = strip(renderToStaticMarkup(<SummaryStrip summary={SUMMARY} />));

  it("says which sections were read and skipped", () => {
    expect(s).toContain("Read: Trademark intake (3 sections, 1,170 rows). Skipped: Tasks, Contracts.");
  });

  it("names the notes, mailbox and mapping problems, and counts the new confidence", () => {
    expect(s).toContain("Lawmatics notes: unavailable.");
    expect(s).toContain("Mailbox search: Only Gmail mailboxes");
    expect(s).toContain("default stage names were used");
    expect(s).toContain("One source: 1");
    expect(s).toContain("Conflict: 1");
  });

  it("a full preview shows Not in Lectual yet and does not repeat the same people in the old no-lead list", () => {
    const view: ReconcileView = { rows: [row()], pickable: [], summary: SUMMARY };
    const html = renderToStaticMarkup(<ReconcilePreview view={view} decisions={{}} accepted={0} busy={false} confirming={false} bulkMessage={null} />);
    expect(strip(html)).toContain("Not in Lectual yet");
    expect(html).toContain('aria-label="Create lead for Ottoline Marchbanks"');
    expect(strip(html)).not.toContain("These are listed, not created.");
  });
});
