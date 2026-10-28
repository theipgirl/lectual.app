import type { ProposalRow } from "@/lib/proposals/types";
import type { ActionState } from "@/app/dashboard/proposals/errors";

/**
 * "Change pay link" on a LIVE (sent) proposal (lectual 0100).
 *
 * 0089 freezes a sent version; 0100 lets exactly one field through: `pay_url`, alone, by a signed-in
 * proposal-writing role, never to blank. Accepted, replaced and withdrawn versions stay fully frozen.
 * The database writes the `edited` event itself (payload `{field: "pay_url", from_host, to_host}`,
 * hosts only), so nothing here writes an event.
 *
 * Pure: no database, no session. The action passes its dependencies in (like create-link.ts), so the
 * order and every refusal are tested without a database. Every sentence a person reads is fixed here.
 */

export const PAY_LINK_LABEL = "Change pay link";
export const PAY_LINK_UPDATED = "Pay link updated.";
export const PAY_LINK_NEEDS_DB_UPDATE = "Changing the pay link needs a database update.";
export const PAY_LINK_NOT_LIVE = "Only a proposal whose link is live can have its pay link changed.";
export const PAY_LINK_REQUIRED = "Enter the pay link.";
export const PAY_LINK_NOT_HTTPS = "The pay link must be an https:// address.";
export const PAY_LINK_TOO_LONG = "The pay link is too long (2,000 characters at most).";
export const PAY_LINK_UNCHANGED = "That is already this proposal's pay link.";
export const PAY_LINK_FAILED = "Couldn't change the pay link.";

const MAX = 2000;

/**
 * The same rules as the editor (`validateContent`'s pay_url) and 0089's CHECK
 * (`^https://[^[:space:]]+$`, at most 2,000 characters), plus: a live link always has one.
 */
export function parseLivePayLink(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, error: PAY_LINK_REQUIRED };
  if (value.length > MAX) return { ok: false, error: PAY_LINK_TOO_LONG };
  // 0089's CHECK is case-sensitive on the scheme and refuses any whitespace.
  if (/\s/.test(value) || !value.startsWith("https://")) return { ok: false, error: PAY_LINK_NOT_HTTPS };
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || !u.hostname) return { ok: false, error: PAY_LINK_NOT_HTTPS };
  } catch {
    return { ok: false, error: PAY_LINK_NOT_HTTPS };
  }
  return { ok: true, value };
}

export type ChangePayLinkDeps = {
  /** The module gate (notFound) and the staff-role check; a refusal is returned as is. */
  gate: () => Promise<ActionState | null>;
  /** The store write: scoped client, fenced on status `sent` and on `expectedUpdatedAt`. */
  change: (id: string, payUrl: string, expectedUpdatedAt: string) => Promise<ProposalRow>;
  /** Maps a thrown failure to the fixed sentence the person reads. */
  describe: (err: unknown, fallback: string) => ActionState;
  revalidate: (id: string) => void;
};

export type ChangePayLinkInput = { id: string; payUrl: unknown; updatedAt: string };

export async function runChangePayLink(deps: ChangePayLinkDeps, input: ChangePayLinkInput): Promise<ActionState> {
  const refused = await deps.gate();
  if (refused) return refused;

  const parsed = parseLivePayLink(input.payUrl);
  if (!parsed.ok) return { error: parsed.error };

  try {
    await deps.change(input.id, parsed.value, input.updatedAt);
  } catch (err) {
    return deps.describe(err, PAY_LINK_FAILED);
  }
  deps.revalidate(input.id);
  return { saved: true, notice: PAY_LINK_UPDATED };
}

/**
 * The 0100 `edited` event ({field: "pay_url", from_host, to_host}) as a clause, or null for any
 * other payload. Hosts only: the database never stores the URLs in the event.
 */
export function describePayLinkEvent(payload: Record<string, unknown>): string | null {
  if (payload.field !== "pay_url") return null;
  const host = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const from = host(payload.from_host);
  const to = host(payload.to_host);
  if (from && to && from !== to) return `changed the live pay link from ${from} to ${to}`;
  if (to) return `changed the live pay link (now ${to})`;
  return "changed the live pay link";
}
