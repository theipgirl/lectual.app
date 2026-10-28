import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";
import { PROVIDER_LABEL, type MeetingProvider } from "@/lib/meetings/types";

/**
 * What one source did when "Sync new meetings" ran it. `importNowAction` reports its outcome in this shape
 * so the merge below never has to read its sentences.
 */
export type SyncOutcome =
  | { kind: "imported"; inserted: number }
  | { kind: "not-connected" }
  /** The connection exists but the provider no longer accepts it (or it is not active). */
  | { kind: "reauth" }
  | { kind: "failed" }
  | { kind: "refused" }
  | { kind: "not-switched-on" };

export type SourceSync = { provider: MeetingProvider; outcome: SyncOutcome };

export type SyncSummary = {
  /** "error" is drawn as an alert; a clean run is a quiet status line. */
  tone: "ok" | "error";
  text: string;
  /** Show the Reconnect link (Settings -> Integrations -> Meetings). */
  reconnect: boolean;
  inserted: number;
};

const meetingsWord = (n: number) => `${n} new meeting${n === 1 ? "" : "s"} imported`;

/**
 * Merge the per-source outcomes into the one result line. A failed source is
 * never "No new meetings": it is named, and when anything failed the line is an
 * error even if another source imported something.
 */
export function mergeSyncResults(results: readonly SourceSync[]): SyncSummary {
  const label = (r: SourceSync) => PROVIDER_LABEL[r.provider];
  const ran = results.filter((r) => r.outcome.kind === "imported");
  const inserted = ran.reduce((n, r) => n + (r.outcome.kind === "imported" ? r.outcome.inserted : 0), 0);
  const reauth = results.filter((r) => r.outcome.kind === "reauth");
  const failed = results.filter((r) => r.outcome.kind === "failed");
  const refused = results.some((r) => r.outcome.kind === "refused");
  const off = results.some((r) => r.outcome.kind === "not-switched-on");
  const missing = results.filter((r) => r.outcome.kind === "not-connected");

  if (refused) return { tone: "error", text: `${ADMIN_TIER_PHRASE} can sync meetings.`, reconnect: false, inserted: 0 };
  if (off) return { tone: "error", text: "Integrations aren't switched on for your firm yet. Lectual will turn them on.", reconnect: false, inserted: 0 };

  const sentences: string[] = [];
  if (ran.length > 0) sentences.push(inserted > 0 ? `${meetingsWord(inserted)}.` : "No new meetings.");
  for (const r of reauth) sentences.push(`Couldn't reach ${label(r)}.`);
  for (const r of failed) sentences.push(`Couldn't import from ${label(r)}.`);
  for (const r of missing) sentences.push(`${label(r)} isn't connected.`);
  if (sentences.length === 0) sentences.push("Connect a meeting source to sync meetings.");

  const broken = reauth.length + failed.length > 0 || ran.length === 0;
  return { tone: broken ? "error" : "ok", text: sentences.join(" "), reconnect: reauth.length > 0, inserted };
}
