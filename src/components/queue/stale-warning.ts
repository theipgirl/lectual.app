import type { StaleCheck } from "@/lib/queue/stale";
import { STOP_REASON_LABEL, shortDate, staleHeadline } from "@/lib/campaigns/stops";

/**
 * The approval page's wording for a StaleCheck. Pure, so the sentences are
 * pinned by tests/queue/stale.test.ts. Null means no warning.
 *
 * `confirm` is the label of the checkbox the approver must tick before the
 * Approve button works — and the server action refuses without it.
 */
export type StaleWarning = { headline: string; detail: string; confirm: string };

const LINKED_BY: Record<string, string> = {
  draft: "the lead this draft was written for",
  matter: "the lead on this draft's matter",
  recipient: "the lead with this recipient's address",
};

const PAST: Partial<Record<string, string>> = {
  signed: "signed the quote",
  paid: "paid",
  matter_opened: "had a matter opened",
  client: "became a client",
};

export function staleWarning(check: StaleCheck, timeZone?: string): StaleWarning | null {
  if (check.status === "stale") {
    const [first, ...rest] = check.facts;
    const also = rest.map((f) => `${STOP_REASON_LABEL[f.reason]} ${shortDate(f.at, timeZone)}`.trim());
    const whoRaw = check.leadName ?? LINKED_BY[check.linkedBy] ?? "this client";
    const who = whoRaw.charAt(0).toUpperCase() + whoRaw.slice(1);
    return {
      headline: `${staleHeadline(first, timeZone)} — this follow-up may be stale`,
      detail:
        `${who} ${PAST[first.reason] ?? STOP_REASON_LABEL[first.reason]} after this draft was queued` +
        (also.length ? ` (also: ${also.join("; ")})` : "") +
        ". Read it as if they're already a client before approving — or reject it.",
      confirm: "I've read this warning and still want to approve this draft",
    };
  }
  if (check.status === "unavailable") {
    return {
      headline: "Couldn't check whether this client has signed or paid",
      detail:
        "Lectual couldn't read the lead's quotes, payments or matters just now, so it can't say this follow-up is still current. Check before approving.",
      confirm: "I've checked this client's status myself",
    };
  }
  return null;
}
