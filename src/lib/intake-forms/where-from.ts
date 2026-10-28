import { hasUtm, sourceLabel, utmFromContact } from "./utm";

/**
 * "Where they came from": the people in a range, grouped by the utm_source on
 * their link and, under each source, by campaign. Pure; Results feeds it the
 * rows it already read (`contact.utm` is written once, at the contact step).
 * A person with no tag is "Direct (no tag)". The counts add up to the rows.
 */

export type CampaignCount = { campaign: string | null; count: number };
export type SourceGroup = { source: string; label: string; count: number; campaigns: CampaignCount[] };
export type WhereFrom = { total: number; groups: SourceGroup[]; direct: number };

export const DIRECT_LABEL = "Direct (no tag)";
export const NO_CAMPAIGN_LABEL = "No campaign";

export function groupBySource(rows: readonly { contact: unknown }[]): WhereFrom {
  const bySource = new Map<string, Map<string | null, number>>();
  let direct = 0;
  for (const r of rows) {
    const utm = utmFromContact(r.contact);
    // A tag with a medium or campaign but no source still came from somewhere: file it under "(no source)".
    if (!hasUtm(utm)) {
      direct += 1;
      continue;
    }
    const source = utm.source ?? "";
    const camps = bySource.get(source) ?? new Map<string | null, number>();
    const key = utm.campaign ?? null;
    camps.set(key, (camps.get(key) ?? 0) + 1);
    bySource.set(source, camps);
  }
  const groups: SourceGroup[] = [...bySource.entries()].map(([source, camps]) => {
    const campaigns = [...camps.entries()]
      .map(([campaign, count]) => ({ campaign, count }))
      .sort((a, b) => b.count - a.count || String(a.campaign).localeCompare(String(b.campaign)));
    return { source, label: source ? sourceLabel(source) : "(no source)", count: campaigns.reduce((n, c) => n + c.count, 0), campaigns };
  });
  groups.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { total: rows.length, groups, direct };
}
