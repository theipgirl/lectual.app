import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { requireMatterWriteRole } from "./matters";
import { logActivity } from "./activity";

export type LitigationDetail =
  Database["public"]["Tables"]["crm_litigation_detail"]["Row"];

/**
 * Litigation facts for a matter — the crm_litigation_detail row 0040 added,
 * for tenants with the 'litigation' module in crm_org.modules.
 *
 * Everything here goes through the caller's scoped client, never service-role:
 * RLS scopes reads to the active org (a cross-org matter id resolves to null
 * exactly like getMatter does) and 0043's per-command policies gate writes to
 * staff roles. org_id is always read off the parent matter row through that
 * same scoped client — never taken from caller input — for the same reason
 * logActivity and createDeadline do it: a caller-supplied org_id on a
 * denormalized column IS a cross-tenant write, and RLS's WITH CHECK would
 * happily accept it because it only tests that the value equals the caller's
 * own org.
 */

/**
 * Whether the active org holds the litigation module. Read through the scoped
 * client, so crm_org can only ever be the caller's own firm's row.
 *
 * The read path treats a missing module as "no litigation facts" (null); the
 * write path treats it as a refusal. Both consult this one helper so they can
 * never disagree about what the module gate means — and 0040's
 * crm_require_litigation_module trigger backs both up in the database, which
 * is the boundary that actually holds.
 */
async function hasLitigationModule(
  supabase: Awaited<ReturnType<typeof getScopedClient>>,
): Promise<boolean> {
  const { data: org, error } = await supabase.from("crm_org").select("modules").maybeSingle();
  if (error) throw error;
  return org?.modules?.includes("litigation") ?? false;
}

/**
 * Reads a matter's litigation facts. Returns null unless the active org has
 * the litigation module enabled AND a detail row exists for this matter — the
 * module gate means a tenant that later turns the module off stops rendering
 * litigation facts even if rows remain.
 */
export async function getLitigationDetail(
  matterId: string,
): Promise<LitigationDetail | null> {
  const supabase = await getScopedClient();

  if (!(await hasLitigationModule(supabase))) return null;

  const { data, error } = await supabase
    .from("crm_litigation_detail")
    .select("*")
    .eq("matter_id", matterId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * The editable litigation facts, camelCase the way the forms post them.
 *
 * Every key is optional and every one distinguishes `undefined` ("leave this
 * column alone") from `null` ("clear it") — the same contract as
 * MatterIpFields, so a partial form cannot blank the fields it does not
 * render.
 */
export type LitigationDetailInput = {
  county?: string | null;
  caseNumber?: string | null;
  caseStyle?: string | null;
  courtDivision?: string | null;
  judge?: string | null;
  role?: string | null;
  /** Civil date, YYYY-MM-DD. */
  filedOn?: string | null;
  caseStatus?: string | null;
  noticeOfAppearance?: string | null;
  motionToDismiss?: string | null;
  missedHearing?: string | null;
  defaultStatus?: string | null;
  /** Instant, ISO-8601. See the note on wall-clock hearings in the card. */
  nextHearingAt?: string | null;
  nextHearingPurpose?: string | null;
  notes?: string | null;
};

/** Maps the camelCase input onto column names, omitting keys not supplied. */
function litigationColumns(input: LitigationDetailInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map: Array<[keyof LitigationDetailInput, string]> = [
    ["county", "county"],
    ["caseNumber", "case_number"],
    ["caseStyle", "case_style"],
    ["courtDivision", "court_division"],
    ["judge", "judge"],
    ["role", "role"],
    ["filedOn", "filed_on"],
    ["caseStatus", "case_status"],
    ["noticeOfAppearance", "notice_of_appearance"],
    ["motionToDismiss", "motion_to_dismiss"],
    ["missedHearing", "missed_hearing"],
    ["defaultStatus", "default_status"],
    ["nextHearingAt", "next_hearing_at"],
    ["nextHearingPurpose", "next_hearing_purpose"],
    ["notes", "notes"],
  ];
  for (const [key, column] of map) {
    if (input[key] !== undefined) out[column] = input[key];
  }
  return out;
}

/**
 * Writes a matter's litigation facts — creating the crm_litigation_detail row
 * on first save and updating it thereafter (matter_id is the primary key, so
 * one row per matter, always).
 *
 * Same security shape as createDeadline, in the same order:
 *
 *  1. The caller's own scoped client. Never service-role — there is no admin
 *     path to this table and there must not be one.
 *  2. requireMatterWriteRole. 0043 replaced 0040's single FOR ALL policy with
 *     per-command policies gated to staff roles, so a viewer's write is
 *     refused by the database too; this check exists so they get a sentence
 *     instead of a Postgres error.
 *  3. The module gate, matching getLitigationDetail. A firm without the module
 *     must not be able to create facts it cannot then read.
 *  4. org_id read OFF THE PARENT MATTER, through the scoped client. This is
 *     the line that matters: the id is looked up under RLS, so a matter in
 *     another tenant simply does not resolve (PGRST116, surfaced as "not
 *     found"), and the org_id stamped on the row is the matter's own — never
 *     a value the caller could supply. 0043's composite FK to
 *     (crm_matter.id, org_id) is the structural backstop.
 *
 * The timeline gets a matter_updated row naming WHICH fields changed, not
 * their values — the convention updateMatterIpFields set, and the right one
 * here: a case number or a hearing date is the row's business, and the
 * timeline is not a second copy of the file.
 */
export async function upsertLitigationDetail(
  matterId: string,
  fields: LitigationDetailInput,
): Promise<LitigationDetail> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  if (!(await hasLitigationModule(supabase))) {
    throw new Error("Litigation isn't enabled for your firm.");
  }

  // org_id comes from here and nowhere else.
  const { data: matter, error: matterError } = await supabase
    .from("crm_matter")
    .select("org_id, type")
    .eq("id", matterId)
    .single();
  if (matterError) {
    // PGRST116 = no row: either the matter does not exist or it belongs to
    // another tenant and RLS hid it. Those two must be indistinguishable.
    if ((matterError as { code?: string }).code === "PGRST116") {
      throw new Error("Matter not found.");
    }
    throw matterError;
  }

  // Litigation facts only render on a LIT matter (the detail page fetches them
  // for that type alone), so writing them onto a trademark file would store
  // data nobody can see. Refuse rather than accept a write into the dark.
  if (matter.type !== "LIT") {
    throw new Error("Litigation details can only be recorded on a litigation matter.");
  }

  const columns = litigationColumns(fields);

  const { data, error } = await supabase
    .from("crm_litigation_detail")
    .upsert(
      {
        matter_id: matterId,
        org_id: matter.org_id,
        ...columns,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "matter_id" },
    )
    .select("*")
    .single();
  if (error) {
    // 23514 here is crm_litigation_detail_text_len (0043): caps only, no format
    // rules. Say which way it failed rather than surfacing a constraint name.
    if ((error as { code?: string }).code === "23514") {
      throw new Error("One of those entries is too long to save — shorten it and try again.");
    }
    throw error;
  }

  await logActivity({
    type: "matter_updated",
    matterId,
    payload: { change: "litigation_detail", fields: Object.keys(columns) },
  });

  return data;
}
