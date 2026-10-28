import { isHiredStageName } from "@/lib/lawmatics/stage-map";
import type { LawmaticsSourceRecord } from "@/lib/lawmatics/normalize";
import { isPlaceholderEmail } from "@/lib/intake/email-match";
import type { SourceSignal } from "./types";

/**
 * What the firm's Lawmatics says about a lead's stage (read-only; see sources.ts).
 *
 * A lead finds its Lawmatics record by the Lawmatics id stored on it, else by ONE unambiguous email.
 * Two records sharing an email, or a placeholder address, never match.
 *
 * A Lawmatics stage NAME never chooses a Lectual stage (Taylor, Oct 27: Lawmatics' stages are not RPB's
 * workflow). It is shown as read-only text ("unmapped": cited on the row, never a vote), and the lead is
 * placed from the sheet, the notes, the mail and the Stage Keeper. The one thing a name still says is
 * "Hired" / "Hired Client": the person is a client, a `needs_matter` pointer to open a matter, never a stage.
 */

export type LawmaticsIndex = {
  byId: Map<string, LawmaticsSourceRecord>;
  byEmail: Map<string, LawmaticsSourceRecord[]>;
};

export function indexLawmatics(records: readonly LawmaticsSourceRecord[]): LawmaticsIndex {
  const byId = new Map<string, LawmaticsSourceRecord>();
  const byEmail = new Map<string, LawmaticsSourceRecord[]>();
  for (const record of records) {
    byId.set(String(record.lawmaticsId), record);
    const email = record.email?.trim().toLowerCase();
    if (email && !isPlaceholderEmail(email)) {
      const list = byEmail.get(email);
      if (list) list.push(record);
      else byEmail.set(email, [record]);
    }
  }
  return { byId, byEmail };
}

export function isHiredStage(name: string): boolean {
  return isHiredStageName(name);
}

export type LawmaticsMatch =
  | { kind: "record"; record: LawmaticsSourceRecord }
  | { kind: "none"; note?: string };

export function matchLawmatics(
  lead: { lawmaticsId: string | null; email: string | null },
  index: LawmaticsIndex,
): LawmaticsMatch {
  if (lead.lawmaticsId) {
    const byId = index.byId.get(String(lead.lawmaticsId));
    if (byId) return { kind: "record", record: byId };
  }
  const email = lead.email?.trim().toLowerCase();
  if (!email || isPlaceholderEmail(email)) return { kind: "none" };
  const candidates = index.byEmail.get(email) ?? [];
  if (candidates.length === 1) return { kind: "record", record: candidates[0] };
  if (candidates.length > 1) return { kind: "none", note: `${candidates.length} Lawmatics records share this email` };
  return { kind: "none" };
}

export function lawmaticsSignalFor(
  lead: { lawmaticsId: string | null; email: string | null },
  index: LawmaticsIndex,
): SourceSignal {
  const match = matchLawmatics(lead, index);
  if (match.kind === "none") return { kind: "none", note: match.note };
  const name = match.record.stageName?.trim();
  if (!name) return { kind: "none", note: "the Lawmatics record has no stage" };
  if (isHiredStage(name)) return { kind: "needs_matter", wording: name };
  return { kind: "unmapped", wording: name };
}
