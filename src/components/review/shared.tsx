import { documentsTag } from "@/lib/review/documents";
import { initials } from "@/lib/review/format";
import { limitTags, rowTags } from "@/lib/review/tags";
import type { ReviewRow } from "@/lib/review/buckets";
import { reviewHref, type ReviewParams } from "@/lib/review/params";
import { Pill } from "@/components/ui/Pill";
import { REVIEW_SHOWS_PROPOSALS } from "@/lib/review/scope";

type Member = { userId: string; name: string };

/** `params` is the page's URL state: every card link keeps it and adds `open=`, so the panel is shareable and Back closes it. */
export type Common = { /** The owner view draws the board look; every other view keeps the earlier markup. */ owner?: boolean; today: string; members: Member[]; canWrite: boolean; params: ReviewParams };

/** The review URL with this record's panel open. */
export function openHref(params: ReviewParams, row: Pick<ReviewRow, "kind" | "id">): string {
  return reviewHref({ ...params, open: { kind: row.kind, id: row.id } });
}

export function Avatar({ name }: { name: string }) {
  return (
    <span className="rv-avatar" role="img" title={name} aria-label={name}>
      {initials(name)}
    </span>
  );
}

export function Tags({ row, today, max, skip }: { row: ReviewRow; today: string; max?: number; /** Tags the card already says elsewhere (the column heading, the meta line). */ skip?: ("waiting" | "expiry")[] }) {
  // A proposal's expiry is never drawn in the first wave (REVIEW_SHOWS_PROPOSALS), whatever `skip` says.
  const all = rowTags(row, today).filter(
    (t) => !(skip?.includes("waiting") && t.text.startsWith("Waiting on ")) && !(row.proposalExpiry && t.text === row.proposalExpiry.text && (!REVIEW_SHOWS_PROPOSALS || skip?.includes("expiry"))),
  );
  const { shown, more } = limitTags(all, max ?? all.length);
  if (shown.length === 0) return null;
  return (
    <div className="rv-tags">
      {shown.map((t) => (
        <Pill key={t.text} tone={t.tone === "warn" ? "warn" : t.tone === "risk" ? "risk" : "mute"}>
          {t.text}
        </Pill>
      ))}
      {more > 0 && <Pill>+{more}</Pill>}
    </div>
  );
}

/** "3 documents" on a card, only when the count is known and above 0. A failed count read leaves the field unset, so nothing is drawn. */
export function DocTag({ row }: { row: Pick<ReviewRow, "documentCount"> }) {
  const text = documentsTag(row.documentCount);
  if (!text) return null;
  return (
    <div className="rv-tags">
      <Pill>{text}</Pill>
    </div>
  );
}
