import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { getAdminClient } from "@/lib/db/admin";
import { checkMappingRequest } from "./lawpay-accounts";
import { getLawPayConnection } from "./lawpay-connection";
import type { PaymentAccountKind, PaymentRecordProvider } from "./types";

/**
 * Where a charge's `account_id` comes from: `crm_org_payment_account` (0068),
 * the FIRM's declared mapping. Ported in spirit from lectual's accounts.ts
 * (branch claude/lectual-firm-dashboard-prd-f3loev).
 *
 * The account id is never a constant, never an env var, never LawPay's own
 * choice, and never inferred from LawPay's trust flag: the admin picks it and
 * confirms it (Settings → Integrations → LawPay). An unmapped operating account
 * means no card form at all — never a guess.
 *
 * `ResolvedPaymentAccount` is BRANDED: only this module mints one, from a row it
 * read. A hand-built `{ accountKind: "trust", providerAccountId }` does not
 * type-check where a charge needs an account.
 */

type Fields<K extends PaymentAccountKind> = {
  readonly provider: PaymentRecordProvider;
  readonly accountKind: K;
  readonly providerAccountId: string;
  readonly label: string | null;
  readonly verifiedAt: string | null;
};

declare const resolvedBrand: unique symbol;
export type ResolvedPaymentAccount<K extends PaymentAccountKind = PaymentAccountKind> = K extends PaymentAccountKind
  ? Fields<K> & { readonly [resolvedBrand]: "read-from-crm_org_payment_account" }
  : never;
export type OperatingPaymentAccount = ResolvedPaymentAccount<"operating">;

function mint<K extends PaymentAccountKind>(fields: Fields<K>): ResolvedPaymentAccount<K> {
  return fields as unknown as ResolvedPaymentAccount<K>;
}

export type MappingRow = {
  account_kind: PaymentAccountKind;
  provider_account_id: string;
  label: string | null;
  verified_at: string | null;
};

export type MappingsRead = { status: "ok"; rows: MappingRow[] } | { status: "unavailable" };

/** The firm's LawPay mappings, through RLS. */
export async function listLawPayMappings(): Promise<MappingsRead> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_org_payment_account")
      .select("account_kind, provider_account_id, label, verified_at")
      .eq("provider", "lawpay");
    if (error) return { status: "unavailable" };
    return { status: "ok", rows: (data ?? []) as MappingRow[] };
  } catch {
    return { status: "unavailable" };
  }
}

export type MapResult = { ok: true } | { ok: false; reason: string };

/**
 * Maps one LawPay account to one role, as the signed-in admin, through RLS
 * (admin tier) and 0076's guard trigger (must be a listed, in-mode account
 * whose trust flag matches). `kind` is required and explicit; `confirmed` is
 * the admin's tick that this is the account they think it is, and stamps
 * `verified_at`.
 */
export async function mapLawPayAccount(input: { kind: unknown; accountId: unknown; confirmed: unknown }): Promise<MapResult> {
  const read = await getLawPayConnection();
  if (!read.ok) return { ok: false, reason: "Couldn't read your firm's LawPay connection. Try again shortly." };
  const conn = read.connection;
  if (!conn || conn.status !== "active") return { ok: false, reason: "Connect LawPay before choosing accounts." };

  const mappings = await listLawPayMappings();
  if (mappings.status !== "ok") return { ok: false, reason: "Couldn't read your current accounts. Try again shortly." };
  const otherKind = input.kind === "trust" ? "operating" : "trust";
  const other = mappings.rows.find((r) => r.account_kind === otherKind)?.provider_account_id ?? null;

  const check = checkMappingRequest({ ...input, accounts: conn.accounts, mode: conn.mode, otherKindAccountId: other });
  if (!check.ok) return check;
  const kind = input.kind as PaymentAccountKind;

  const supabase = await getScopedClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("crm_org_payment_account").upsert(
    {
      org_id: conn.org_id,
      provider: "lawpay",
      account_kind: kind,
      provider_account_id: check.account.id,
      label: check.account.name,
      verified_at: now,
      updated_at: now,
    },
    { onConflict: "org_id,provider,account_kind" },
  );
  if (error) {
    if (error.code === "42501") return { ok: false, reason: "Only owners and admins can choose payment accounts." };
    if (error.code === "23505") return { ok: false, reason: "One account can't be both the operating and the trust account." };
    if (error.code === "23514") return { ok: false, reason: "LawPay's details for that account don't allow this mapping. Refresh accounts and try again." };
    return { ok: false, reason: "Couldn't save that account. Try again shortly." };
  }
  return { ok: true };
}

export async function unmapLawPayAccount(kind: unknown): Promise<MapResult> {
  if (kind !== "operating" && kind !== "trust") return { ok: false, reason: "Unknown account role." };
  const supabase = await getScopedClient();
  const { error } = await supabase.from("crm_org_payment_account").delete().eq("provider", "lawpay").eq("account_kind", kind).select("id");
  if (error) return { ok: false, reason: "Couldn't remove that account. Try again shortly." };
  return { ok: true };
}

/* ───────────────── the unauthenticated route's own read ─────────────────── */

export type OperatingAccountLoad =
  | { status: "ok"; account: OperatingPaymentAccount }
  | { status: "unmapped" }
  | { status: "unavailable" };

/**
 * The firm's OPERATING LawPay account, for a caller with no session (the client
 * proposal page). Takes the service-role client and an org id, so both RLS
 * protections are gone — which is why:
 *   · `orgId` MUST come from the quote row the token resolved, never a request,
 *     and the filter on it here IS the isolation;
 *   · it is hard-wired to `operating`. A signing charge is an earned fee, and an
 *     unauthenticated route has no reason to ever name the trust account.
 */
export async function loadPublicRouteOperatingAccount(input: {
  db: ReturnType<typeof getAdminClient>;
  orgId: string;
}): Promise<OperatingAccountLoad> {
  const orgId = (input.orgId ?? "").trim();
  if (!orgId) return { status: "unavailable" };
  try {
    const { data, error } = await input.db
      .from("crm_org_payment_account")
      .select("provider_account_id, label, verified_at")
      .eq("org_id", orgId)
      .eq("provider", "lawpay")
      .eq("account_kind", "operating")
      .limit(1);
    if (error) return { status: "unavailable" };
    const row = data?.[0];
    const id = (row?.provider_account_id ?? "").trim();
    if (!row || !id) return { status: "unmapped" };
    return {
      status: "ok",
      account: mint({ provider: "lawpay", accountKind: "operating", providerAccountId: id, label: row.label ?? null, verifiedAt: row.verified_at ?? null }),
    };
  } catch {
    return { status: "unavailable" };
  }
}
