/**
 * Proposal validation — the firm's rules, checked on what a client will read.
 *
 * Pure and total: takes `unknown` (the jsonb column, an agent's output, an
 * editor's draft) and never throws. It returns a list of issues; the caller
 * decides what to do with them. The store refuses to APPROVE a proposal that
 * has any `error`; a draft may carry errors (the editor shows them inline), and
 * a `warning` never blocks anything.
 *
 * Errors, in the order the firm cares about them:
 *   - an International Class NUMBER anywhere client-facing ("IC 035",
 *     "International Class 9", "Class 25", "Class 09"). Counting labels
 *     "Class 1" / "Class 2" / "Class 3" are allowed (Rebecca, 2026-10-16), so a
 *     bare single-digit "Class N" is only a warning.
 *   - an includes row that offers the SUBSTANTIVE office action response. The
 *     strategy review is fine; "Non-Substantive ..." is fine; the response is
 *     never part of a package.
 *   - duplicate ids (a mark or class id is a key in the client's selection, so
 *     a collision silently ticks two boxes);
 *   - money that is not a non-negative integer number of cents, a percentage
 *     outside 0..100;
 *   - no brand name with at least one mark and one class (nothing to buy);
 *   - a pay link that is not https.
 * With `forApproval`, the row's own expiry, pay link and client email are
 * required too (they are columns, not content, so the caller passes them in).
 */

import { isMarkKind } from "./types";

export type ValidationLevel = "error" | "warning";
export type ValidationIssue = { path: string; message: string; level: ValidationLevel };

export type ValidateOptions = {
  /** Approval is stricter: expiry, pay link and client email are required. */
  forApproval?: boolean;
  /** Row columns that live beside `content`. */
  title?: string | null;
  expires_on?: string | null;
  pay_url?: string | null;
  client_email?: string | null;
};

/** client_proposal.content is limited to 256KB by a check constraint. */
export const MAX_CONTENT_BYTES = 256 * 1024;

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}

/* ─────────────────────────── the firm's text rules ───────────────────────── */

/** "IC 035", "IC35", "IC-9". */
const IC_ABBREVIATION = /\bIC\s*[-#]?\s*\d/i;
/** "International Class 9", "International Classes 9 and 25", "Intl. Class 35". */
const INTERNATIONAL_CLASS = /\b(?:international|intl\.?)\s+class(?:es)?\s*(?:no\.?|number|#)?\s*\d/i;
/** "Class 25", "Class 035", "Classes 9". Two or more digits is never a counting label. */
const CLASS_MULTI_DIGIT = /\bclass(?:es)?\s*(?:no\.?|number|#)?\s*\d{2,}/i;
/** Zero-padded: "Class 09" (also caught above, kept for the message). */
const CLASS_ZERO_PADDED = /\bclass(?:es)?\s*0\d/i;
/** A single-digit "Class 4": legal only as a counting label. */
const CLASS_SINGLE_DIGIT = /\bclass\s*(\d)\b/gi;

/**
 * Whether an includes label offers the substantive office action RESPONSE.
 * "Non-Substantive Office Action Response" is the package's own line and
 * "Substantive Office Action Legal Strategy Review" is the strategy review;
 * neither matches. Anything else that pairs "office action" with "response" does.
 */
export function offersSubstantiveOfficeActionResponse(label: string): boolean {
  const l = label.toLowerCase();
  if (!/office[\s-]*action/.test(l) || !/respon/.test(l)) return false;
  if (/non[\s-]*substantive/.test(l)) return false;
  if (/strategy\s+review/.test(l)) return false;
  return true;
}

function textIssues(path: string, text: string, out: ValidationIssue[]): void {
  if (IC_ABBREVIATION.test(text)) {
    out.push({ path, level: "error", message: 'Remove the International Class number ("IC ..."). Class numbers are never shown to clients.' });
  } else if (INTERNATIONAL_CLASS.test(text)) {
    out.push({ path, level: "error", message: 'Remove "International Class" and its number. Class numbers are never shown to clients.' });
  } else if (CLASS_ZERO_PADDED.test(text)) {
    out.push({ path, level: "error", message: 'Remove the zero-padded class number (like "Class 09"). Class numbers are never shown to clients.' });
  } else if (CLASS_MULTI_DIGIT.test(text)) {
    out.push({ path, level: "error", message: 'Remove the class number (like "Class 25"). Only "Class 1", "Class 2" and "Class 3" counting labels are allowed.' });
  } else {
    for (const m of text.matchAll(CLASS_SINGLE_DIGIT)) {
      const n = Number(m[1]);
      out.push({
        path,
        level: "warning",
        message:
          n <= 3
            ? `"Class ${n}" is only allowed as a counting label (Class 1, 2, 3). Make sure it is not an International Class number.`
            : `"Class ${n}" could be read as an International Class number. Class numbers are never shown to clients.`,
      });
      break;
    }
  }
}

/* ─────────────────────────── small readers ───────────────────────────────── */

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isCents(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** A real calendar date, YYYY-MM-DD. */
export function isCivilDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

export function isPlausibleEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/.test(value);
}

/* ─────────────────────────── the validator ───────────────────────────────── */

export function validateContent(content: unknown, options: ValidateOptions = {}): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const err = (path: string, message: string) => out.push({ path, message, level: "error" });
  const warn = (path: string, message: string) => out.push({ path, message, level: "warning" });

  /* ── the row columns beside the content ── */
  if (options.title) textIssues("title", options.title, out);

  const payUrl = (options.pay_url ?? "").trim();
  if (payUrl) {
    if (payUrl.length > 2000) err("pay_url", "The pay link is too long (2,000 characters at most).");
    else if (!isHttpsUrl(payUrl)) err("pay_url", "The pay link must be an https:// address.");
  }
  const expires = (options.expires_on ?? "").trim();
  if (expires && !isCivilDate(expires)) err("expires_on", "Pick a real expiry date.");
  const email = (options.client_email ?? "").trim();
  if (email && !isPlausibleEmail(email)) err("client_email", "That client email address doesn't look right.");

  if (options.forApproval) {
    if (!expires) err("expires_on", "Set an expiry date before approving.");
    if (!payUrl) err("pay_url", "Add the pay link before approving.");
    if (!email) err("client_email", "Add the client's email before approving.");
  }

  /* ── the content document ── */
  if (!isObj(content)) {
    err("content", "The proposal has no content.");
    return out;
  }
  try {
    if (JSON.stringify(content).length > MAX_CONTENT_BYTES) {
      err("content", "The proposal is too large to save (256KB at most).");
    }
  } catch {
    err("content", "The proposal content could not be read.");
    return out;
  }

  // client
  const client = isObj(content.client) ? content.client : null;
  if (!client) err("client", "Add the client's name.");
  else {
    if (!str(client.full_name).trim()) err("client.full_name", "Add the client's full name.");
    if (!str(client.first_name).trim()) err("client.first_name", "Add the client's first name (used in the greeting).");
    if (client.company != null && typeof client.company !== "string") err("client.company", "The company must be text.");
    textIssues("client.company", str(client.company), out);
  }

  // free text the client reads
  if (!str(content.greeting).trim()) err("greeting", "Add the greeting paragraph.");
  for (const key of ["greeting", "recommendation", "office_action_note"] as const) {
    if (content[key] != null && typeof content[key] !== "string") err(key, "This must be text.");
    textIssues(key, str(content[key]), out);
  }

  // pricing
  const pricing = isObj(content.pricing) ? content.pricing : null;
  if (!pricing) err("pricing", "Add the package pricing.");
  else {
    if (!str(pricing.package).trim()) err("pricing.package", "Name the package.");
    textIssues("pricing.package", str(pricing.package), out);
    for (const key of ["base_cents", "per_class_cents", "gov_per_class_cents"] as const) {
      if (!isCents(pricing[key])) err(`pricing.${key}`, "Money must be a whole number of cents, zero or more.");
    }
    const included = pricing.included_classes;
    if (typeof included !== "number" || !Number.isInteger(included) || included < 0) {
      err("pricing.included_classes", "Included classes must be a whole number, zero or more.");
    }
    const pct = pricing.second_mark_discount_pct;
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      err("pricing.second_mark_discount_pct", "The second-mark discount must be between 0 and 100 percent.");
    }
  }

  // names, marks, classes
  const names = Array.isArray(content.names) ? content.names : null;
  if (!names) err("names", "Add at least one brand name.");
  const nameIds = new Map<string, number>();
  const selectionIds = new Map<string, string>();
  let buyable = false;
  (names ?? []).forEach((raw, i) => {
    const p = `names[${i}]`;
    if (!isObj(raw)) return err(p, "This brand name is not readable.");
    const id = str(raw.id).trim();
    if (!id) err(`${p}.id`, "Every brand name needs an id.");
    else if (nameIds.has(id)) err(`${p}.id`, `Two brand names share the id "${id}".`);
    else nameIds.set(id, i);
    if (!str(raw.name).trim()) err(`${p}.name`, "Give this brand name its text.");
    for (const key of ["name", "what", "note"] as const) {
      if (raw[key] != null && typeof raw[key] !== "string") err(`${p}.${key}`, "This must be text.");
      textIssues(`${p}.${key}`, str(raw[key]), out);
    }

    if (raw.price_override != null) {
      if (!isObj(raw.price_override)) err(`${p}.price_override`, "The price override is not readable.");
      else {
        for (const key of ["base_cents", "per_class_cents"] as const) {
          const v = raw.price_override[key];
          if (v != null && !isCents(v)) err(`${p}.price_override.${key}`, "Money must be a whole number of cents, zero or more.");
        }
      }
    }

    const claim = (itemId: string, path: string) => {
      if (!itemId) return err(`${path}.id`, "Every mark and class needs an id.");
      const first = selectionIds.get(itemId);
      if (first) err(`${path}.id`, `The id "${itemId}" is also used at ${first}. Ids must be unique, or one checkbox would tick two.`);
      else selectionIds.set(itemId, path);
    };

    const marks = Array.isArray(raw.marks) ? raw.marks : [];
    const classes = Array.isArray(raw.classes) ? raw.classes : [];
    marks.forEach((m, j) => {
      const mp = `${p}.marks[${j}]`;
      if (!isObj(m)) return err(mp, "This mark is not readable.");
      claim(str(m.id).trim(), mp);
      if (!isMarkKind(m.kind)) err(`${mp}.kind`, 'A mark is either a "word" or a "logo" mark.');
      if (!str(m.desc).trim()) warn(`${mp}.desc`, "This mark has no description for the client.");
      textIssues(`${mp}.desc`, str(m.desc), out);
      if (typeof m.preselected !== "boolean") err(`${mp}.preselected`, "Say whether this mark starts ticked.");
    });
    classes.forEach((c, j) => {
      const cp = `${p}.classes[${j}]`;
      if (!isObj(c)) return err(cp, "This class is not readable.");
      claim(str(c.id).trim(), cp);
      if (!str(c.label).trim()) err(`${cp}.label`, "Describe this class in plain business language.");
      textIssues(`${cp}.label`, str(c.label), out);
      if (typeof c.preselected !== "boolean") err(`${cp}.preselected`, "Say whether this class starts ticked.");
    });
    if (marks.length > 0 && classes.length > 0) buyable = true;
  });
  if (names && !buyable) err("names", "Add at least one brand name with a mark and a class.");

  // adjustments
  const adjustmentIds = new Set<string>();
  (Array.isArray(content.adjustments) ? content.adjustments : []).forEach((raw, i) => {
    const p = `adjustments[${i}]`;
    if (!isObj(raw)) return err(p, "This adjustment is not readable.");
    const id = str(raw.id).trim();
    if (!id) err(`${p}.id`, "Every adjustment needs an id.");
    else if (adjustmentIds.has(id)) err(`${p}.id`, `Two adjustments share the id "${id}".`);
    else adjustmentIds.add(id);
    if (!str(raw.label).trim()) err(`${p}.label`, "Label this adjustment so the client knows what it is.");
    textIssues(`${p}.label`, str(raw.label), out);
    if (raw.kind !== "amount" && raw.kind !== "percent") {
      err(`${p}.kind`, 'An adjustment is either an "amount" or a "percent".');
    } else if (raw.kind === "amount") {
      if (!isCents(raw.value)) err(`${p}.value`, "An amount must be a whole number of cents, zero or more.");
    } else if (typeof raw.value !== "number" || !Number.isFinite(raw.value) || raw.value < 0 || raw.value > 100) {
      err(`${p}.value`, "A percentage must be between 0 and 100.");
    }
  });

  // includes
  (Array.isArray(content.includes) ? content.includes : []).forEach((raw, i) => {
    const p = `includes[${i}]`;
    if (!isObj(raw)) return err(p, "This row is not readable.");
    const label = str(raw.label);
    if (!label.trim()) err(`${p}.label`, "Give this row a label.");
    if (offersSubstantiveOfficeActionResponse(label)) {
      err(
        `${p}.label`,
        "The substantive office action response is never part of a package. Use the strategy review, or the non-substantive response.",
      );
    }
    if (!str(raw.included).trim()) err(`${p}.included`, "Say what is included for this row (a check mark, a count).");
    for (const key of ["label", "value", "included", "note"] as const) {
      if (raw[key] != null && typeof raw[key] !== "string") err(`${p}.${key}`, "This must be text.");
      textIssues(`${p}.${key}`, str(raw[key]), out);
    }
  });

  return out;
}

/* ─────────────────────────── the firm's settings ─────────────────────────── */

export type SettingInput = {
  approver_user_ids: unknown;
  default_pay_url: unknown;
  notify_email: unknown;
  pricing: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** client_proposal_setting's own limits, checked before the database sees them. */
export function validateSettingInput(input: SettingInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const err = (path: string, message: string) => out.push({ path, message, level: "error" });

  const ids = input.approver_user_ids;
  if (!Array.isArray(ids)) err("approver_user_ids", "Approvers must be a list of people.");
  else {
    if (ids.length > 10) err("approver_user_ids", "A firm can name at most 10 approvers.");
    if (ids.some((id) => typeof id !== "string" || !UUID.test(id))) err("approver_user_ids", "An approver is not a valid user.");
    if (new Set(ids).size !== ids.length) err("approver_user_ids", "An approver is listed twice.");
  }

  if (input.default_pay_url != null && input.default_pay_url !== "") {
    const url = str(input.default_pay_url).trim();
    if (typeof input.default_pay_url !== "string" || url.length > 2000 || !isHttpsUrl(url)) {
      err("default_pay_url", "The default pay link must be an https:// address (2,000 characters at most).");
    }
  }
  if (input.notify_email != null && input.notify_email !== "") {
    if (typeof input.notify_email !== "string" || !isPlausibleEmail(input.notify_email.trim())) {
      err("notify_email", "That notification email address doesn't look right.");
    }
  }
  if (!isObj(input.pricing)) err("pricing", "Standard pricing must be an object.");
  else {
    try {
      if (JSON.stringify(input.pricing).length > 64 * 1024) err("pricing", "Standard pricing is too large (64KB at most).");
    } catch {
      err("pricing", "Standard pricing could not be read.");
    }
    const p = input.pricing;
    for (const key of ["base_cents", "per_class_cents", "gov_per_class_cents"] as const) {
      if (p[key] != null && !isCents(p[key])) err(`pricing.${key}`, "Money must be a whole number of cents, zero or more.");
    }
    if (p.included_classes != null && (typeof p.included_classes !== "number" || !Number.isInteger(p.included_classes) || p.included_classes < 0)) {
      err("pricing.included_classes", "Included classes must be a whole number, zero or more.");
    }
    const pct = p.second_mark_discount_pct;
    if (pct != null && (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100)) {
      err("pricing.second_mark_discount_pct", "The second-mark discount must be between 0 and 100 percent.");
    }
    if (p.includes != null) {
      if (!Array.isArray(p.includes)) err("pricing.includes", "The includes list must be a list.");
      else {
        p.includes.forEach((row, i) => {
          const label = isObj(row) ? str(row.label) : "";
          if (offersSubstantiveOfficeActionResponse(label)) {
            err(`pricing.includes[${i}].label`, "The substantive office action response is never part of a package.");
          }
          if (isObj(row)) {
            for (const key of ["label", "value", "included", "note"] as const) textIssues(`pricing.includes[${i}].${key}`, str(row[key]), out);
          }
        });
      }
    }
  }
  return out;
}
