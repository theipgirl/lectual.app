import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { logActivitySafe } from "@/lib/matters";

export type Tag = Database["public"]["Tables"]["crm_tag"]["Row"];
type TagSource = Database["public"]["Enums"]["crm_tag_source"];

/** Lists the active org's tag catalog. RLS scopes rows to the caller's org. */
export async function listTags(): Promise<Tag[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase.from("crm_tag").select("*");
  if (error) throw error;
  return data ?? [];
}

/**
 * Lists the tags applied to a given lead. Two plain queries (crm_lead_tag ->
 * tag_id list, then crm_tag by id) rather than a foreign-table embed, so the
 * result stays a simple typed Tag[] under the generated Database types.
 */
export async function tagsForLead(leadId: string): Promise<Tag[]> {
  const supabase = await getScopedClient();

  const { data: links, error: linkError } = await supabase
    .from("crm_lead_tag")
    .select("tag_id")
    .eq("lead_id", leadId);
  if (linkError) throw linkError;
  if (!links || links.length === 0) return [];

  const tagIds = links.map((link) => link.tag_id);
  const { data: tags, error: tagError } = await supabase
    .from("crm_tag")
    .select("*")
    .in("id", tagIds);
  if (tagError) throw tagError;
  return tags ?? [];
}

/**
 * Bulk form of `tagsForLead` for list surfaces: every lead's tags in TWO
 * queries total, not two per lead.
 *
 * The pipeline board renders every lead in the org on every request (it is
 * force-dynamic and uncached), so calling `tagsForLead` in a loop meant a
 * round trip per lead — an N+1 that grew linearly with the firm's pipeline on
 * the one screen they keep open all day. Same two statements as the single
 * lookup, just widened with `.in(...)` and grouped in memory.
 *
 * Returns an entry for EVERY id passed in, `[]` where a lead has no tags, so
 * callers can index the result by lead id without a null check.
 */
export async function tagsForLeads(leadIds: string[]): Promise<Record<string, Tag[]>> {
  if (leadIds.length === 0) return {};

  const supabase = await getScopedClient();

  const { data: links, error: linkError } = await supabase
    .from("crm_lead_tag")
    .select("lead_id, tag_id")
    .in("lead_id", leadIds);
  if (linkError) throw linkError;

  const tagIds = [...new Set((links ?? []).map((link) => link.tag_id))];
  if (tagIds.length === 0) return groupTagsByLead(leadIds, [], []);

  const { data: tags, error: tagError } = await supabase
    .from("crm_tag")
    .select("*")
    .in("id", tagIds);
  if (tagError) throw tagError;

  return groupTagsByLead(leadIds, links ?? [], tags ?? []);
}

/**
 * Pure grouping half of `tagsForLeads` — kept separate (and exported) because
 * it is the part with the invariants worth testing without a database: every
 * requested lead present, tags de-duplicated per lead, and a link pointing at
 * a tag row the second query didn't return (deleted mid-request, or filtered
 * out by RLS) silently dropped rather than producing an `undefined` badge.
 */
export function groupTagsByLead(
  leadIds: string[],
  links: Array<{ lead_id: string; tag_id: string }>,
  tags: Tag[],
): Record<string, Tag[]> {
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));

  // Seeded with every requested id first: the board indexes straight into this
  // record, so an untagged lead must map to [] rather than to a missing key.
  const byLeadId: Record<string, Tag[]> = Object.fromEntries(leadIds.map((id) => [id, []]));

  const seen = new Set<string>();
  for (const link of links) {
    const bucket = byLeadId[link.lead_id];
    // Ignore links for leads the caller didn't ask about — the query is
    // already scoped, this just keeps the shape exactly as requested.
    if (!bucket) continue;
    const tag = tagById.get(link.tag_id);
    if (!tag) continue;
    const key = `${link.lead_id}:${link.tag_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bucket.push(tag);
  }

  return byLeadId;
}

/**
 * Applies a tag to a lead. crm_lead_tag.org_id is a denormalized column used
 * directly by RLS (no transitive EXISTS subquery) — it is NOT taken from the
 * caller, it's read off the lead row itself so it can never drift from the
 * lead's real org.
 */
export async function applyTag(
  leadId: string,
  tagId: string,
  opts: { source?: "auto" | "ai" | "human"; confidence?: number; needsReview?: boolean } = {},
): Promise<void> {
  const supabase = await getScopedClient();

  const { data: lead, error: leadError } = await supabase
    .from("crm_lead")
    .select("org_id")
    .eq("id", leadId)
    .single();
  if (leadError) throw leadError;

  const source: TagSource = opts.source ?? "human";

  const { error } = await supabase.from("crm_lead_tag").insert({
    org_id: lead.org_id,
    lead_id: leadId,
    tag_id: tagId,
    source,
    confidence: opts.confidence ?? null,
    needs_review: opts.needsReview ?? false,
  });
  if (error) throw error;

  // Audit AFTER the write (see logActivitySafe's ordering contract in
  // src/lib/matters/activity.ts): a failed tag insert must never leave a
  // "tag applied" row behind, and a failed audit row must never undo the tag.
  await logActivitySafe({
    type: "tag_applied",
    leadId,
    actorType: source === "human" ? "user" : source === "ai" ? "ai" : "automation",
    payload: { tag_id: tagId, ...(await tagDescriptor(supabase, tagId)), source },
  });
}

/** Removes a tag from a lead. */
export async function removeTag(leadId: string, tagId: string): Promise<void> {
  const supabase = await getScopedClient();

  // Read the label before the delete — after it, the link row is gone and a
  // deleted tag could no longer be described in the timeline at all.
  const descriptor = await tagDescriptor(supabase, tagId);

  const { error } = await supabase
    .from("crm_lead_tag")
    .delete()
    .eq("lead_id", leadId)
    .eq("tag_id", tagId);
  if (error) throw error;

  await logActivitySafe({
    type: "tag_removed",
    leadId,
    payload: { tag_id: tagId, ...descriptor },
  });
}

/**
 * Best-effort `{ tag_label, tag_code }` for an audit payload. Never throws —
 * a tag whose row can't be read still produces an audit entry, just without
 * the human-readable label.
 */
async function tagDescriptor(
  supabase: Awaited<ReturnType<typeof getScopedClient>>,
  tagId: string,
): Promise<{ tag_label?: string; tag_code?: string }> {
  try {
    const { data } = await supabase
      .from("crm_tag")
      .select("label, code")
      .eq("id", tagId)
      .maybeSingle();
    if (!data) return {};
    return { tag_label: data.label, tag_code: data.code };
  } catch {
    return {};
  }
}
