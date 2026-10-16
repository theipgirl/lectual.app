/**
 * LawPay (AffiniPay Payment Gateway) charge client — the only code in this app
 * that can move money.
 *
 * Ported from lectual (branch claude/lectual-firm-dashboard-prd-f3loev,
 * src/lib/payments/lawpay.ts). The request, the status vocabulary and the
 * failure classification are unchanged. What changed is WHERE THE KEY COMES
 * FROM: there is no `LAWPAY_SECRET_KEY` and no `lawPayFromEnv()`. A client is
 * built only from one firm's own connection (lawpay-connection.ts), for one of
 * that firm's accounts, in the connection's mode.
 *
 * ── NOT VERIFIED AGAINST A LIVE MERCHANT ACCOUNT ────────────────────────────
 * No charge has ever been issued through this file. From developers.8am.com:
 *   · POST {base}/v1/charges, HTTP Basic with the account's secret_key as the
 *     username and an empty password; body { amount, method, account_id,
 *     reference }.
 *   · Test vs live is chosen by WHICH SECRET KEY is used; there is no sandbox
 *     host. So a test-mode connection cannot reach the card networks.
 *   · Omitting account_id makes the gateway pick an account. Never omitted here.
 *   · Status vocabulary AUTHORIZED / COMPLETED / VOIDED. With auto_capture on
 *     (default) a successful charge is AUTHORIZED and settles in the daily
 *     capture run, so every surface says "authorised", never "paid/cleared".
 *   · No idempotency key. This file never retries.
 *
 * ── WHAT A NON-2xx MEANS ────────────────────────────────────────────────────
 *   · 5xx / 429 / 408 → `unknown`: the request arrived and may have charged.
 *     (Runbook defect 5: these used to read as a decline and re-enable the pay
 *     button under "nothing has been charged". Fixed here and kept fixed.)
 *   · 402 → `failed` / `card`: a decision about the card.
 *   · 401 / 403 → `failed` / `request`, `credentialRejected`: our key was
 *     refused, nothing reached a card; the connection needs reconnecting.
 *   · any other 4xx → `failed` / `request`.
 * `clientDetail` (the only failure text a client may read) is set on a 402 only.
 */

import {
  PaymentAdapterError,
  type ProviderChargeRequest,
  type ProviderChargeResult,
} from "./types";
import type { FetchLike } from "./lawpay-oauth";

const DEFAULT_TIMEOUT_MS = 30_000;

/** Allowlist: an unlisted status is `unknown`, never a fabricated success. */
const SUCCESSFUL_STATUSES = new Set(["authorized", "captured", "completed", "succeeded", "success", "paid", "settled"]);
const FAILED_STATUSES = new Set(["failed", "declined", "voided", "cancelled", "canceled", "error"]);

export type LawPayChargeClient = {
  readonly baseUrl: string;
  charge(request: ProviderChargeRequest): Promise<ProviderChargeResult>;
};

export function createLawPayChargeClient(config: {
  /** The ACCOUNT's own secret_key, from the firm's sealed gateway credentials. */
  secretKey: string;
  /** e.g. https://api.8am.com — `/v1/charges` is appended. */
  apiBase: string;
  fetchImpl?: FetchLike;
}): LawPayChargeClient {
  const secretKey = (config.secretKey ?? "").trim();
  if (!secretKey) throw new PaymentAdapterError("LawPay charge client created without a secret key.");
  const baseUrl = `${config.apiBase.replace(/\/+$/, "")}/v1`;
  const doFetch: FetchLike = config.fetchImpl ?? ((input, init) => (globalThis.fetch as FetchLike)(input, init));
  return { baseUrl, charge: (request) => charge({ secretKey, baseUrl, doFetch, request }) };
}

async function charge(args: {
  secretKey: string;
  baseUrl: string;
  doFetch: FetchLike;
  request: ProviderChargeRequest;
}): Promise<ProviderChargeResult> {
  const { request } = args;

  // The guard this subsystem exists for: tsc already requires the field; this
  // stops a JS caller, an `any`, or an empty string from reaching the gateway,
  // which would choose trust or operating for the firm.
  const accountId = (request.providerAccountId ?? "").trim();
  if (!accountId) {
    throw new PaymentAdapterError(
      "Refusing to charge without an explicit LawPay account_id: the gateway would pick the firm's primary account, which decides trust vs operating.",
    );
  }
  const methodToken = (request.methodToken ?? "").trim();
  if (!methodToken) throw new PaymentAdapterError("Refusing to charge without a payment token.");
  const amountCents = request.amount.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new PaymentAdapterError("Refusing to charge an amount that is not a positive whole number of cents.");
  }
  if (request.amount.currency !== "USD") {
    throw new PaymentAdapterError(`Refusing to charge in ${request.amount.currency}: LawPay's charge request has no currency parameter.`);
  }

  // Only these fields: nothing a client typed, nothing privileged.
  const body = JSON.stringify({
    amount: amountCents,
    method: methodToken,
    account_id: accountId,
    ...(request.reference ? { reference: request.reference.slice(0, 128) } : {}),
  });

  let response: Response;
  try {
    response = await args.doFetch(`${args.baseUrl}/charges`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${args.secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      cache: "no-store",
      signal: timeoutSignal(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    // A rejected fetch does NOT mean nothing was charged.
    return {
      outcome: "unknown",
      detail: `No response from LawPay (${errorText(err)}). The charge may or may not have been taken — check the reference in LawPay before charging again.`,
    };
  }

  const payload = await readJson(response);
  const chargeId = stringField(payload, "id");
  const providerStatus = stringField(payload, "status");

  if (!response.ok) {
    if (classifyHttpFailure(response.status) === "unknown") {
      return {
        outcome: "unknown",
        detail:
          `LawPay answered HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""} ` +
          `(${failureDetail(response, payload)}). The charge may or may not have been taken — check the reference in LawPay before charging again.`,
        chargeId,
        providerStatus,
      };
    }
    const failure = response.status === 402 ? "card" : "request";
    return {
      outcome: "failed",
      failure,
      detail: failureDetail(response, payload),
      ...(failure === "card" ? { clientDetail: providerMessage(payload) } : {}),
      ...(response.status === 401 || response.status === 403 ? { credentialRejected: true } : {}),
      chargeId,
      providerStatus,
    };
  }

  const normalized = (providerStatus ?? "").trim().toLowerCase();
  if (SUCCESSFUL_STATUSES.has(normalized)) {
    if (!chargeId) {
      return { outcome: "unknown", detail: `LawPay reported status "${providerStatus}" with no charge id. Reconcile by reference.`, providerStatus };
    }
    return {
      outcome: "succeeded",
      chargeId,
      accountId: stringField(payload, "account_id") ?? null,
      amountCents: integerField(payload, "amount"),
      currency: stringField(payload, "currency") ?? null,
      providerStatus: providerStatus ?? null,
    };
  }
  if (FAILED_STATUSES.has(normalized)) {
    // `request`, not `card`, and no clientDetail: a documented card decision is
    // a 402. A 2xx VOIDED is not evidence anybody looked at the card, and its
    // body text is unverified (could name the firm's merchant account).
    return {
      outcome: "failed",
      failure: "request",
      detail: failureDetail(response, payload) || `LawPay reported status "${providerStatus}".`,
      chargeId,
      providerStatus,
    };
  }
  return {
    outcome: "unknown",
    detail: `LawPay returned HTTP ${response.status} with an unrecognised status (${providerStatus ?? "none"}). Verify in LawPay before charging again.`,
    chargeId,
    providerStatus,
  };
}

/* ─────────────────────────────── helpers ────────────────────────────────── */

/** 5xx/429/408 are answers about the SERVER after the request arrived. */
export function classifyHttpFailure(status: number): "failed" | "unknown" {
  if (status >= 500) return "unknown";
  if (status === 429 || status === 408) return "unknown";
  return "failed";
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  const ctor = AbortSignal as typeof AbortSignal & { timeout?: (ms: number) => AbortSignal };
  return typeof ctor.timeout === "function" ? ctor.timeout(ms) : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringField(payload: unknown, key: string): string | undefined {
  const value = record(payload)?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function integerField(payload: unknown, key: string): number | null {
  const value = record(payload)?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** The provider's own words, or undefined. Never the request (it holds a token). */
function providerMessage(payload: unknown): string | undefined {
  const direct =
    stringField(payload, "message") ??
    stringField(payload, "error") ??
    stringField(payload, "error_description") ??
    stringField(payload, "failure_message");
  if (direct) return direct;
  const messages = record(payload)?.["messages"];
  if (Array.isArray(messages)) {
    const first = messages.find((m) => typeof m === "string" || (m && typeof m === "object"));
    if (typeof first === "string" && first.trim()) return first;
    return stringField(first, "message") ?? stringField(first, "description");
  }
  return undefined;
}

function failureDetail(response: Response, payload: unknown): string {
  return providerMessage(payload) ?? `LawPay returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`;
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.name === "TimeoutError" ? "request timed out" : err.message;
  return String(err);
}
