import "server-only";

import {
  extractContactId,
  prospectPath,
  toContactPayload,
  toProspectUpdatePayload,
  toTagsPayload,
  LAWMATICS_CREATE_PATH,
  LAWMATICS_DEFAULT_BASE,
  LAWMATICS_HEADERS,
  LAWMATICS_TAG_ATTACH_PATH,
  type LawmaticsContactInput,
  type LawmaticsProspectUpdate,
} from "./contact-payload";

/**
 * Lawmatics writes, with a FIRM's own token (lectual 0077), for the intake
 * sync. Ported from lectual's `src/lib/lawmatics/contacts.ts`, which reads the
 * deployment-wide LAWMATICS_TOKEN; here the token is an argument, and only
 * `../intake-forms/lawmatics-sync.ts` supplies one, read for the org of the
 * intake row a public slug resolved.
 *
 * Request shapes live in ./contact-payload.ts (ported verbatim): it records
 * which endpoints the live API actually accepted. Every function here NEVER
 * throws and returns a result, so the caller records success only when it
 * happened and a Lawmatics outage never costs the firm a lead.
 */

export type LawmaticsWriteResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; reason: string; retryable: boolean; status?: number };

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

function retryableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

async function send(
  token: string,
  method: "POST" | "PUT",
  path: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<LawmaticsWriteResult<{ body: unknown }>> {
  try {
    const res = await fetchImpl(`${LAWMATICS_DEFAULT_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...LAWMATICS_HEADERS },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[lawmatics] ${method} ${path.replace(/\/\d+$/, "/:id")} failed ${res.status}`, detail.slice(0, 300));
      return { ok: false, reason: `HTTP ${res.status}`, retryable: retryableStatus(res.status), status: res.status };
    }
    return { ok: true, body: await res.json().catch(() => null) };
  } catch (err) {
    console.error(`[lawmatics] ${method} ${path.replace(/\/\d+$/, "/:id")} threw`, err instanceof Error ? err.message : err);
    return { ok: false, reason: err instanceof Error ? err.message : "unknown error", retryable: true };
  }
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/** `POST /prospects`: creates the person. */
export async function createProspect(
  token: string,
  input: LawmaticsContactInput,
  fetchImpl: FetchLike = defaultFetch,
): Promise<LawmaticsWriteResult<{ contactId: string }>> {
  const r = await send(token, "POST", LAWMATICS_CREATE_PATH, toContactPayload(input), fetchImpl);
  if (!r.ok) return r;
  const contactId = extractContactId(r.body);
  // A 2xx we can't read may have created a record we can no longer reference.
  if (!contactId) return { ok: false, reason: "no contact id in response", retryable: true };
  return { ok: true, contactId };
}

/** `POST /tags/attach`: attaches tags BY NAME (unknown names are created). */
export async function attachTags(token: string, contactId: string, tags: string[], fetchImpl: FetchLike = defaultFetch): Promise<LawmaticsWriteResult> {
  if (tags.length === 0) return { ok: true };
  const r = await send(token, "POST", LAWMATICS_TAG_ATTACH_PATH, toTagsPayload(contactId, tags), fetchImpl);
  return r.ok ? { ok: true } : r;
}

/** `PUT /prospects/:id`: tags again plus notes, the second independent attempt (see contact-payload.ts). */
export async function updateProspect(
  token: string,
  contactId: string,
  update: LawmaticsProspectUpdate,
  fetchImpl: FetchLike = defaultFetch,
): Promise<LawmaticsWriteResult> {
  const body = toProspectUpdatePayload(update);
  if (Object.keys(body).length === 0) return { ok: true };
  const r = await send(token, "PUT", prospectPath(contactId), body, fetchImpl);
  return r.ok ? { ok: true } : r;
}
