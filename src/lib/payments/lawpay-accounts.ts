import { readTrustFlag, secretKeyFor, type GatewayCredentials, type LawPayAccount, type LawPayMode } from "./lawpay-oauth";
import { isPaymentAccountKind, type PaymentAccountKind } from "./types";

/**
 * Pure rules about a firm's LawPay accounts. The same rules lectual 0080
 * enforces in the database (crm_org_payment_account_lawpay_guard and
 * crm_payment_lawpay_guard); checked here too so an admin gets a sentence
 * instead of a constraint error, and so tests can pin them without a database.
 *
 * THE KIND IS NEVER INFERRED. LawPay's own `trust_account` flag decides which
 * kind an account MAY be mapped as; the admin still has to choose it,
 * explicitly, and confirm. "Not trust" is not the same claim as "this is the
 * firm's operating account" — a firm can have several non-trust accounts.
 */

/** Reads the stored `accounts` jsonb back. Anything malformed is dropped. */
export function parseStoredAccounts(value: unknown): LawPayAccount[] {
  if (!Array.isArray(value)) return [];
  const out: LawPayAccount[] = [];
  for (const raw of value) {
    const a = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const id = typeof a?.id === "string" && a.id ? a.id : null;
    const type = a?.type === "MerchantAccount" || a?.type === "AchAccount" ? a.type : null;
    const trust = readTrustFlag(a?.trust_account);
    const mode = a?.mode === "test" || a?.mode === "live" ? a.mode : null;
    if (!id || !type || trust === null || !mode) continue;
    out.push({
      id,
      type,
      trust_account: trust,
      mode,
      name: typeof a?.name === "string" ? a.name : null,
      public_key: typeof a?.public_key === "string" && a.public_key ? a.public_key : null,
      currency: typeof a?.currency === "string" ? a.currency : null,
    });
  }
  return out;
}

/** True when LawPay's own facts allow `account` to be mapped as `kind` in `mode`. */
export function accountFitsKind(account: LawPayAccount, kind: unknown, mode: LawPayMode): boolean {
  if (!isPaymentAccountKind(kind)) return false;
  return account.mode === mode && account.trust_account === (kind === "trust");
}

/** The accounts an admin may choose from for `kind`, in the connection's mode. */
export function candidateAccounts(accounts: readonly LawPayAccount[], kind: PaymentAccountKind, mode: LawPayMode): LawPayAccount[] {
  return accounts.filter((a) => accountFitsKind(a, kind, mode));
}

export type MappingCheck = { ok: true; account: LawPayAccount } | { ok: false; reason: string };

/**
 * Validates an admin's mapping request. `kind` must be given explicitly — there
 * is no default and no "whichever fits".
 */
export function checkMappingRequest(input: {
  kind: unknown;
  accountId: unknown;
  confirmed: unknown;
  accounts: readonly LawPayAccount[];
  mode: LawPayMode;
  /** The account currently mapped as the OTHER kind, if any. */
  otherKindAccountId: string | null;
}): MappingCheck {
  if (!isPaymentAccountKind(input.kind)) return { ok: false, reason: "Choose whether this is the operating or the trust account." };
  const accountId = typeof input.accountId === "string" ? input.accountId.trim() : "";
  if (!accountId) return { ok: false, reason: "Choose an account." };
  const account = input.accounts.find((a) => a.id === accountId);
  if (!account) return { ok: false, reason: "That account isn't on your connected LawPay merchant. Refresh accounts and try again." };
  if (account.mode !== input.mode) {
    return { ok: false, reason: `That is a ${account.mode}-mode account and the connection is in ${input.mode} mode.` };
  }
  if (account.trust_account !== (input.kind === "trust")) {
    return {
      ok: false,
      reason: account.trust_account
        ? "LawPay lists that account as a trust (IOLTA) account, so it can't be the operating account."
        : "LawPay lists that account as not a trust account, so it can't be mapped as trust.",
    };
  }
  if (input.otherKindAccountId === accountId) return { ok: false, reason: "One account can't be both the operating and the trust account." };
  if (input.confirmed !== true && input.confirmed !== "on" && input.confirmed !== "yes") {
    return {
      ok: false,
      reason:
        input.kind === "operating"
          ? "Confirm this is the firm's operating account — earned fees will be paid into it."
          : "Confirm this is the firm's trust (IOLTA) account.",
    };
  }
  return { ok: true, account };
}

export function accountLabel(account: LawPayAccount): string {
  const name = account.name ?? (account.type === "AchAccount" ? "eCheck account" : "Card account");
  return `${name} · ${account.type === "AchAccount" ? "eCheck" : "card"} · ···${account.id.slice(-4)}`;
}

/* ───────────────────── the sealed half of a connection ──────────────────── */

/**
 * What goes inside `gateway_credentials_enc`: the per-account secret keys AND
 * LawPay's own trust flag and mode for each account, as LawPay returned them.
 *
 * Why the facts are sealed as well as stored in the readable `accounts` column:
 * `accounts` has to be writable by a firm admin's scoped client (that is how a
 * connection is saved), so anyone holding an admin session can PATCH it through
 * the API — for instance marking the IOLTA account `trust_account: false` and
 * then mapping it as operating. The database guards compare against that
 * column, so they would agree. The sealed copy cannot be forged without the
 * server's key, and the charge path (loadChargeCredentials) checks it, so a
 * forged flag leaves the firm with no card form rather than with earned fees
 * landing in trust.
 */
export const SEALED_GATEWAY_VERSION = 2;

export type SealedGateway = {
  v: typeof SEALED_GATEWAY_VERSION;
  secrets: Record<string, string>;
  accounts: { id: string; mode: LawPayMode; trust_account: boolean }[];
};

export function sealedGatewayPayload(gateway: Pick<GatewayCredentials, "secrets" | "accounts">): SealedGateway {
  return {
    v: SEALED_GATEWAY_VERSION,
    secrets: gateway.secrets,
    accounts: gateway.accounts.map((a) => ({ id: a.id, mode: a.mode, trust_account: a.trust_account })),
  };
}

/**
 * The secret key for one account, only if the SEALED facts say it is that mode
 * and that side of the books. Anything unreadable, missing or disagreeing → null
 * (the caller answers "not configured"; it never guesses).
 */
export function readSealedAccount(
  payload: unknown,
  input: { accountId: string; mode: LawPayMode; kind: unknown },
): { secretKey: string } | null {
  if (!isPaymentAccountKind(input.kind)) return null;
  const p = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  if (!p || p.v !== SEALED_GATEWAY_VERSION || !Array.isArray(p.accounts)) return null;
  const facts = (p.accounts as unknown[]).find(
    (a) => a && typeof a === "object" && (a as Record<string, unknown>).id === input.accountId && (a as Record<string, unknown>).mode === input.mode,
  ) as Record<string, unknown> | undefined;
  if (!facts || typeof facts.trust_account !== "boolean") return null;
  if (facts.trust_account !== (input.kind === "trust")) return null;
  const secrets = p.secrets && typeof p.secrets === "object" ? (p.secrets as Record<string, unknown>) : null;
  const secretKey = secrets?.[secretKeyFor(input.mode, input.accountId)];
  return typeof secretKey === "string" && secretKey ? { secretKey } : null;
}
