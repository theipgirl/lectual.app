import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApplyBar, BULK_LABEL, ResultPanel, applyLabel } from "../../src/components/reconcile/ApplyBar";
import { ConfidenceBadge } from "../../src/components/reconcile/ConfidenceBadge";
import { EMPTY_TITLE, ReconcilePreview } from "../../src/components/reconcile/ReconcilePreview";
import { ReconcileTable } from "../../src/components/reconcile/ReconcileTable";
import { SourceCell } from "../../src/components/reconcile/SourceCell";
import { UploadPanel } from "../../src/components/reconcile/UploadPanel";
import { accept, pick } from "../../src/lib/reconcile/decisions";
import { proposeStage } from "../../src/lib/reconcile/propose";
import { RECONCILE_MESSAGES as MSG } from "../../src/lib/reconcile/rules";
import type { Decisions, ProposeSources, ReconcileRow, ReconcileSummary, ReconcileView } from "../../src/lib/reconcile/types";
import { S, STAGES, matter, none, stageName, stageSignal, unavailable, unmapped } from "./helpers";

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"');
const strip = (html: string) => text(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

let n = 0;
function row(name: string, sources: Partial<ProposeSources>, current = S.pnc): ReconcileRow {
  const all = { sheet: none(), lawmatics: none(), email: none(), ...sources };
  n += 1;
  return {
    leadId: `99999999-0000-4000-8000-${String(n).padStart(12, "0")}`,
    leadName: name,
    currentStageId: current,
    currentStageName: stageName(current),
    ...all,
    proposal: proposeStage({ currentStageId: current }, all, STAGES),
  };
}

const date = "2026-09-03T00:00:00.000Z";
const ROWS = {
  agree: row("Agnes Agree", { sheet: stageSignal(S.consult, "3. Consultation Scheduled", date), lawmatics: stageSignal(S.consult, "Discovery Call Scheduled") }),
  sheetOnly: row("Sheila Sheet", { sheet: stageSignal(S.loe, "6. LOE & Invoice Sent"), lawmatics: unavailable("Lawmatics isn't connected for your firm."), email: none() }),
  conflict: row("Connor Conflict", { sheet: stageSignal(S.consult), lawmatics: stageSignal(S.post, "Post Consultation") }),
  noEvidence: row("Nora None", { lawmatics: unmapped("Discovery Call No Show"), email: unavailable("The synced mail could not be read.") }),
  matter: row("Hana Hired", { sheet: stageSignal(S.consult), lawmatics: matter("Hired Client") }),
  clientSheet: row("Cleo Client", { sheet: matter("7. Signed LOE / Deposit Received") }),
  already: row("Alma Already", { sheet: stageSignal(S.pnc), lawmatics: stageSignal(S.pnc) }),
};
const ALL = Object.values(ROWS);
const pickable = STAGES.filter((s) => s.category !== "won").map((s) => ({ id: s.id, name: s.name }));

const rowHtml = (html: string, leadId: string) => {
  const start = html.indexOf(`data-lead="${leadId}"`);
  return html.slice(start, html.indexOf("</tr>", start));
};

describe("the table", () => {
  const html = text(renderToStaticMarkup(<ReconcileTable rows={ALL} pickable={pickable} decisions={{}} />));

  it("has the columns the screen promises, in order", () => {
    const head = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
    const labels = [...head.matchAll(/<th[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual(["Lead", "Current stage", "Sheet", "Lawmatics", "Email / calendar", "Evidence and last touch", "Proposed stage", "Confidence", "Decision"]);
  });

  it("shows, per row, the lead (linked to its page), current stage, the three sources, the proposal and the confidence", () => {
    const r = rowHtml(html, ROWS.agree.leadId);
    expect(r).toMatch(new RegExp(`<a[^>]*href="/dashboard/leads/${ROWS.agree.leadId}/?"[^>]*>Agnes Agree</a>`));
    expect(strip(r)).toContain("Potential New Client"); // current
    expect(strip(r)).toContain('Sheet says "3. Consultation Scheduled"');
    expect(strip(r)).toContain('Lawmatics says "Discovery Call Scheduled"');
    expect(strip(r)).toContain("Consultation Scheduled"); // proposed
    expect(r).toContain('data-confidence="agree"');
    expect(strip(r)).toContain("Agree");
  });

  it("has Accept, Pick another and Skip on a row that proposes a stage", () => {
    const r = rowHtml(html, ROWS.sheetOnly.leadId);
    expect(r).toMatch(/<button[^>]*>Accept<\/button>/);
    expect(r).toContain('aria-label="Pick another stage for Sheila Sheet"');
    expect(r).toMatch(/<button[^>]*>Skip<\/button>/);
  });

  it("shows all four confidences and the needs-a-matter state, each with its own words", () => {
    for (const [key, label] of [["agree", "Agree"], ["sheet_only", "Sheet only"], ["conflict", "Conflict"], ["no_evidence", "No evidence"]] as const) {
      expect(html).toContain(`data-confidence="${key}">${label}<`);
    }
    expect(html).toContain('data-confidence="needs_matter">Needs a matter<');
    const labels = ALL.map((r) => strip(renderToStaticMarkup(<ConfidenceBadge proposal={r.proposal} />)));
    expect(new Set(labels)).toEqual(new Set(["Agree", "Sheet only", "Conflict", "No evidence", "Needs a matter"]));
  });

  it("a needs-a-matter row has no Accept control, and links to Open a matter and to the lead", () => {
    for (const r of [ROWS.matter, ROWS.clientSheet]) {
      const h = rowHtml(html, r.leadId);
      expect(h).toContain("Needs a matter");
      expect(h).not.toContain(">Accept<");
      expect(h).not.toContain("Pick another stage");
      expect(h).toMatch(/<a[^>]*href="\/dashboard\/matters\/?"[^>]*>Open a matter<\/a>/);
      expect(h).toMatch(new RegExp(`href="/dashboard/leads/${r.leadId}/?"[^>]*>Open lead<`));
      expect(strip(h)).toContain(`Pick ${r.leadName} in the Open a matter form.`);
    }
  });

  it("a row that proposes nothing offers no Accept, but can still be picked or skipped", () => {
    for (const r of [ROWS.noEvidence, ROWS.already]) {
      const h = rowHtml(html, r.leadId);
      expect(h).not.toContain(">Accept<");
      expect(h).toContain("Pick another stage for");
      expect(h).toContain(">Skip<");
    }
    expect(strip(rowHtml(html, ROWS.already.leadId))).toContain("Already in this stage");
    expect(strip(rowHtml(html, ROWS.noEvidence.leadId))).toContain("None proposed");
  });

  it("the pick-another select lists the firm's stages and no stage that opens a matter", () => {
    const select = html.slice(html.indexOf("<select"), html.indexOf("</select>"));
    const options = [...select.matchAll(/<option[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(options).toEqual(["Pick another", ...STAGES.filter((s) => s.category !== "won").map((s) => s.name)]);
    expect(select).not.toContain("Signed LOE");
  });

  it("shows why for every row", () => {
    expect(strip(rowHtml(html, ROWS.conflict.leadId))).toContain("A source points elsewhere");
    expect(strip(rowHtml(html, ROWS.noEvidence.leadId))).toContain("The sheet has no row for this lead");
  });

  it("shows a held decision, and marks Accept pressed", () => {
    let d: Decisions = accept({}, ROWS.agree);
    d = pick(d, ROWS.sheetOnly.leadId, S.undecided, pickable);
    const h = text(renderToStaticMarkup(<ReconcileTable rows={ALL} pickable={pickable} decisions={d} />));
    expect(strip(rowHtml(h, ROWS.agree.leadId))).toContain("Will move to Consultation Scheduled");
    expect(rowHtml(h, ROWS.agree.leadId)).toMatch(/aria-pressed="true"/);
    expect(strip(rowHtml(h, ROWS.sheetOnly.leadId))).toContain("Will move to Undecided / Questions");
    expect(rowHtml(h, ROWS.sheetOnly.leadId)).toMatch(/<option value="[^"]+" selected="">Undecided/);
    expect(strip(rowHtml(h, ROWS.conflict.leadId))).not.toContain("Will move to");
  });
});

describe("the source cells", () => {
  const cell = (source: "sheet" | "lawmatics" | "email", signal: Parameters<typeof SourceCell>[0]["signal"]) =>
    text(renderToStaticMarkup(<SourceCell source={source} signal={signal} />));

  it("renders unavailable, unmapped, hired, client, none and a stage as five distinct texts", () => {
    const texts = [
      strip(cell("lawmatics", unavailable("Lawmatics isn't connected for your firm."))),
      strip(cell("lawmatics", unmapped("Discovery Call No Show"))),
      strip(cell("lawmatics", matter("Hired Client"))),
      strip(cell("sheet", matter("7. Signed LOE"))),
      strip(cell("email", none())),
      strip(cell("sheet", stageSignal(S.consult, "3. Consultation Scheduled"))),
    ];
    expect(texts[0]).toBe("Unavailable Lawmatics isn't connected for your firm.");
    expect(texts[1]).toContain("Unmapped: Discovery Call No Show");
    expect(texts[2]).toContain("Hired");
    expect(texts[3]).toContain("Client");
    expect(texts[4]).toBe("None");
    expect(texts[5]).toContain("Consultation Scheduled");
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("'Unavailable' is never rendered as 'None', and a note on None is shown", () => {
    const u = cell("email", unavailable("The synced mail could not be read."));
    expect(u).toContain("Unavailable");
    expect(u).not.toMatch(/>None</);
    expect(cell("email", none("mail found, but none of it names a stage"))).toContain("mail found, but none of it names a stage");
  });

  it("no cell in the table is blank, whatever the state", () => {
    const html = renderToStaticMarkup(<ReconcileTable rows={ALL} pickable={pickable} decisions={{}} />);
    const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
    expect(cells.length).toBe(ALL.length * 9);
    expect(cells.every((c) => c.length > 0)).toBe(true);
  });
});

describe("the bulk action and the apply button", () => {
  const bar = (over: Partial<Parameters<typeof ApplyBar>[0]> = {}) =>
    text(renderToStaticMarkup(<ApplyBar agreeing={0} accepted={0} busy={false} confirming={false} bulkMessage={null} {...over} />));

  it("offers the bulk action only when at least one row agrees", () => {
    expect(BULK_LABEL).toBe("Accept all where two or more sources agree");
    expect(bar({ agreeing: 2 })).toContain(BULK_LABEL);
    expect(bar({ agreeing: 0 })).not.toContain(BULK_LABEL);
  });

  it("the preview offers it for rows with an agree, and not for rows without", () => {
    const view = (rows: ReconcileRow[]): ReconcileView => ({ rows, pickable, summary: SUMMARY });
    const props = { decisions: {}, accepted: 0, busy: false, confirming: false, bulkMessage: null };
    expect(renderToStaticMarkup(<ReconcilePreview view={view(ALL)} {...props} />)).toContain(BULK_LABEL);
    expect(renderToStaticMarkup(<ReconcilePreview view={view([ROWS.sheetOnly, ROWS.conflict, ROWS.matter])} {...props} />)).not.toContain(BULK_LABEL);
  });

  it("states how many the bulk action marked", () => {
    expect(bar({ agreeing: 2, bulkMessage: "Marked 2 rows to move." })).toContain("Marked 2 rows to move.");
  });

  it("the Apply button shows the accepted count and is disabled at zero", () => {
    expect(applyLabel(0)).toBe("Apply 0 moves");
    expect(applyLabel(1)).toBe("Apply 1 move");
    expect(applyLabel(3)).toBe("Apply 3 moves");
    const zero = bar({ accepted: 0 });
    expect(zero).toMatch(/<button[^>]*disabled=""[^>]*>Apply 0 moves</);
    const three = bar({ accepted: 3 });
    expect(three).toMatch(/<button(?![^>]*disabled)[^>]*>Apply 3 moves</);
  });

  it("asks for a confirmation that names the count before anything runs", () => {
    const html = bar({ accepted: 3, confirming: true });
    expect(html).toContain("Move 3 leads to the chosen stages?");
    expect(html).toContain("Moves are logged on each lead's timeline.");
    expect(html).toContain("Yes, apply 3 moves");
    expect(html).toContain(">Cancel<");
    expect(bar({ accepted: 1, confirming: true })).toContain("Move 1 lead to");
    expect(bar({ accepted: 3, confirming: false })).not.toContain("Yes, apply");
  });
});

const SUMMARY: ReconcileSummary = {
  fileName: "intake.csv",
  confidence: { agree: 1, sheet_only: 1, single_source: 0, conflict: 1, no_evidence: 1 },
  needsMatter: 2,
  alreadyThere: 1,
  lawmatics: { status: "unavailable", reason: "Lawmatics returned only part of the firm's records." },
  email: { status: "unavailable", reason: "The synced mail could not be read." },
  sheet: { rowsRead: 12, intakeRows: 7, blankRows: 1 },
  sheetRowsWithoutLead: [{ row: 6, owner: "Desmond Okafor", mark: "Iron Fig", status: "4. Post Consultation Email Sent" }],
  refused: [{ row: 9, reason: "client, not intake — use import-tracker", status: "7. Signed LOE / Deposit Received" }],
  ambiguousLeads: 2,
  leadsTruncated: true,
};

describe("the summary and the empty states", () => {
  const view: ReconcileView = { rows: ALL, pickable, summary: SUMMARY };
  const html = text(renderToStaticMarkup(<ReconcilePreview view={view} decisions={{}} accepted={0} busy={false} confirming={false} bulkMessage={null} />));

  it("shows counts per confidence, per source, the rows left out and the truncated notice", () => {
    const s = strip(html);
    expect(s).toContain("intake.csv");
    expect(s).toContain("12 rows read, 7 intake leads, 1 blank");
    for (const label of ["Agree: 1", "Sheet only: 1", "Conflict: 1", "No evidence: 1", "Needs a matter: 2", "Already in the proposed stage: 1"]) expect(s).toContain(label);
    expect(s).toContain("Sheet: read");
    expect(s).toContain("Lawmatics: unavailable. Lawmatics returned only part of the firm's records.");
    expect(s).toContain("Email / calendar: unavailable. The synced mail could not be read.");
    expect(s).toContain("1 sheet rows have no lead in the app");
    expect(s).toContain("1 sheet rows were not used");
    expect(s).toContain("2 leads could not be matched to one sheet row");
    expect(html).toContain('data-truncated="true"');
    expect(s).toContain("Only part of the lead list was read");
  });

  it("lists the sheet rows with no lead and the refused rows, each with its reason", () => {
    const s = strip(html);
    expect(s).toContain("Row 6: Desmond Okafor (Iron Fig), 4. Post Consultation Email Sent");
    expect(s).toContain('Row 9, "7. Signed LOE / Deposit Received": client, not intake — use import-tracker');
    expect(s).toContain("These are listed, not created.");
  });

  it("names a Lawmatics that is not connected and a read one differently", () => {
    const base = { decisions: {}, accepted: 0, busy: false, confirming: false, bulkMessage: null };
    const render = (summary: ReconcileSummary) => strip(text(renderToStaticMarkup(<ReconcilePreview view={{ ...view, summary }} {...base} />)));
    const nc = render({ ...SUMMARY, lawmatics: { status: "not-connected", reason: "Lawmatics isn't connected for your firm." }, leadsTruncated: false });
    expect(nc).toContain("Lawmatics: not connected. Lawmatics isn't connected for your firm.");
    expect(nc).not.toContain("Only part of the lead list was read");
    const ok = render({
      ...SUMMARY,
      lawmatics: { status: "ok", records: 40, matched: 5 },
      email: { status: "ok", leadsWithMail: 0, note: "No synced mail was found for these leads. Nothing failed." },
    });
    expect(ok).toContain("Lawmatics: read (40 records, 5 matched)");
    expect(ok).toContain("Nothing failed.");
  });

  it("a preview with zero rows says why and is never a blank table", () => {
    const empty = text(renderToStaticMarkup(<ReconcilePreview view={{ ...view, rows: [] }} decisions={{}} accepted={0} busy={false} confirming={false} bulkMessage={null} />));
    expect(empty).toContain(EMPTY_TITLE);
    expect(empty).toContain("There are no leads in intake to compare");
    expect(empty).not.toContain("<table");
    expect(empty).not.toContain(BULK_LABEL);
    expect(empty).not.toContain("Apply 0 moves");
  });

  it("a failed lead read shows the error sentence and no table", () => {
    const html = text(renderToStaticMarkup(<UploadPanel busy={false} error={MSG.leadsUnreadable} />));
    expect(html).toContain('role="alert"');
    expect(html).toContain("problem reaching the database, not an empty pipeline");
    expect(html).not.toContain("<table");
  });
});

describe("the upload panel and the result panel", () => {
  it("has the CSV file control and the compare button", () => {
    const html = text(renderToStaticMarkup(<UploadPanel busy={false} error={null} />));
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".csv,text/csv"');
    expect(html).toContain("Compare with the app");
    expect(html).toContain("Reading changes nothing.");
    expect(text(renderToStaticMarkup(<UploadPanel busy error={null} />))).toMatch(/<button[^>]*disabled=""[^>]*>Reading the sheet</);
  });

  it("reports totals and each lead's outcome", () => {
    const html = strip(
      text(
        renderToStaticMarkup(
          <ResultPanel
            rows={ALL}
            result={{
              ok: true,
              totals: { moved: 1, already: 1, failed: 1 },
              outcomes: [
                { leadId: ROWS.agree.leadId, status: "moved", stageName: "Consultation Scheduled" },
                { leadId: ROWS.already.leadId, status: "already", stageName: "Potential New Client" },
                { leadId: ROWS.conflict.leadId, status: "failed", error: MSG.moveFailed },
              ],
            }}
          />,
        ),
      ),
    );
    expect(html).toContain("1 moved, 1 already there, 1 failed.");
    expect(html).toContain("Agnes Agree : moved to Consultation Scheduled");
    expect(html).toContain("Alma Already : already in Potential New Client");
    expect(html).toContain(`Connor Conflict : ${MSG.moveFailed}`);
    expect(html).toContain("Upload the sheet again");
  });

  it("a stale plan asks the person to upload again", () => {
    const html = strip(text(renderToStaticMarkup(<ResultPanel rows={ALL} result={{ ok: false, error: MSG.stale, stale: true }} />)));
    expect(html).toContain("This plan is out of date");
    expect(html).toContain("Upload the sheet again to build a fresh one.");
    expect(html).toContain("Upload the sheet again");
  });

  it("a run where every move failed is not shown as done", () => {
    const html = strip(text(renderToStaticMarkup(<ResultPanel rows={ALL} result={{ ok: false, error: MSG.allFailed, outcomes: [{ leadId: ROWS.agree.leadId, status: "failed", error: MSG.moveFailed }] }} />)));
    expect(html).toContain("Nothing was moved");
    expect(html).not.toContain("Done");
    expect(html).toContain(MSG.allFailed);
  });
});
