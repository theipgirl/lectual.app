import { cleanClientText } from "@/lib/proposals/client-classes";
import { agreementCanonical } from "./canonical";
import { exhibitLines, type Exhibit } from "./exhibit";
import type { LoeValues } from "./fields";
import { renderLetter, type LetterBlock } from "./render";

/**
 * What a client types to sign, and how the agreement is put together from it. PURE: no node imports, so the browser and the
 * server run the same code and arrive at the same letter, the same exhibit and the same fingerprint.
 *
 * Nothing a client types is trusted. `cleanSigningDetails` runs every field through `cleanClientText` (control characters
 * become spaces, angle brackets are removed, whitespace collapses, 200 characters at most). The letter is built from the
 * stored letter and the CLEANED details; the browser's own rendering is only ever compared with the server's by fingerprint.
 *
 * Never logged and never sent to a model: this file imports neither.
 */

export type SignerDetails = {
  /** Full legal name of the client, goes on the letter ("Attention:", "Dear ..."). */
  client_name: string;
  /** Business or entity name; blank means the client signs for themselves. */
  entity_name: string;
  /** The signer's title in the business (optional). */
  title: string;
  street: string;
  street2: string;
  city: string;
  region: string;
  postal: string;
  country: string;
};

export const DETAIL_KEYS = ["client_name", "entity_name", "title", "street", "street2", "city", "region", "postal", "country"] as const satisfies ReadonlyArray<keyof SignerDetails>;

export function emptyDetails(): SignerDetails {
  return { client_name: "", entity_name: "", title: "", street: "", street2: "", city: "", region: "", postal: "", country: "" };
}

/** Whatever was posted, reduced to the nine fields, each cleaned. Never throws, never refuses. */
export function cleanSigningDetails(raw: unknown): SignerDetails {
  const out = emptyDetails();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const k of DETAIL_KEYS) out[k] = cleanClientText(src[k]);
  return out;
}

/** Details the client must give before the letter can be built: their name and where to write to them. */
export function missingDetails(d: SignerDetails): Array<keyof SignerDetails> {
  const need: Array<keyof SignerDetails> = ["client_name", "street", "city"];
  return need.filter((k) => d[k].length === 0);
}

export type SigningInput = {
  /** The full legal name typed to sign. */
  typedName: string;
  /** The agreement tick. */
  agree: boolean;
  details: SignerDetails;
  /** The fingerprint of what the browser showed. Only ever COMPARED with the server's. */
  fingerprint: string;
};

export type SigningRefusal = "name_required" | "details_required" | "agree_required";

export type SigningCheck = { ok: true; typedName: string; details: SignerDetails } | { ok: false; reason: SigningRefusal };

/** The shortest typed name accepted (a signature of one character is not a name). */
export const MIN_SIGNED_NAME = 2;

/**
 * The typed signature name, cleaned. The ONE normaliser for it: the page (the letter it shows and the fingerprint it sends) and the
 * server (`checkSigning`) both call this, so "Mary  Smith", a tab or a non-breaking space between the names, and spaces at either
 * end all become "Mary Smith" on both sides and can never make the two fingerprints disagree. The nine details go through
 * `cleanSigningDetails` on both sides the same way.
 */
export function cleanTypedName(raw: unknown): string {
  return cleanClientText(raw);
}

/** Cleans and checks what was posted. The details are checked before the name, the name before the tick. */
export function checkSigning(raw: unknown): SigningCheck {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const details = cleanSigningDetails(src.details);
  if (missingDetails(details).length > 0) return { ok: false, reason: "details_required" };
  const typedName = cleanTypedName(src.typedName);
  if (typedName.length < MIN_SIGNED_NAME) return { ok: false, reason: "name_required" };
  if (src.agree !== true) return { ok: false, reason: "agree_required" };
  return { ok: true, typedName, details };
}

/** Whether the sign button may be pressed (the same rule the server applies, minus the fingerprint). Pure. */
export function canSign(input: { typedName: string; agree: boolean; details: SignerDetails }): boolean {
  return checkSigning({ typedName: input.typedName, agree: input.agree, details: input.details }).ok;
}

/** The mailing address, one line per part that has text. Goes on the letter as `{{address_block}}`. */
export function addressBlock(d: SignerDetails): string {
  const cityLine = [d.city, [d.region, d.postal].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [d.street, d.street2, cityLine, d.country].filter(Boolean).join("\n");
}

/** The address as the signature row stores it (jsonb object, only the parts that have text). */
export function addressJson(d: SignerDetails): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["street", "street2", "city", "region", "postal", "country"] as const) if (d[k]) out[k] = d[k];
  return out;
}

export type LetterInputs = {
  details: SignerDetails;
  /** The typed signature name; before anything is typed the page shows the client's own name instead. */
  typedName: string;
  /** "November 12, 2026", in the firm's zone, worked out on the server. */
  dateText: string;
  clientEmail: string;
};

/** The seven merge values. The entity falls back to the client's own name so a letter never has a blank line. */
export function letterValues(i: LetterInputs): LoeValues {
  const signer = i.typedName || i.details.client_name;
  return {
    date: i.dateText,
    client_name: i.details.client_name,
    entity_name: i.details.entity_name || i.details.client_name,
    address_block: addressBlock(i.details),
    client_email: i.clientEmail,
    signer_name: signer,
    signed_date: i.dateText,
  };
}

export type Agreement = {
  blocks: LetterBlock[];
  exhibit: Exhibit;
  /** The letter and the exhibit as plain text: what the signature row stores and the sha256 covers. */
  text: string;
  /**
   * The canonical string that is hashed into the fingerprint the page sends and the server compares. It is built from the letter
   * with the two DATE fields (`date`, `signed_date`) replaced by a fixed placeholder, so a page opened one day and signed the next
   * still matches: the server stamps the real date into `text` (what is stored and what the stored sha256 covers).
   */
  canonical: string;
};

/** What stands in for `{{date}}` and `{{signed_date}}` in the canonical form. Never shown and never stored. */
export const FINGERPRINT_DATE = "[date]";

export type AgreementResult = { ok: true; agreement: Agreement } | { ok: false };

/** Merges the stored letter with the client's details. Fail closed: any unmerged field means no agreement at all. */
export function assembleAgreement(input: { body: string; inputs: LetterInputs; exhibit: Exhibit }): AgreementResult {
  const values = letterValues(input.inputs);
  const letter = renderLetter(input.body, values);
  if (!letter.ok) return { ok: false };
  // The same letter with the date fields fixed: what the fingerprint covers (see `Agreement.canonical`).
  const undated = renderLetter(input.body, { ...values, date: FINGERPRINT_DATE, signed_date: FINGERPRINT_DATE });
  if (!undated.ok) return { ok: false };
  return {
    ok: true,
    agreement: {
      blocks: letter.blocks,
      exhibit: input.exhibit,
      text: agreementText(letter.blocks, input.exhibit),
      canonical: agreementCanonical({ letter: undated.blocks, details: input.inputs.details, exhibit: input.exhibit }),
    },
  };
}

/** What the PAGE holds while a client fills in the steps: raw typed values, exactly as the inputs hold them. */
export type PageSigningState = {
  body: string;
  /** The nine details as typed (cleaned here, the way the server cleans them). */
  details: unknown;
  /** The signature name as typed (cleaned here with `cleanTypedName`, the way the server cleans it). */
  typedName: string;
  dateText: string;
  clientEmail: string;
  exhibit: Exhibit;
};

/**
 * The agreement the page shows and fingerprints, from what the client typed. Pure, and the ONLY place the page turns typed values
 * into an agreement, so the browser and the server cannot normalise a field differently. Null if the stored letter will not merge.
 */
export function pageAgreement(state: PageSigningState): Agreement | null {
  const r = assembleAgreement({
    body: state.body,
    inputs: { details: cleanSigningDetails(state.details), typedName: cleanTypedName(state.typedName), dateText: state.dateText, clientEmail: state.clientEmail },
    exhibit: state.exhibit,
  });
  return r.ok ? r.agreement : null;
}

/** What the sign action posts: the cleaned name and details, the tick, and the fingerprint of the agreement on screen. Null if it can't sign. */
export async function pageSigningPayload(state: PageSigningState & { agree: boolean }): Promise<SigningInput | null> {
  const details = cleanSigningDetails(state.details);
  const typedName = cleanTypedName(state.typedName);
  if (!canSign({ typedName, agree: state.agree, details })) return null;
  const agreement = pageAgreement(state);
  if (!agreement) return null;
  return { typedName, agree: state.agree, details, fingerprint: await fingerprintOf(agreement) };
}

/** Every paragraph in order (bold lead-in first), then Exhibit A. Deterministic. */
export function agreementText(blocks: readonly LetterBlock[], exhibit: Exhibit): string {
  const paras = blocks.map((b) => (b.lead ? `${b.lead} ${b.text}` : b.text));
  return `${paras.join("\n\n")}\n\n${exhibitLines(exhibit).join("\n")}`;
}

/** sha256 (hex) in the browser or on the server through Web Crypto. Async because that is the only form the browser has. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The fingerprint the page sends: sha256 of the canonical agreement (date fields fixed). Equal to `canonicalFingerprint(agreement.canonical)` on the server. */
export function fingerprintOf(agreement: Agreement): Promise<string> {
  return sha256Hex(agreement.canonical);
}

/** The letter's date in the firm's zone, "November 12, 2026". */
export function letterDateText(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "long", day: "numeric" }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(now);
  }
}

/**
 * "November 12, 2026 at 2:14 PM EST" in the firm's zone, or "" for an unreadable instant. The zone is always NAMED (its short
 * name from Intl, so daylight time reads EDT and an hour that happens twice in the autumn is not ambiguous): a signed time
 * with no zone says nothing. An unusable zone falls back to UTC, which is named too.
 */
export function signedAtText(signedAtIso: string, timeZone: string): string {
  const at = new Date(signedAtIso);
  if (Number.isNaN(at.getTime())) return "";
  const fmt = (zone: string) => ({
    day: new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "long", day: "numeric" }).format(at),
    time: new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at),
  });
  let parts: { day: string; time: string };
  try {
    parts = fmt(timeZone);
  } catch {
    parts = fmt("UTC");
  }
  return `${parts.day} at ${parts.time}`;
}

/** The same instant in UTC, ISO 8601 ("2026-11-12T19:14:03.000Z"), for the PDF's signature record. "" for an unreadable instant. */
export function signedAtUtcIso(signedAtIso: string): string {
  const at = new Date(signedAtIso);
  return Number.isNaN(at.getTime()) ? "" : at.toISOString();
}

/** "Signed November 12, 2026 at 2:14 PM EST by Alex Sample". */
export function signedLineText(signedAtIso: string, timeZone: string, name: string): string {
  const when = signedAtText(signedAtIso, timeZone);
  return when ? `Signed ${when} by ${name}` : `Signed by ${name}`;
}
