import { initials } from "@/lib/review/format";
import { limitTags, rowTags } from "@/lib/review/tags";
import type { ReviewRow } from "@/lib/review/buckets";
import { reviewHref, type ReviewParams } from "@/lib/review/params";

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
  const all = rowTags(row, today).filter((t) => !(skip?.includes("waiting") && t.text.startsWith("Waiting on ")) && !(skip?.includes("expiry") && row.proposalExpiry && t.text === row.proposalExpiry.text));
  const { shown, more } = limitTags(all, max ?? all.length);
  if (shown.length === 0) return null;
  return (
    <div className="rv-tags">
      {shown.map((t) => (
        <span key={t.text} className={`lp-pill${t.tone === "warn" ? " lp-pill-warn" : t.tone === "risk" ? " lp-pill-risk rv-deadline-soon" : ""}`}>
          {t.text}
        </span>
      ))}
      {more > 0 && <span className="lp-pill">+{more}</span>}
    </div>
  );
}
