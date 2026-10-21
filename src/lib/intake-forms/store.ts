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
import { copyName, validateIntakeDetails } from "./details";

/**
 * The firm's intakes (`crm_intake_form`, lectual 0079; many per firm since
 * 0093), read and written ONLY through the caller's scoped client. RLS scopes every statement to the
 * active org; nothing here filters by org_id or accepts one from a caller.
 *
 * ── WHO WRITES ──────────────────────────────────────────────────────────────
 * owner / admin / senior_admin, checked here on every write AND by 0079's
 * insert/update policies. Everyone else in the firm reads.
 *
 * `receives_referrals` and `agreement_signed_at` are Lectual's: 0079 grants
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
 * ── MANY INTAKES (0093) ─────────────────────────────────────────────────────
 * One per event, campaign or page. Each has its own name, link (slug),
 * source tag and numbers; duplicating copies the setup under a new link.
 * Archived intakes are not served publicly and keep their leads. Renaming a
 * link keeps the old one working (the database's alias trigger), and a link
 * another intake once used is refused there with 23505.
 *
 * ── THREE STATES ────────────────────────────────────────────────────────────
 * `unconfigured` is 0079 not applied to this environment (PostgREST
 * `PGRST205` / Postgres `42P01`); `unavailable` is anything else. Neither is
 * ever drawn as "no intake yet".
 */

export const INTAKE_FORM_ADMIN_ROLES: readonly Role[] = ["owner", "admin", "senior_admin"];

export function canEditIntakeForm(role: Role | null | undefined): boolean {
  return !!role && INTAKE_FORM_ADMIN_ROLES.includes(role);
}

export type IntakeFormStatus = "draft" | "live" | "archived";
export type IntakeKind = "intake" | "assessment";

export type IntakeFormRecord = {
  id: string;
  name: string;
  slug: string;
  sourceTag: string | null;
  /** chat/form, or the scored event assessment (0095). Fixed at creation. */
  kind: IntakeKind;
  status: IntakeFormStatus;
  config: IntakeFormConfig;
  allowedDomains: string[];
  receivesReferrals: boolean;
  agreementSignedAt: string | null;
  publishedAt: string | null;
  /** False until the first save (0079 leaves `updated_by` null on insert). */
  everSaved: boolean;
  createdAt: string;
  updatedAt: string;
};

type Load<T> = { status: "ok"; value: T } | { status: "unconfigured" } | { status: "unavailable"; error?: unknown };

export type IntakeFormLoad =
  | { status: "ok"; form: IntakeFormRecord | null }
  | { status: "unconfigured" }
  | { status: "unavailable"; error?: unknown };

/** A refusal whose message is fit to show the person who caused it. */
export class IntakeFormError extends Error {}

const COLUMNS =
  "id, name, slug, source_tag, kind, status, config, allowed_domains, receives_referrals, agreement_signed_at, published_at, updated_by, created_at, updated_at";

type FormRow = {
  id: string;
  name: string;
  slug: string;
  source_tag: string | null;
  kind: string;
  status: string;
  config: Json;
  allowed_domains: string[];
  receives_referrals: boolean;
  agreement_signed_at: string | null;
  published_at: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type PgError = { code?: string; message?: string; details?: string } | null | undefined;

export function isMissingTableError(error: PgError): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01";
}

function isUniqueViolation(error: PgError): boolean {
  return error?.code === "23505";
}

function toStatus(s: string): IntakeFormStatus {
  return s === "live" ? "live" : s === "archived" ? "archived" : "draft";
}

function toRecord(row: FormRow): IntakeFormRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sourceTag: row.source_tag,
    kind: row.kind === "assessment" ? "assessment" : "intake",
    status: toStatus(row.status),
    config: parseIntakeConfig(row.config),
    allowedDomains: row.allowed_domains ?? [],
    receivesReferrals: row.receives_referrals,
    agreementSignedAt: row.agreement_signed_at,
    publishedAt: row.published_at,
    everSaved: row.updated_by !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every intake the firm has, oldest first (the first is the firm's main intake). */
export async function listIntakeForms(): Promise<Load<IntakeFormRecord[]>> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.from("crm_intake_form").select(COLUMNS).order("created_at", { ascending: true });
    if (error) return isMissingTableError(error) ? { status: "unconfigured" } : { status: "unavailable", error };
    return { status: "ok", value: (data as FormRow[]).map(toRecord) };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

/** One intake by id, or `form: null` when it isn't this firm's. Never writes. */
export async function loadIntakeForm(id: string): Promise<IntakeFormLoad> {
  if (!UUID.test(id)) return { status: "ok", form: null };
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.from("crm_intake_form").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) return isMissingTableError(error) ? { status: "unconfigured" } : { status: "unavailable", error };
    return { status: "ok", form: data ? toRecord(data as FormRow) : null };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

/**
 * The page's list read, creating the firm's first draft on an admin's first
 * visit (design: the page opens on a ready-to-edit intake, not an empty state).
 * Non-admins never create.
 */
export async function listOrCreateIntakeForms(orgName: string): Promise<Load<IntakeFormRecord[]>> {
  const existing = await listIntakeForms();
  if (existing.status !== "ok" || existing.value.length > 0) return existing;
  if (!canEditIntakeForm(await currentRole())) return existing;
  try {
    await insertIntakeForm({ name: orgName.trim() ? `${orgName.trim()} intake` : "Intake", slugBase: slugFromFirmName(orgName), sourceTag: null });
  } catch (error) {
    if (error instanceof IntakeFormError) return { status: "unavailable", error };
    return isMissingTableError(error as PgError) ? { status: "unconfigured" } : { status: "unavailable", error };
  }
  return listIntakeForms();
}

async function requireAdmin(): Promise<void> {
  if (!canEditIntakeForm(await currentRole())) {
    throw new IntakeFormError("Only owners, admins and senior admins can change intakes.");
  }
}

/**
 * Inserts a new draft. Slug candidates are tried in order: another intake
 * (any firm's, or a link name one used before) holding a candidate is a
 * 23505 and the next is tried.
 */
async function insertIntakeForm(input: {
  name: string;
  slugBase: string;
  sourceTag: string | null;
  kind?: IntakeKind;
  config?: IntakeFormConfig;
  allowedDomains?: string[];
}): Promise<IntakeFormRecord> {
  const supabase = await getScopedClient();
  const [{ data: orgId, error: orgError }, { data: userData }] = await Promise.all([
    supabase.rpc("current_org_id"),
    supabase.auth.getUser(),
  ]);
  if (orgError) throw orgError;
  if (!orgId) throw new IntakeFormError("Your session has no firm. Reload the page and try again.");

  let config = input.config;
  if (!config) {
    const packages = await loadIntakePackages();
    config = defaultIntakeConfig(packages.status === "ok" ? packages.items.map((i) => i.id) : []);
  }

  for (const slug of slugCandidates(input.slugBase)) {
    const { data, error } = await supabase
      .from("crm_intake_form")
      .insert({
        org_id: orgId,
        name: input.name,
        slug,
        source_tag: input.sourceTag,
        kind: input.kind ?? "intake",
        status: "draft",
        config: config as unknown as Json,
        allowed_domains: input.allowedDomains ?? [],
        created_by: userData.user?.id ?? null,
      })
      .select(COLUMNS)
      .single();
    if (!error) return toRecord(data as FormRow);
    if (!isUniqueViolation(error)) throw error;
  }
  throw new IntakeFormError("Couldn't find a free link name. Try a different intake name.");
}

/** A new intake from the defaults, named by the person creating it: chat/form, or an assessment. */
export async function createIntakeForm(name: unknown, kind: unknown = "intake"): Promise<IntakeFormRecord> {
  await requireAdmin();
  const n = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
  if (!n) throw new IntakeFormError("Give the new intake a name.");
  if (n.length > 120) throw new IntakeFormError("Keep the name under 120 characters.");
  if (kind !== "intake" && kind !== "assessment") throw new IntakeFormError("Choose chat/form or assessment.");
  return insertIntakeForm({ name: n, slugBase: slugFromFirmName(n), sourceTag: null, kind });
}

/** A copy of an intake's setup (questions, look, fees, domains, tag) under a new link, as a draft. */
export async function duplicateIntakeForm(id: string): Promise<IntakeFormRecord> {
  await requireAdmin();
  const src = await loadIntakeForm(id);
  if (src.status !== "ok") throw new IntakeFormError("Couldn't read that intake. Nothing was copied; try again shortly.");
  if (!src.form) throw new IntakeFormError("That intake isn't in your firm.");
  const name = copyName(src.form.name);
  return insertIntakeForm({
    name,
    slugBase: src.form.slug,
    sourceTag: src.form.sourceTag,
    kind: src.form.kind,
    config: src.form.config,
    allowedDomains: src.form.allowedDomains,
  });
}

async function readRow(id: string): Promise<FormRow> {
  if (!UUID.test(id)) throw new IntakeFormError("That intake isn't in your firm.");
  const supabase = await getScopedClient();
  const { data, error } = await supabase.from("crm_intake_form").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new IntakeFormError("That intake isn't in your firm.");
  return data as FormRow;
}

function liveFor(row: FormRow, config: IntakeFormConfig): { live: boolean; remaining: number } {
  const items = goLiveChecklist(config, {
    receivesReferrals: row.receives_referrals,
    agreementSigned: row.agreement_signed_at !== null,
    kind: row.kind === "assessment" ? "assessment" : "intake",
  });
  return { live: checklistComplete(items), remaining: checklistRemaining(items) };
}

/**
 * Archives an intake (its link stops answering; its leads and numbers stay)
 * or brings it back, as live or draft by the same checklist a save uses.
 */
export async function setIntakeFormArchived(id: string, archived: boolean): Promise<IntakeFormRecord> {
  await requireAdmin();
  const row = await readRow(id);
  const config = parseIntakeConfig(row.config);
  const next = archived ? "archived" : liveFor(row, config).live ? "live" : "draft";
  const supabase = await getScopedClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new IntakeFormError("Your session has ended. Sign in again.");
  const { data, error } = await supabase
    .from("crm_intake_form")
    .update({ status: next, updated_by: user.user.id, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new IntakeFormError("Only owners, admins and senior admins can change intakes.");
  return toRecord(data as FormRow);
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
 * Saves one intake: its config, allowed domains, name, link name and source
 * tag. `input` is the browser's payload and is validated here in full; status
 * comes from the checklist (an archived intake stays archived).
 */
export async function saveIntakeForm(
  id: string,
  input: { config: unknown; allowedDomains: unknown; details: unknown },
): Promise<SaveIntakeFormResult> {
  await requireAdmin();
  const checked = validateIntakeConfig(input.config);
  if (!checked.ok) throw new IntakeFormError(checked.errors.join(" "));
  const domains = validateAllowedDomains(input.allowedDomains);
  if (!domains.ok) throw new IntakeFormError(domains.error);
  const details = validateIntakeDetails(input.details);
  if (!details.ok) throw new IntakeFormError(details.errors.join(" "));

  const row = await readRow(id);
  const { live, remaining } = liveFor(row, checked.config);
  const archived = row.status === "archived";
  const now = new Date().toISOString();
  const supabase = await getScopedClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new IntakeFormError("Your session has ended. Sign in again.");

  const { data, error } = await supabase
    .from("crm_intake_form")
    .update({
      config: checked.config as unknown as Json,
      allowed_domains: domains.domains,
      name: details.value.name,
      slug: details.value.slug,
      source_tag: details.value.sourceTag,
      status: archived ? "archived" : live ? "live" : "draft",
      // First time live is the publish date; it survives later drafts.
      published_at: live && !archived ? (row.published_at ?? now) : row.published_at,
      updated_by: user.user.id,
      updated_at: now,
    })
    .eq("id", row.id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    if (isUniqueViolation(error)) {
      throw new IntakeFormError(`The link name "${details.value.slug}" is taken, or another intake used it before. Choose another.`);
    }
    throw error;
  }
  // RLS filtered the update to nothing: the role changed under us.
  if (!data) throw new IntakeFormError("Only owners, admins and senior admins can change intakes.");
  return { form: toRecord(data as FormRow), remaining: archived ? 0 : remaining };
}
