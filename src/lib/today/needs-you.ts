import type { StalledMatter } from "@/lib/matters/docket-summary";
import type { DigestFailure } from "@/lib/agents/digest";

/**
 * "Needs you" on Today: every stuck or waiting thing in the firm, phrased as
 * the attorney's NEXT ACTION with one link. It replaces the old "Top of the
 * list" (src/lib/today/priorities.ts) and keeps every kind that list had
 * (overdue and near deadlines and tasks, drafts waiting, unclaimed hot leads,
 * matters gone quiet), adding: unconfirmed deadlines, quotes about to expire,
 * signed quotes with no payment recorded, agent runs that failed, connections
 * that need signing in again, intake submissions nobody has reviewed, and an
 * unreachable approval queue.
 *
 * Built only from real rows the loader read. Each source is `null` when its
 * read failed; that source then contributes no items and is NAMED in
 * `unavailable`, so a failed read never looks like "nothing needs you".
 *
 * Wording rule (UPL): the software says what is waiting and where to act. It
 * never says what the law requires or what the answer is.
 *
 * Pure, so the list is tested from fixtures.
 */

export type NeedsYouKind =
  | "deadline-overdue"
  | "deadline-confirm"
  | "deadline-soon"
  | "task"
  | "approval"
  | "queue-unreachable"
  | "quote-payment"
  | "quote-expiring"
  | "agent-failed"
  | "reconnect"
  | "intake-review"
  | "hot-lead"
  | "quiet-matter";

export type NeedsYouItem = {
  key: string;
  kind: NeedsYouKind;
  /** The next action, e.g. "Deadline in 5 days — confirm the date". */
  action: string;
  /** What it is about: the matter, client, draft or connection. */
  subject: string;
  detail: string | null;
  /** Who it is for: the signed-in person, or the firm (anyone may pick it up). */
  forYou: boolean;
  href: string;
  cta: string;
  tone: "risk" | "warn" | "ox" | "mute";
  score: number;
};

export type NeedsYouDeadline = {
  id: string;
  matterId: string;
  name: string;
  dueDate: string;
  confirmed: boolean;
  matterRef: string;
  ownerId: string | null;
};
export type NeedsYouTask = { id: string; title: string; dueDate: string; href: string; assigneeId: string | null };
export type NeedsYouQuote = {
  id: string;
  title: string;
  status: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  clientName: string | null;
  createdBy: string | null;
};
export type NeedsYouPayment = { quoteId: string | null; purpose: string; status: string };
export type NeedsYouConnection = {
  key: string;
  service: "mailbox" | "lawmatics" | "lawpay" | "fathom" | "zoom";
  label: string;
  /** For a personal mailbox, whose it is. Firm connections have none. */
  ownerId: string | null;
  href: string;
};
export type NeedsYouSubmission = { id: string; name: string; submittedAt: string };

export type NeedsYouInput = {
  userId: string;
  now: Date;
  deadlines: readonly NeedsYouDeadline[] | null;
  tasks: readonly NeedsYouTask[] | null;
  queue:
    | { status: "ok"; items: ReadonlyArray<{ id: string; headline: string; client_name: string | null; created_at: string }> }
    | { status: "unconfigured" }
    | { status: "unavailable" };
  quotes: readonly NeedsYouQuote[] | null;
  /** Payment rows for the accepted quotes above; null = couldn't be read (then no "record the payment" claims). */
  payments: readonly NeedsYouPayment[] | null;
  agentFailures: readonly DigestFailure[] | null;
  connections: readonly NeedsYouConnection[] | null;
  submissions: readonly NeedsYouSubmission[] | null;
  hotLeads: ReadonlyArray<{ id: string; name: string; reason: string | null }>;
  stalled: readonly StalledMatter[] | null;
};

export type NeedsYou = { items: NeedsYouItem[]; unavailable: string[] };

const DAY = 86_400_000;

function civil(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysUntil(dueDate: string, now: Date): number {
  return Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${civil(now)}T00:00:00Z`)) / DAY);
}
const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
const agoDays = (n: number) => (n === 1 ? "1 day ago" : `${n} days ago`);

/** Deadlines and tasks further out than this aren't "today". */
export const NEAR_DAYS = 14;
/** A sent quote this close to expiry gets a follow-up item. */
export const QUOTE_EXPIRY_DAYS = 7;
/** Signed quotes older than this with no payment are left to the Quotes page. */
export const SIGNED_LOOKBACK_DAYS = 90;
/** More unreviewed submissions than this collapse into one item. */
const SUBMISSION_ROLLUP = 3;

export function buildNeedsYou(input: NeedsYouInput): NeedsYou {
  const { now, userId } = input;
  const items: NeedsYouItem[] = [];
  const unavailable: string[] = [];

  // ── Docket deadlines ─────────────────────────────────────────────────────
  if (input.deadlines === null) unavailable.push("deadlines");
  else {
    for (const d of input.deadlines) {
      const n = daysUntil(d.dueDate, now);
      if (n > NEAR_DAYS) continue;
      const forYou = d.ownerId === userId;
      if (n < 0) {
        items.push({
          key: `d-${d.id}`,
          kind: "deadline-overdue",
          action: `Deadline passed ${agoDays(-n)}. Review it and record what happened`,
          subject: d.name,
          detail: d.matterRef,
          forYou,
          href: `/dashboard/matters/${d.matterId}/`,
          cta: "Open matter",
          tone: "risk",
          score: 1000 + Math.min(-n, 200),
        });
      } else if (!d.confirmed) {
        items.push({
          key: `d-${d.id}`,
          kind: "deadline-confirm",
          action: `Deadline ${inDays(n)}. Confirm the date`,
          subject: d.name,
          detail: d.matterRef,
          forYou,
          href: `/dashboard/matters/${d.matterId}/`,
          cta: "Confirm",
          tone: "warn",
          score: 600 + (NEAR_DAYS - n) * 5,
        });
      } else {
        items.push({
          key: `d-${d.id}`,
          kind: "deadline-soon",
          action: `Deadline ${inDays(n)}`,
          subject: d.name,
          detail: d.matterRef,
          forYou,
          href: `/dashboard/matters/${d.matterId}/`,
          cta: "Open matter",
          tone: n <= 3 ? "warn" : "mute",
          score: 500 + (NEAR_DAYS - n) * 5,
        });
      }
    }
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  if (input.tasks === null) unavailable.push("tasks");
  else {
    for (const t of input.tasks) {
      const n = daysUntil(t.dueDate, now);
      if (n > NEAR_DAYS) continue;
      items.push({
        key: `t-${t.id}`,
        kind: "task",
        action: n < 0 ? `Task overdue since ${agoDays(-n)}. Finish it or move the date` : `Task due ${inDays(n)}`,
        subject: t.title,
        detail: null,
        forYou: t.assigneeId === userId,
        href: t.href,
        cta: "Open",
        tone: n < 0 ? "risk" : "mute",
        score: n < 0 ? 950 + Math.min(-n, 40) : 450 + (NEAR_DAYS - n) * 3,
      });
    }
  }

  // ── Approval queue (three states, never two) ─────────────────────────────
  if (input.queue.status === "unavailable") {
    items.push({
      key: "queue-unreachable",
      kind: "queue-unreachable",
      action: "We couldn't reach the approval queue. Drafts may be waiting",
      subject: "Approval queue",
      detail: "This is not an empty queue. Check again shortly.",
      forYou: false,
      href: "/dashboard/queue/",
      cta: "Open Queue",
      tone: "risk",
      score: 900,
    });
  } else if (input.queue.status === "ok") {
    input.queue.items.forEach((q, i) => {
      const ageDays = (now.getTime() - Date.parse(q.created_at)) / DAY;
      items.push({
        key: `q-${q.id}`,
        kind: "approval",
        action: "Draft waiting for your approval",
        subject: q.headline || "A draft",
        detail: q.client_name ? `For ${q.client_name}` : null,
        forYou: false,
        href: `/dashboard/queue/${q.id}/`,
        cta: "Review",
        tone: "ox",
        score: 400 - Math.min(i, 30) * 2 + (ageDays >= 3 ? 60 : ageDays >= 1 ? 25 : 0),
      });
    });
  }

  // ── Quotes ───────────────────────────────────────────────────────────────
  if (input.quotes === null) unavailable.push("quotes");
  else {
    const paidOrPending = input.payments
      ? new Set(input.payments.filter((p) => p.purpose === "legal_fee" && (p.status === "succeeded" || p.status === "pending")).map((p) => p.quoteId))
      : null;
    if (input.payments === null && input.quotes.some((q) => q.status === "accepted")) unavailable.push("payments");
    for (const q of input.quotes) {
      const client = q.clientName ?? q.title;
      if (q.status === "sent" && q.expiresAt) {
        const left = Math.ceil((Date.parse(q.expiresAt) - now.getTime()) / DAY);
        if (left < 0 || left > QUOTE_EXPIRY_DAYS) continue;
        items.push({
          key: `qx-${q.id}`,
          kind: "quote-expiring",
          action: `Quote expires ${inDays(left)}, not signed yet. Follow up with the client`,
          subject: client,
          detail: q.title !== client ? q.title : null,
          forYou: q.createdBy === userId,
          href: `/dashboard/quotes/${q.id}/`,
          cta: "Open quote",
          tone: left <= 2 ? "warn" : "mute",
          score: 380 + (QUOTE_EXPIRY_DAYS - left) * 5,
        });
      } else if (q.status === "accepted" && paidOrPending && q.acceptedAt) {
        if (now.getTime() - Date.parse(q.acceptedAt) > SIGNED_LOOKBACK_DAYS * DAY) continue;
        if (paidOrPending.has(q.id)) continue;
        items.push({
          key: `qp-${q.id}`,
          kind: "quote-payment",
          action: "Quote signed. Record the payment",
          subject: client,
          detail: q.title !== client ? q.title : null,
          forYou: q.createdBy === userId,
          href: `/dashboard/quotes/${q.id}/`,
          cta: "Record payment",
          tone: "warn",
          score: 460,
        });
      }
    }
  }

  // ── Agents that couldn't finish ──────────────────────────────────────────
  if (input.agentFailures === null) unavailable.push("agent runs");
  else {
    for (const f of input.agentFailures) {
      items.push({
        key: `af-${f.agent}`,
        kind: "agent-failed",
        action: `Agent couldn't finish. ${f.action.label}`,
        subject: f.name,
        detail: f.reason,
        forYou: false,
        href: f.action.href,
        cta: f.action.label,
        tone: "risk",
        score: 700,
      });
    }
  }

  // ── Connections that need signing in again ───────────────────────────────
  if (input.connections === null) unavailable.push("connections");
  else {
    for (const c of input.connections) {
      const what = c.service === "lawpay" ? "Card payments are paused until LawPay is reconnected" : null;
      items.push({
        key: `rc-${c.key}`,
        kind: "reconnect",
        action: `${c.label} needs reconnecting`,
        subject: c.label,
        detail: what,
        forYou: c.ownerId === userId,
        href: c.href,
        cta: "Reconnect",
        tone: c.service === "lawpay" ? "risk" : "warn",
        score: c.service === "lawpay" ? 760 : 680,
      });
    }
  }

  // ── Intake submissions nobody has reviewed ───────────────────────────────
  if (input.submissions === null) unavailable.push("intake submissions");
  else if (input.submissions.length > SUBMISSION_ROLLUP) {
    items.push({
      key: "sub-rollup",
      kind: "intake-review",
      action: `${input.submissions.length} new intake submissions to review`,
      subject: "Intake forms",
      detail: null,
      forYou: false,
      href: "/dashboard/forms/?tab=performance",
      cta: "Review",
      tone: "ox",
      score: 330,
    });
  } else {
    for (const s of input.submissions) {
      items.push({
        key: `sub-${s.id}`,
        kind: "intake-review",
        action: "New intake submission. Review it",
        subject: s.name,
        detail: null,
        forYou: false,
        href: "/dashboard/forms/?tab=performance",
        cta: "Review",
        tone: "ox",
        score: 320,
      });
    }
  }

  // ── Hot leads nobody has picked up; matters gone quiet ───────────────────
  input.hotLeads.slice(0, 3).forEach((l, i) =>
    items.push({
      key: `h-${l.id}`,
      kind: "hot-lead",
      action: "Hot lead with no owner. Pick it up or assign it",
      subject: l.name,
      detail: l.reason,
      forYou: false,
      href: `/dashboard/leads/${l.id}/`,
      cta: "Open lead",
      tone: "warn",
      score: 350 - i,
    }),
  );
  if (input.stalled === null) unavailable.push("matters");
  else {
    input.stalled.slice(0, 5).forEach((m, i) =>
      items.push({
        key: `s-${m.id}`,
        kind: "quiet-matter",
        action: `Gone quiet: ${m.daysInStage} days in ${m.stageLabel}. Check in or move it on`,
        subject: m.label,
        detail: null,
        forYou: false,
        href: `/dashboard/matters/${m.id}/`,
        cta: "Open matter",
        tone: "mute",
        score: 300 + Math.min(m.daysOverThreshold, 90) - i,
      }),
    );
  }

  items.sort((a, b) => b.score - a.score || Number(b.forYou) - Number(a.forYou));
  return { items, unavailable };
}

/** What the section says when the list is empty. Never "all clear" over a failed read. */
export function emptyNeedsYouNote(n: Pick<NeedsYou, "unavailable">, queue: "ok" | "unconfigured" | "unavailable"): string {
  if (n.unavailable.length > 0) {
    return `Nothing to show from what loaded, but ${n.unavailable.join(", ")} couldn't be read, so this may not be the whole picture.`;
  }
  if (queue === "unconfigured") {
    return "Nothing is overdue or waiting on you. No approval queue is connected for this firm, so there are no drafts to count.";
  }
  return "Nothing is overdue or waiting on you.";
}
