import { withTimeout } from "@/lib/http/timeout";
import { AdobeCallError, adobeCodeOf, errorForResponse, errorForThrown } from "./adobe-errors";
import { adobeAccessPoint } from "./host-rule";
import { cancelPayload } from "./payload";

/**
 * The few Adobe Acrobat Sign REST v6 calls Lectual makes, each with the FIRM's own token at the FIRM's own checked
 * `api_access_point` (Sprint 5a). No email, reminder, `x-api-user`, `:account` / `:group` scope or signed-document webhook body
 * exists here (a hygiene test greps this folder).
 *
 * Every call:
 *  - checks the access point against the host rule FIRST: a token is never sent to a host outside it (no request at all);
 *  - has a deadline;
 *  - reads only what it needs from a 2xx, and only Adobe's machine `code` from anything else (`adobe-errors.ts`). No Adobe text
 *    is returned, thrown, logged or stored.
 *
 * `fetchImpl` is injected everywhere, so no test reaches Adobe.
 */

export type AdobeFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type AdobeAccess = { accessPoint: string; accessToken: string };

export const ADOBE_CALL_TIMEOUT_MS = 15_000;
const API = "/api/rest/v6";

/** The refusal thrown before any request when the stored access point breaks the host rule. */
export class AdobeHostRefused extends Error {
  constructor() {
    super("adobe_host_refused");
    this.name = "AdobeHostRefused";
  }
}

function base(access: AdobeAccess): string {
  const origin = adobeAccessPoint(access.accessPoint);
  if (!origin) throw new AdobeHostRefused();
  return `${origin}${API}`;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function call(fetchImpl: AdobeFetch, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(url, withTimeout({ ...init, cache: "no-store" }, ADOBE_CALL_TIMEOUT_MS));
  } catch (err) {
    throw errorForThrown(err);
  }
  if (!res.ok) {
    const code = adobeCodeOf(await readJson(res));
    throw errorForResponse(res.status, code, res.headers.get("retry-after"));
  }
  return res;
}

function auth(access: AdobeAccess): Record<string, string> {
  return { Authorization: `Bearer ${access.accessToken}`, Accept: "application/json" };
}

function idFrom(body: unknown): string | null {
  const id = body && typeof body === "object" ? (body as Record<string, unknown>).id : null;
  return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : null;
}

/** POST /transientDocuments: the PDF, by itself. Returns the transient document id. */
export async function uploadTransientDocument(fetchImpl: AdobeFetch, access: AdobeAccess, pdf: Uint8Array, fileName: string): Promise<string> {
  const url = `${base(access)}/transientDocuments`;
  const form = new FormData();
  form.set("File-Name", fileName);
  form.set("Mime-Type", "application/pdf");
  form.set("File", new Blob([pdf as BlobPart], { type: "application/pdf" }), fileName);
  const res = await call(fetchImpl, url, { method: "POST", headers: auth(access), body: form });
  const body = (await readJson(res)) as Record<string, unknown> | null;
  const id = typeof body?.transientDocumentId === "string" && body.transientDocumentId ? body.transientDocumentId : null;
  if (!id) throw new AdobeCallError("adobe_unavailable", res.status, false);
  return id;
}

/** POST /agreements. Returns the agreement id. */
export async function createAgreement(fetchImpl: AdobeFetch, access: AdobeAccess, payload: Record<string, unknown>): Promise<string> {
  const res = await call(fetchImpl, `${base(access)}/agreements`, {
    method: "POST",
    headers: { ...auth(access), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const id = idFrom(await readJson(res));
  if (!id) throw new AdobeCallError("adobe_unavailable", res.status, false);
  return id;
}

/** POST /webhooks (RESOURCE scope for one agreement). */
export async function registerWebhook(fetchImpl: AdobeFetch, access: AdobeAccess, payload: Record<string, unknown>): Promise<void> {
  await call(fetchImpl, `${base(access)}/webhooks`, {
    method: "POST",
    headers: { ...auth(access), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** The first signing URL Adobe returns, NOT yet checked against the host rule (the caller does that). Never stored or logged. */
function firstEsignUrl(body: unknown): string | null {
  const sets = body && typeof body === "object" ? (body as Record<string, unknown>).signingUrlSetInfos : null;
  if (!Array.isArray(sets)) return null;
  for (const set of sets) {
    const urls = set && typeof set === "object" ? (set as Record<string, unknown>).signingUrls : null;
    if (!Array.isArray(urls)) continue;
    for (const u of urls) {
      const esign = u && typeof u === "object" ? (u as Record<string, unknown>).esignUrl : null;
      if (typeof esign === "string" && esign.length > 0) return esign;
    }
  }
  return null;
}

/** GET /agreements/{id}/signingUrls. No `frameParent`: the page is reached top-level, never in an iframe. */
export async function fetchSigningUrl(fetchImpl: AdobeFetch, access: AdobeAccess, agreementId: string): Promise<string> {
  const res = await call(fetchImpl, `${base(access)}/agreements/${encodeURIComponent(agreementId)}/signingUrls`, { method: "GET", headers: auth(access) });
  const url = firstEsignUrl(await readJson(res));
  if (!url) throw new AdobeCallError("adobe_unavailable", res.status, false);
  return url;
}

/** PUT /agreements/{id}/state → CANCELLED, with the cancellation email off. */
export async function cancelAgreement(fetchImpl: AdobeFetch, access: AdobeAccess, agreementId: string): Promise<void> {
  await call(fetchImpl, `${base(access)}/agreements/${encodeURIComponent(agreementId)}/state`, {
    method: "PUT",
    headers: { ...auth(access), "Content-Type": "application/json" },
    body: JSON.stringify(cancelPayload()),
  });
}

/** Adobe's agreement statuses this app acts on. Anything else reads as `OTHER` (left as it is). */
export type AgreementStatus = "SIGNED" | "OUT_FOR_SIGNATURE" | "CANCELLED" | "EXPIRED" | "DECLINED" | "OTHER";

/** GET /agreements/{id}: the status only. */
export async function readAgreementStatus(fetchImpl: AdobeFetch, access: AdobeAccess, agreementId: string): Promise<AgreementStatus> {
  const res = await call(fetchImpl, `${base(access)}/agreements/${encodeURIComponent(agreementId)}`, { method: "GET", headers: auth(access) });
  const body = await readJson(res);
  const status = body && typeof body === "object" ? (body as Record<string, unknown>).status : null;
  if (status === "SIGNED" || status === "OUT_FOR_SIGNATURE" || status === "CANCELLED" || status === "EXPIRED") return status;
  if (status === "DECLINED" || status === "RECALLED") return status === "DECLINED" ? "DECLINED" : "CANCELLED";
  return "OTHER";
}
