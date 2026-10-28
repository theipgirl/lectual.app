import type { Role } from "@/lib/auth/roles";
import type { QueueItem } from "@/lib/queue/api";
import { QUEUE_APPROVE_ROLES, QUEUE_EDIT_ROLES } from "@/lib/queue/roles";

/**
 * Who an approval is for. The ONE place the kind rules, the attorney-only list and the approval rule live:
 * the Approvals page, the item page, `reviewQueueAction`, the dismiss action, Today's and the rail's count,
 * and Settings -> Approvals all call this file. Pure: no database, no server-only import.
 *
 * The queue service stores no owner. A KIND is derived from an item's type + agent + headline, and the owner
 * from the firm's routing (`client_proposal_setting.pricing.approval_routing = { <kind>: <member user id> }`).
 * Nothing is stored on the item, so changing the routing re-sorts every waiting item at once.
 */

export const QUEUE_KINDS = [
  "stalled_followup",
  "post_consult_email",
  "welcome_email",
  "engagement_letter",
  "opinion_letter",
  "internal_briefing",
  "partnership_other",
  "client_email_other",
] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

type KindInfo = { label: string; help: string; attorneyOnly: boolean };

/** Attorney-only kinds are the UPL line: only an attorney or owner-tier member may own or approve them. */
export const KIND_INFO: Record<QueueKind, KindInfo> = {
  stalled_followup: {
    label: "Follow-up for a stalled lead",
    help: "Routine nudges the morning brief drafts for leads that went quiet. Good to hand to a team member so attorneys only see legal emails.",
    attorneyOnly: false,
  },
  post_consult_email: {
    label: "Post-consult and proposal emails",
    help: "What a client is told after a consult, including the proposal link. Attorneys only.",
    attorneyOnly: true,
  },
  welcome_email: {
    label: "Welcome emails",
    help: "The first note to a new client. Can be handled by any team member.",
    attorneyOnly: false,
  },
  engagement_letter: {
    label: "Engagement letters",
    help: "Letters of engagement. Attorneys only.",
    attorneyOnly: true,
  },
  opinion_letter: {
    label: "Opinion and clearance letters",
    help: "Opinion letters and trademark clearance reports. Attorneys only.",
    attorneyOnly: true,
  },
  internal_briefing: {
    label: "Internal briefings and digests",
    help: "Morning briefs, inbox summaries and consult heads-ups. Nothing here goes to a client.",
    attorneyOnly: false,
  },
  partnership_other: {
    label: "Partnership and other follow-ups",
    help: "Partner and referral follow-ups that are not about a client matter.",
    attorneyOnly: false,
  },
  client_email_other: {
    label: "Other client emails",
    help: "Any client email that fits no other kind. Attorneys only, to be safe.",
    attorneyOnly: true,
  },
};

export const kindLabel = (kind: QueueKind): string => KIND_INFO[kind].label;
export const isAttorneyOnlyKind = (kind: QueueKind): boolean => KIND_INFO[kind].attorneyOnly;
export const isQueueKind = (value: unknown): value is QueueKind => typeof value === "string" && (QUEUE_KINDS as readonly string[]).includes(value);

/** The admin tier is the explicit override: it may act on an item routed to someone else. */
export const ROUTING_ADMIN_ROLES: readonly Role[] = ["owner", "admin", "senior_admin"];

export type RoutableItem = Pick<QueueItem, "type" | "agent" | "headline" | "recipient"> & Partial<Pick<QueueItem, "summary" | "draft_body" | "final_body">>;

/* ─────────────────────────────── kind ─────────────────────────────── */

// A client link made by the proposal flow: /p/<token>.
const PROPOSAL_LINK = /\/p\/[A-Za-z0-9_-]{32,64}/;

/**
 * Phrases that read as legal advice or an opinion on the outcome. This repo has no other legal-advice guard
 * on the queue, so this small table is it. Conservative on purpose: a false match only NARROWS who may approve.
 */
const LEGAL_ADVICE_PHRASES: RegExp[] = [
  /\b(likely|unlikely|probably|certain) to (be )?(register|registered|succeed|be approved|be refused|be rejected|be denied|prevail)/i,
  /\b(will|won't|will not|should) (be )?(register|registered|approved|refused|rejected|denied)\b/i,
  /\bchances? of (success|registration|approval|winning)\b/i,
  /\byou should (file|respond|abandon|appeal|not file|not respond|withdraw|oppose|sue)\b/i,
  /\b(we|i) (advise|recommend|suggest) (that )?you (file|respond|abandon|appeal|withdraw|oppose|not)\b/i,
  /\bmy legal advice\b/i,
  /\blegal advice\b/i,
  /\boffice action (response|strategy)\b/i,
  /\b(is|are) (not )?(infringing|infringement)\b/i,
  /\b(this|your|the) (mark|name|trademark) (does not|doesn't|will not|won't|would not|wouldn't) (infringe|conflict)\b/i,
  /\bguarantee[sd]? (registration|approval|success)\b/i,
];

/** True when the text reads as legal advice or an opinion; such an item is attorney-only whatever its kind. */
export function flagsLegalAdvice(text: string | null | undefined): boolean {
  if (!text) return false;
  return LEGAL_ADVICE_PHRASES.some((re) => re.test(text));
}

function bodyOf(item: RoutableItem): string {
  return `${item.final_body ?? item.draft_body ?? ""}`;
}

/**
 * The kind of an item, from its type, agent and headline (and whether it has a client recipient or carries a
 * proposal link). Anything unrecognised lands on `client_email_other`, which is attorney-only: the conservative kind.
 */
export function classifyQueueItem(item: RoutableItem): QueueKind {
  const headline = item.headline ?? "";
  switch (item.type) {
    case "BRIEFING":
      return "internal_briefing";
    case "ENGAGEMENT_LETTER":
      return "engagement_letter";
    case "OPINION_LETTER":
    case "TRADEMARK_CLEARANCE":
      return "opinion_letter";
  }
  if (item.agent === "document-center" || item.agent === "staff") {
    if (/\b(engagement|LOE)\b/i.test(headline)) return "engagement_letter";
    if (/\b(opinion|clearance)\b/i.test(headline)) return "opinion_letter";
  }
  if (item.type === "CLIENT_EMAIL") {
    if (item.agent === "morning-brief" && /^follow-up for a stalled lead/i.test(headline)) return "stalled_followup";
    if (item.agent === "welcome-client") return "welcome_email";
    if (item.agent === "post-consult" || PROPOSAL_LINK.test(bodyOf(item))) return "post_consult_email";
    if (/\bpartnership\b/i.test(headline)) return "partnership_other";
    return "client_email_other";
  }
  if (/\bpartnership\b/i.test(headline)) return "partnership_other";
  return "client_email_other";
}

/** Attorney-only by kind, or because the text reads as legal advice. */
export function isAttorneyOnly(item: RoutableItem): boolean {
  return isAttorneyOnlyKind(classifyQueueItem(item)) || flagsLegalAdvice(`${item.headline}\n${bodyOf(item)}`);
}

/* ─────────────────────────────── routing ─────────────────────────────── */

export type RoutingMember = { userId: string; role: Role; displayName?: string | null; email?: string | null };
export type ApprovalRouting = Partial<Record<QueueKind, string>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const memberName = (m: RoutingMember): string => m.displayName?.trim() || m.email?.trim() || "a teammate";

/** Members who may be an owner of `kind`: staff roles; attorney-only kinds take the approver roles only. */
export function eligibleOwners(kind: QueueKind, members: readonly RoutingMember[]): RoutingMember[] {
  const allowed: readonly Role[] = isAttorneyOnlyKind(kind) ? QUEUE_APPROVE_ROLES : QUEUE_EDIT_ROLES;
  return members.filter((m) => allowed.includes(m.role));
}

/** Why `memberId` cannot own `kind`, as a sentence; null when it can. */
export function routingChoiceError(kind: unknown, memberId: string, members: readonly RoutingMember[]): string | null {
  if (!isQueueKind(kind)) return "That kind of approval isn't one of the options. Refresh the page.";
  const member = members.find((m) => m.userId === memberId);
  if (!member) return "A person you picked isn't on your team any more. Refresh the page.";
  if (!eligibleOwners(kind, members).includes(member))
    return isAttorneyOnlyKind(kind) ? `${KIND_INFO[kind].label} can only go to an attorney or an owner.` : `${KIND_INFO[kind].label} can't go to ${memberName(member)}.`;
  return null;
}

/** The stored jsonb, narrowed to entries that are still valid. `dropped` counts the ones that were not. */
export function parseApprovalRouting(raw: unknown, members: readonly RoutingMember[]): { routing: ApprovalRouting; dropped: number } {
  const routing: ApprovalRouting = {};
  let dropped = 0;
  if (raw === null || raw === undefined) return { routing, dropped };
  if (typeof raw !== "object" || Array.isArray(raw)) return { routing, dropped: 1 };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isQueueKind(key) || typeof value !== "string" || !UUID.test(value) || routingChoiceError(key, value, members)) {
      dropped += 1;
      continue;
    }
    routing[key] = value;
  }
  return { routing, dropped };
}

/** The pricing jsonb with only `approval_routing` replaced; every other key is kept as it was. */
export function withApprovalRouting(pricing: Record<string, unknown>, routing: ApprovalRouting): Record<string, unknown> {
  return { ...pricing, approval_routing: { ...routing } };
}

export type Owner = { kind: "person"; userId: string } | { kind: "default" };

/**
 * Who an item is for. An item that reads as legal advice is for the usual approvers whatever its kind is routed
 * to, so a routed non-attorney never owns it.
 */
export function ownerOf(item: RoutableItem, routing: ApprovalRouting): Owner {
  const kind = classifyQueueItem(item);
  if (!isAttorneyOnlyKind(kind) && flagsLegalAdvice(`${item.headline}\n${bodyOf(item)}`)) return { kind: "default" };
  const userId = routing[kind];
  return userId ? { kind: "person", userId } : { kind: "default" };
}

export type Viewer = { userId: string; role: Role };

/**
 * May this caller approve or reject this item? With empty routing this is exactly "has an approver role".
 * Routed to a person: that person (if they hold a staff role) or the admin tier.
 */
export function canApproveItem(args: { role: Role | null | undefined; userId: string | null | undefined; item: RoutableItem; routing: ApprovalRouting }): boolean {
  const { role, userId, item, routing } = args;
  if (!role || !QUEUE_EDIT_ROLES.includes(role)) return false;
  const isApprover = QUEUE_APPROVE_ROLES.includes(role);
  if (isAttorneyOnly(item) && !isApprover) return false;
  const owner = ownerOf(item, routing);
  if (owner.kind === "default") return isApprover;
  return (!!userId && owner.userId === userId) || ROUTING_ADMIN_ROLES.includes(role);
}

/** The fixed sentence for a refusal; null when the caller may act. */
export function approvalRefusal(args: { role: Role | null | undefined; userId: string | null | undefined; item: RoutableItem; routing: ApprovalRouting; members?: readonly RoutingMember[] }): string | null {
  if (canApproveItem(args)) return null;
  const { role, item, routing, members } = args;
  if (isAttorneyOnly(item) && !(role && QUEUE_APPROVE_ROLES.includes(role))) return "Only an attorney can approve this kind of message.";
  const owner = ownerOf(item, routing);
  if (owner.kind === "person") {
    const who = members?.find((m) => m.userId === owner.userId);
    return `This one is for ${who ? memberName(who) : "someone else"}. Ask them to approve it, or an owner or admin.`;
  }
  return "Only an attorney can approve this kind of message.";
}

/** Owner as words for a row: "For Caitlyn" / "For the usual approvers". */
export function ownerText(item: RoutableItem, routing: ApprovalRouting, members: readonly RoutingMember[]): string {
  const owner = ownerOf(item, routing);
  if (owner.kind === "default") return "For the usual approvers";
  const who = members.find((m) => m.userId === owner.userId);
  return `For ${who ? memberName(who) : "a teammate"}`;
}

/* ─────────────────────────────── mine and counts ─────────────────────────────── */

const isDefaultApprover = (role: Role): boolean => QUEUE_APPROVE_ROLES.includes(role);

/** Is this item `userId`'s (a member with `role`)? Routed to them, or unrouted and they are a usual approver. */
export function isOwnedBy(item: RoutableItem, routing: ApprovalRouting, who: Viewer): boolean {
  const owner = ownerOf(item, routing);
  return owner.kind === "person" ? owner.userId === who.userId : isDefaultApprover(who.role);
}

export type PersonCount = { userId: string; name: string; count: number };
export type SwitchCounts = { mine: number; everyone: number; people: PersonCount[] };

/**
 * The numbers behind "Mine (N) · Rebecca (N) · Everyone (N)". An unrouted item counts under every usual approver.
 * The viewer has no pill of their own (that is Mine); a person with nothing waiting has none either.
 */
export function countsByPerson(items: readonly RoutableItem[], routing: ApprovalRouting, members: readonly RoutingMember[], viewer: Viewer | null): SwitchCounts {
  const people: PersonCount[] = [];
  for (const m of members) {
    if (viewer && m.userId === viewer.userId) continue;
    const count = items.filter((i) => isOwnedBy(i, routing, { userId: m.userId, role: m.role })).length;
    if (count > 0) people.push({ userId: m.userId, name: memberName(m), count });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  return { mine: viewer ? items.filter((i) => isOwnedBy(i, routing, viewer)).length : 0, everyone: items.length, people };
}

export type WhoFilter = { kind: "me" } | { kind: "all" } | { kind: "person"; userId: string };

/** `?who=` -> a filter. Mine only when the viewer can hold work; an unknown value falls back to the default. */
export function parseWho(raw: string | undefined, args: { mineEnabled: boolean; members: readonly RoutingMember[] }): WhoFilter {
  const fallback: WhoFilter = args.mineEnabled ? { kind: "me" } : { kind: "all" };
  if (raw === "all") return { kind: "all" };
  if (raw === "me") return fallback;
  if (raw && args.members.some((m) => m.userId === raw)) return { kind: "person", userId: raw };
  return fallback;
}

export function filterByWho<T extends RoutableItem>(items: readonly T[], who: WhoFilter, routing: ApprovalRouting, members: readonly RoutingMember[], viewer: Viewer | null): T[] {
  if (who.kind === "all") return [...items];
  if (who.kind === "me") return viewer ? items.filter((i) => isOwnedBy(i, routing, viewer)) : [];
  const m = members.find((x) => x.userId === who.userId);
  return m ? items.filter((i) => isOwnedBy(i, routing, { userId: m.userId, role: m.role })) : [];
}

/** The `who` query value for a filter. */
export const whoParam = (who: WhoFilter): string => (who.kind === "person" ? who.userId : who.kind);
