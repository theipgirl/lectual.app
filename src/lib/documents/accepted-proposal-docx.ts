import "server-only";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { formatDollars } from "@/lib/proposal-editor/events";
import { amountPaidMath, chartRowsFor, govFeesText } from "@/lib/proposals/loe-adapter";
import { MARK_KIND_LABEL, type AcceptedSnapshot } from "@/lib/proposals/types";

/**
 * A Word file of exactly what a client accepted (Sprint 19), for the matter's Engagement
 * folder in Lawmatics. Rendered from the frozen `accepted_snapshot`, never re-priced: the
 * package the client chose and its chart, the brand names with marks and classes, and the
 * legal fee and the USPTO fees as two separate figures that are never added.
 *
 * `acceptedProposalLines` is the text model (and what tests read); `renderAcceptedProposalDocx`
 * only lays it out. It records what was accepted. It does not advise.
 */

export type AcceptedProposalFacts = {
  clientName: string;
  entityName: string | null;
  /** The firm's zone: the accepted date is the firm's calendar date. */
  timeZone: string;
};

export type DocLine = { kind: "title" | "heading" | "text" | "bullet"; text: string };

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function longDate(iso: string, tz: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "long", day: "numeric" }).format(new Date(ms));
}

export function acceptedProposalLines(snapshot: AcceptedSnapshot, facts: AcceptedProposalFacts): DocLine[] {
  const { content, quote } = snapshot;
  const lines: DocLine[] = [];
  const entity = clean(facts.entityName);

  lines.push({ kind: "title", text: "Accepted proposal" });
  lines.push({ kind: "text", text: `Client: ${clean(facts.clientName)}${entity ? ` (${entity})` : ""}` });
  lines.push({ kind: "text", text: `Accepted: ${longDate(snapshot.accepted_at, facts.timeZone)}` });

  lines.push({ kind: "heading", text: "Package" });
  lines.push({ kind: "text", text: `Package: ${clean(content.pricing?.package)}` });
  for (const row of chartRowsFor(content)) lines.push({ kind: "bullet", text: row });

  lines.push({ kind: "heading", text: "Brand names, marks and classes" });
  for (const name of (Array.isArray(quote.names) ? quote.names : []).filter((n) => n.included)) {
    lines.push({ kind: "text", text: clean(name.name) });
    lines.push({ kind: "bullet", text: `Marks: ${name.marks.map((m) => MARK_KIND_LABEL[m.kind] ?? m.kind).join(", ")}` });
    lines.push({ kind: "bullet", text: `Classes: ${name.classes.map((c) => clean(c.label)).filter(Boolean).join("; ")}` });
  }

  lines.push({ kind: "heading", text: "Fees" });
  lines.push({ kind: "text", text: `Legal fee, due when accepted: ${formatDollars(quote.legal_total_cents)}` });
  const math = amountPaidMath(quote);
  if (math) lines.push({ kind: "text", text: `Legal fee math: ${math}` });
  lines.push({
    kind: "text",
    text: `USPTO fees, due at filing: ${govFeesText(quote, content.pricing?.gov_per_class_cents ?? 0, quote.gov_class_count)}`,
  });
  lines.push({ kind: "text", text: "The legal fee and the USPTO fees are two separate figures and are not added together." });
  lines.push({ kind: "text", text: "This is a record of what the client accepted on the proposal page." });
  return lines;
}

function paragraph(line: DocLine): Paragraph {
  switch (line.kind) {
    case "title":
      return new Paragraph({ text: line.text, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.LEFT });
    case "heading":
      return new Paragraph({ text: line.text, heading: HeadingLevel.HEADING_2 });
    case "bullet":
      return new Paragraph({ text: line.text, bullet: { level: 0 } });
    default:
      return new Paragraph({ children: [new TextRun(line.text)], spacing: { after: 160 } });
  }
}

/** "Sevetri Wilson - Accepted Proposal.docx", with anything a file name cannot hold removed. */
export function acceptedProposalFileName(clientName: string): string {
  const safe = clean(clientName).replace(/[\\/:*?"<>|]+/g, "").trim() || "Client";
  return `${safe} - Accepted Proposal.docx`;
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function renderAcceptedProposalDocx(
  snapshot: AcceptedSnapshot,
  facts: AcceptedProposalFacts,
): Promise<{ buffer: Buffer; fileName: string }> {
  const doc = new Document({ sections: [{ properties: {}, children: acceptedProposalLines(snapshot, facts).map(paragraph) }] });
  return { buffer: await Packer.toBuffer(doc), fileName: acceptedProposalFileName(facts.clientName) };
}
