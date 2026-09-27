import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { Json } from "@/lib/db/types";
import { currentRole } from "@/lib/auth/current-role";
import type { Role } from "@/lib/auth/roles";
import { listServiceItems } from "@/lib/quotes/service-library";
import { checklistComplete, checklistRemaining, goLiveChecklist } from "./checklist";
import { defaultIntakeConfig, parseIntakeConfig, validateAllowedDomains, validateIntakeConfig, type IntakeFormConfig } from "./config";
import { isOfferablePackage, type LibraryItem } from "./packages";
import { slugCandidates, slugFromFirmName } from "./slug";

/**
 * The firm's intake setup (`crm_intake_form`, lectual 0075), read and written
 * ONLY through the caller's scoped client. RLS scopes every statement to the
 * active org; nothing here filters by org_id or accepts one from a caller.
 *
 * ── WHO WRITES ──────────────────────────────────────────────────────────────
 * owner / admin / senior_admin, checked here on every write AND by 0075's
 * insert/update policies. Everyone else in the firm reads.
 *
 * `receives_referrals` and `agreement_signed_at` are Lectual's: 0075 grants
 * `authenticated` no INSERT/UPDATE on them, and no statement below names them
 * in a write. They are only ever read, to draw the compliance section and to
 * decide the go-live checklist.
 *
 * ── LIVE IS DECIDED HERE ────────────────────────────────────────────────────
 * A save never takes a status from the browser. It computes the go-live
 * checklist from what is being saved plus the row's own referral/agreement
 * columns, and writes `live` only when every item is done (the design's save:
 * `status: left ? "draft" : "live"`).
 *
 * ── THREE STATES ────────────────────────────────────────────────────────────
 * `unconfigured` is 0075 not applied to this environment (PostgREST
 * `PGRST205` / Postgres `42P01`); `unavailable` is anything else. Neither is
 * ever drawn as "no intake yet".
 */

export const INTAKE_FORM_ADMIN_ROLES: readonly Role[] = ["owner", "admin", "senior_admin"];

export function canEditIntakeForm(role: Role | null | undefined): boolean {
  return !!role && INTAKE_FORM_ADMIN_ROLES.includes(role);
}

export type IntakeFormRecord = {
  id: string;
  slug: string;
  status: "draft" | "live";
  config: IntakeFormConfig;
  allowedDomains: string[];
  receivesReferrals: boolean;
  agreementSignedAt: string | null;
  publishedAt: string | null;
  /** False until the first save (0075 leaves `updated_by` null on insert). */
  everSaved: boolean;
  updatedAt: string;
};

export type IntakeFormLoad =
  | { status: "ok"; form: IntakeFormRecord | null }
  | { status: "unconfigured" }
  | { status: "unavailable"; error?: unknown };

/** A refusal whose message is fit to show the person who caused it. */
export class IntakeFormError extends Error {}

const COLUMNS =
  "id, slug, status, config, allowed_domains, receives_referrals, agreement_signed_at, published_at, updated_by, updated_at";

type FormRow = {
  id: string;
  slug: string;
  status: string;
  config: Json;
  allowed_domains: string[];
  receives_referrals: boolean;
  agreement_signed_at: string | null;
  published_at: string | null;
  updated_by: string | null;
  updated_at: string;
};

type PgError = { code?: string; message?: string; details?: string } | null | undefined;

export function isMissingTableError(error: PgError): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01";
}

function toRecord(row: FormRow): IntakeFormRecord {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status === "live" ? "live" : "draft",
    config: parseIntakeConfig(row.config),
    allowedDomains: row.allowed_domains ?? [],
    receivesReferrals: row.receives_referrals,
    agreementSignedAt: row.agreement_signed_at,
    publishedAt: row.published_at,
    everSaved: row.updated_by !== null,
    updatedAt: row.updated_at,
  };
}

/** The firm's form, or `form: null` when it has none yet. Never writes. */
export async function loadIntakeForm(): Promise<IntakeFormLoad> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.from("crm_intake_form").select(COLUMNS).maybeSingle();
    if (error) return isMissingTableError(error) ? { status: "unconfigured" } : { status: "unavailable", error };
    return { status: "ok", form: data ? toRecord(data as FormRow) : null };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

/**
 * The setup page's read: the firm's form, creating the draft on an admin's
 * first visit (design: the page opens on a ready-to-edit draft, not an empty
 * state). Non-admins never create; they get `form: null` and are told an
 * admin sets it up.
 *
 * The new draft starts from the design's defaults with every current fee
 * package shown, and a slug from the firm's name — `-2`, `-3`… when another
 * firm already holds it (settled by the unique index; see slug.ts).
 */
export async function loadOrCreateIntakeForm(orgName: string): Promise<IntakeFormLoad> {
  const existing = await loadIntakeForm();
  if (existing.status !== "ok" || existing.form) return existing;
  if (!canEditIntakeForm(await currentRole())) return existing;

  try {
    const supabase = await getScopedClient();
    const [{ data: orgId, error: orgError }, { data: userData }] = await Promise.all([
      supabase.rpc("current_org_id"),
      supabase.auth.getUser(),
    ]);
    if (orgError || !orgId) return { status: "unavailable", error: orgError };

    const packages = await loadIntakePackages();
    const config = defaultIntakeConfig(packages.status === "ok" ? packages.items.map((i) => i.id) : []);

    for (const slug of slugCandidates(slugFromFirmName(orgName))) {
      const { data, error } = await supabase
        .from("crm_intake_form")
        .insert({ org_id: orgId, slug, status: "draft", config: config as unknown as Json, created_by: userData.user?.id ?? null })
        .select(COLUMNS)
        .single();
      if (!error) return { status: "ok", form: toRecord(data as FormRow) };
      if (error.code !== "23505") {
        return isMissingTableError(error) ? { status: "unconfigured" } : { status: "unavailable", error };
      }
      // A unique violation on org_id means a second tab created it first: read that one.
      if (/org_key|org_id/.test(`${error.message} ${error.details ?? ""}`)) return loadIntakeForm();
      // Otherwise another firm holds this slug; try the next.
    }
    return { status: "unavailable", error: new Error("No free slug for this firm name.") };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

export type IntakePackagesLoad = { status: "ok"; items: LibraryItem[] } | { status: "unavailable"; error?: unknown };

/** Active legal-fee items from the service library. A failed read says so. */
export async function loadIntakePackages(): Promise<IntakePackagesLoad> {
  try {
    const items = await listServiceItems(false);
    return { status: "ok", items: items.filter(isOfferablePackage) };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

export type SaveIntakeFormResult = { form: IntakeFormRecord; remaining: number };

/**
 * Saves the editor's config and allowed domains. `input` is the browser's
 * payload and is validated here in full; status comes from the checklist.
 */
export async function saveIntakeForm(input: { config: unknown; allowedDomains: unknown }): Promise<SaveIntakeFormResult> {
  if (!canEditIntakeForm(await currentRole())) {
    throw new IntakeFormError("Only owners, admins and senior admins can change the intake.");
  }
  const checked = validateIntakeConfig(input.config);
  if (!checked.ok) throw new IntakeFormError(checked.errors.join(" "));
  const domains = validateAllowedDomains(input.allowedDomains);
  if (!domains.ok) throw new IntakeFormError(domains.error);

  const supabase = await getScopedClient();
  const { data: current, error: readError } = await supabase.from("crm_intake_form").select(COLUMNS).maybeSingle();
  if (readError) throw readError;
  if (!current) throw new IntakeFormError("This firm's intake isn't set up yet. Reload the page and try again.");
  const row = current as FormRow;

  const items = goLiveChecklist(checked.config, {
    receivesReferrals: row.receives_referrals,
    agreementSigned: row.agreement_signed_at !== null,
  });
  const live = checklistComplete(items);
  const now = new Date().toISOString();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new IntakeFormError("Your session has ended. Sign in again.");

  const { data, error } = await supabase
    .from("crm_intake_form")
    .update({
      config: checked.config as unknown as Json,
      allowed_domains: domains.domains,
      status: live ? "live" : "draft",
      // First time live is the publish date; it survives later drafts.
      published_at: live ? (row.published_at ?? now) : row.published_at,
      updated_by: user.user.id,
      updated_at: now,
    })
    .eq("id", row.id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw error;
  // RLS filtered the update to nothing: the role changed under us.
  if (!data) throw new IntakeFormError("Only owners, admins and senior admins can change the intake.");
  return { form: toRecord(data as FormRow), remaining: checklistRemaining(items) };
}
