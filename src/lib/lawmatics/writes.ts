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
  /** Leave Lawmatics' answer out of the log. The proposal writers send client text, which an error body can echo. */
  quiet = false,
): Promise<LawmaticsWriteResult<{ body: unknown }>> {
  try {
    const res = await fetchImpl(`${LAWMATICS_DEFAULT_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...LAWMATICS_HEADERS },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = quiet ? "" : await res.text().catch(() => "");
      console.error(`[lawmatics] ${method} ${path.replace(/\/\d+$/, "/:id")} failed ${res.status}`, detail.slice(0, 300));
      return { ok: false, reason: `HTTP ${res.status}`, retryable: retryableStatus(res.status), status: res.status };
    }
    return { ok: true, body: await res.json().catch(() => null) };
  } catch (err) {
    console.error(`[lawmatics] ${method} ${path.replace(/\/\d+$/, "/:id")} threw`, quiet ? "" : err instanceof Error ? err.message : err);
    return { ok: false, reason: quiet ? "request failed" : err instanceof Error ? err.message : "unknown error", retryable: true };
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

/* ─────────────────────────── proposals (Sprint 19) ─────────────────────────
 * The firm's own token, as above. The shapes below come from the public API reference
 * and have NOT been checked against a live account: any non-2xx is "not done", and
 * every 2xx is "done" whatever the body says. These writers log no response text.
 */

/** `POST /notes`: a flat `{name, body, notable_type, notable_id}` (lawmatics-mcp `src/proposals.ts`). */
export async function addNote(
  token: string,
  note: { name: string; body: string; notableType: string; notableId: string },
  fetchImpl: FetchLike = defaultFetch,
): Promise<LawmaticsWriteResult> {
  const r = await send(
    token,
    "POST",
    "/notes",
    { name: note.name, body: note.body, notable_type: note.notableType, notable_id: note.notableId },
    fetchImpl,
    true,
  );
  return r.ok ? { ok: true } : r;
}

/** `PUT /prospects/:id` with `custom_fields: [{id, value}]` and nothing else: no stage, no tags. */
export async function setProspectCustomFields(
  token: string,
  prospectId: string,
  fields: ReadonlyArray<{ id: string; value: string }>,
  fetchImpl: FetchLike = defaultFetch,
): Promise<LawmaticsWriteResult> {
  if (fields.length === 0) return { ok: true };
  const r = await send(token, "PUT", prospectPath(prospectId), { custom_fields: fields.map((f) => ({ id: f.id, value: f.value })) }, fetchImpl, true);
  return r.ok ? { ok: true } : r;
}

/** Like `FetchLike`, but the body is multipart: the caller sets no Content-Type so the boundary is generated. */
export type MultipartFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData },
) => Promise<{ ok: boolean; status: number }>;

const defaultMultipartFetch: MultipartFetchLike = (url, init) => fetch(url, init);

/** The one folder a proposal's files go in. */
export const LAWMATICS_FILE_PATH = "Engagement";

/**
 * `POST /files` (multipart): `documentable_type=matter`, `documentable_id`, `file` and
 * `path[]`. Any non-2xx, and a thrown request, is `{ ok: false }`; the caller says
 * "not uploaded".
 */
export async function uploadMatterFile(
  token: string,
  file: { matterId: string; fileName: string; mime: string; bytes: Uint8Array; path?: string },
  fetchImpl: MultipartFetchLike = defaultMultipartFetch,
): Promise<LawmaticsWriteResult> {
  try {
    const form = new FormData();
    form.append("documentable_type", "matter");
    form.append("documentable_id", file.matterId);
    form.append("file", new Blob([file.bytes as BlobPart], { type: file.mime }), file.fileName);
    form.append("path[]", file.path ?? LAWMATICS_FILE_PATH);
    const res = await fetchImpl(`${LAWMATICS_DEFAULT_BASE}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: LAWMATICS_HEADERS.Accept },
      body: form,
    });
    if (!res.ok) {
      console.error(`[lawmatics] POST /files failed ${res.status}`);
      return { ok: false, reason: `HTTP ${res.status}`, retryable: retryableStatus(res.status), status: res.status };
    }
    return { ok: true };
  } catch {
    console.error("[lawmatics] POST /files threw");
    return { ok: false, reason: "request failed", retryable: true };
  }
}
