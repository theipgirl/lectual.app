/**
 * Proposal editor — turning a submitted form into the content document.
 *
 * Pure: no database, no `server-only`, nothing that reads the clock or rolls
 * dice (the server action passes in a `newId` source). Everything here takes a
 * `FormData`, returns `{ ok: true, value }` or `{ ok: false, error }`, and never
 * throws. The server actions in `src/app/dashboard/proposals/` call these, then
 * hand the whole updated `ProposalContent` to `updateProposal`.
 *
 * ── WHAT THIS FILE REFUSES, AND WHAT IT LEAVES TO validate.ts ───────────────
 * It refuses only what it cannot represent: a dollar amount that is not a
 * dollar amount, a percentage that is not a number, a date that is not a
 * date. Everything that is a *firm rule* (class numbers in client-facing text,
 * the substantive office action response, https pay links, a missing mark)
 * is `validateContent`'s job, and a draft may carry those errors, so they are
 * saved and shown inline. Pricing is not reimplemented: money comes in as
 * dollars, leaves as integer cents via the quote engine's string parser.
 *
 * ── MONEY ───────────────────────────────────────────────────────────────────
 * The UI speaks dollars, the document speaks cents. `parseDollarsToCents` is
 * string arithmetic (no `* 100` on a float), and refuses a third decimal place
 * rather than rounding someone's typo.
 */

import { centsToInput, parseDollarsToCents } from "@/lib/quotes/money";
import {
  MARK_KIND_DEFAULT_DESC,
  isMarkKind,
  type ProposalAdjustment,
  type ProposalClass,
  type ProposalContent,
  type ProposalInclude,
  type ProposalMark,
  type ProposalName,
  type ProposalPricing,
  type ProposalSettingPricing,
} from "@/lib/proposals/types";
import { isCivilDate } from "@/lib/proposals/validate";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (error: string): Parsed<never> => ({ ok: false, error });

/* ─────────────────────────── scalar readers ─────────────────────────────── */

function text(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Blank -> undefined, so the key is left out of the document altogether. */
function optionalText(form: FormData, key: string): string | undefined {
  return text(form, key) || undefined;
}

/**
 * "$4,950", "4950.5", "4,950.00" -> cents. `label` names the field in the
 * refusal ("Base price: enter a dollar amount like 4950 or 4950.50").
 */
export function parseMoney(raw: string, label: string): Parsed<number> {
  const cents = parseDollarsToCents(raw);
  if (cents === null || cents < 0) return fail(`${label}: enter a dollar amount like 4950 or 4950.50.`);
  return ok(cents);
}

/** Blank is allowed and means "none"; anything else must be money. */
export function parseOptionalMoney(raw: string, label: string): Parsed<number | undefined> {
  if (!raw.trim()) return ok(undefined);
  return parseMoney(raw, label);
}

/** "20", "12.5", "20%" -> a number 0..100 with at most two decimals. */
export function parsePercent(raw: string, label: string): Parsed<number> {
  const m = /^(\d{1,3}(?:\.\d{1,2})?)\s*%?$/.exec(raw.trim());
  if (!m) return fail(`${label}: enter a percentage from 0 to 100.`);
  const n = Number(m[1]);
  if (n < 0 || n > 100) return fail(`${label}: enter a percentage from 0 to 100.`);
  return ok(n);
}

/** A whole number of zero or more ("3"). */
export function parseCount(raw: string, label: string): Parsed<number> {
  const m = /^\d{1,4}$/.exec(raw.trim());
  if (!m) return fail(`${label}: enter a whole number.`);
  return ok(Number(m[0]));
}

/** "" -> null; a real YYYY-MM-DD -> itself; anything else is refused. */
export function parseDateInput(raw: string, label: string): Parsed<string | null> {
  const v = raw.trim();
  if (!v) return ok(null);
  if (!isCivilDate(v)) return fail(`${label}: pick a real date.`);
  return ok(v);
}

/* ─────────────────────────── repeated rows ──────────────────────────────── */

/**
 * Rows named `<prefix>.<n>.<field>` -> an array in ascending `n`. A row exists
 * if any of its fields was posted. Missing fields read as "".
 */
export function collectRows(form: FormData, prefix: string, fields: readonly string[]): Record<string, string>[] {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}\\.(\\d+)\\.([A-Za-z_]+)$`);
  const indexes = new Set<number>();
  for (const key of form.keys()) {
    const m = pattern.exec(key);
    if (m) indexes.add(Number(m[1]));
  }
  return [...indexes]
    .sort((a, b) => a - b)
    .map((n) => {
      const row: Record<string, string> = {};
      for (const f of fields) {
        const v = form.get(`${prefix}.${n}.${f}`);
        row[f] = typeof v === "string" ? v.trim() : "";
      }
      return row;
    });
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,48}$/;

/**
 * An id from the form if it is well-formed and not already taken; otherwise a
 * fresh `<prefix>-<random>`. A mark or class id is a key in the client's
 * selection, so a collision would tick two boxes; the editor's browser makes
 * the ids, and this makes sure a hand-built request cannot smuggle in a
 * strange or duplicate one.
 */
export function cleanId(raw: string, prefix: string, taken: Set<string>, rand: () => string): string {
  let id = SAFE_ID.test(raw) && !taken.has(raw) ? raw : "";
  let guard = 0;
  while (!id || taken.has(id)) {
    id = `${prefix}-${rand()}`;
    if (++guard > 20) throw new Error("could not make a unique id");
  }
  taken.add(id);
  return id;
}

/* ─────────────────────────── the sections ───────────────────────────────── */

export type DetailsPatch = {
  clientName: string;
  clientEmail: string | null;
  title: string;
  expiresOn: string | null;
  payUrl: string | null;
  content: ProposalContent;
};

/** Client names, email, title, expiry and pay link. `client_name` follows `content.client.full_name`. */
export function parseDetails(form: FormData, current: ProposalContent): Parsed<DetailsPatch> {
  const fullName = text(form, "fullName");
  if (!fullName) return fail("Client name: enter the client's full name.");
  const title = text(form, "title");
  if (!title) return fail("Title: enter a title.");
  const expires = parseDateInput(text(form, "expiresOn"), "Expiry date");
  if (!expires.ok) return expires;
  const company = optionalText(form, "company");
  return ok({
    clientName: fullName,
    clientEmail: text(form, "clientEmail") || null,
    title,
    expiresOn: expires.value,
    payUrl: text(form, "payUrl") || null,
    content: {
      ...current,
      client: { first_name: text(form, "firstName"), full_name: fullName, ...(company ? { company } : {}) },
    },
  });
}

/** Greeting, recommendation, office action note. */
export function parseMessage(form: FormData, current: ProposalContent): Parsed<ProposalContent> {
  const next: ProposalContent = { ...current, greeting: text(form, "greeting") };
  const recommendation = optionalText(form, "recommendation");
  const note = optionalText(form, "officeActionNote");
  if (recommendation) next.recommendation = recommendation;
  else delete next.recommendation;
  if (note) next.office_action_note = note;
  else delete next.office_action_note;
  return ok(next);
}

/** Package name and the six prices. */
export function parsePricing(form: FormData): Parsed<ProposalPricing> {
  const base = parseMoney(text(form, "base"), "Base price");
  if (!base.ok) return base;
  const perClass = parseMoney(text(form, "perClass"), "Price per class");
  if (!perClass.ok) return perClass;
  const gov = parseMoney(text(form, "govPerClass"), "USPTO fee per class");
  if (!gov.ok) return gov;
  const included = parseCount(text(form, "includedClasses"), "Classes included");
  if (!included.ok) return included;
  const pct = parsePercent(text(form, "secondMarkPct"), "Second-mark discount");
  if (!pct.ok) return pct;
  const pkg = text(form, "package");
  if (!pkg) return fail("Package name: enter a name like Concierge.");
  return ok({
    package: pkg,
    base_cents: base.value,
    included_classes: included.value,
    per_class_cents: perClass.value,
    second_mark_discount_pct: pct.value,
    gov_per_class_cents: gov.value,
  });
}

/** One brand name with its marks and classes, from `mark.<n>.*` and `class.<n>.*` rows. */
export function parseName(form: FormData, existing: ProposalContent, rand: () => string): Parsed<ProposalName> {
  const id = text(form, "nameId");
  const name = text(form, "name");
  if (!id) return fail("Missing brand name.");
  if (!name) return fail("Brand name: enter the name being protected.");

  const baseRaw = text(form, "overrideBase");
  const perRaw = text(form, "overridePerClass");
  const base = parseOptionalMoney(baseRaw, "This brand's base price");
  if (!base.ok) return base;
  const per = parseOptionalMoney(perRaw, "This brand's price per class");
  if (!per.ok) return per;

  // Ids already used by OTHER brand names: this form's own rows may keep theirs.
  const taken = new Set<string>();
  for (const nm of existing.names) {
    taken.add(nm.id);
    if (nm.id === id) continue;
    for (const m of nm.marks) taken.add(m.id);
    for (const c of nm.classes) taken.add(c.id);
  }

  const marks: ProposalMark[] = [];
  for (const row of collectRows(form, "mark", ["id", "kind", "desc", "preselected"])) {
    const kind = isMarkKind(row.kind) ? row.kind : null;
    if (!kind) return fail("Each mark must be a Word mark or a Logo mark.");
    marks.push({
      id: cleanId(row.id, "m", taken, rand),
      kind,
      desc: row.desc,
      preselected: row.preselected === "on",
    });
  }
  const classes: ProposalClass[] = collectRows(form, "class", ["id", "label", "preselected"]).map((row) => ({
    id: cleanId(row.id, "c", taken, rand),
    label: row.label,
    preselected: row.preselected === "on",
  }));

  const what = optionalText(form, "what");
  const note = optionalText(form, "note");
  const override: NonNullable<ProposalName["price_override"]> = {};
  if (base.value !== undefined) override.base_cents = base.value;
  if (per.value !== undefined) override.per_class_cents = per.value;

  return ok({
    id,
    name,
    ...(what ? { what } : {}),
    ...(note ? { note } : {}),
    ...(Object.keys(override).length > 0 ? { price_override: override } : {}),
    marks,
    classes,
  });
}

/** Replace the brand name with `name.id`; refuses if it has been removed in the meantime. */
export function replaceName(content: ProposalContent, name: ProposalName): Parsed<ProposalContent> {
  if (!content.names.some((n) => n.id === name.id)) {
    return fail("That brand name was removed in the meantime. Refresh the page.");
  }
  return ok({ ...content, names: content.names.map((n) => (n.id === name.id ? name : n)) });
}

export function removeName(content: ProposalContent, nameId: string): Parsed<ProposalContent> {
  if (!content.names.some((n) => n.id === nameId)) return fail("That brand name was already removed.");
  return ok({ ...content, names: content.names.filter((n) => n.id !== nameId) });
}

/**
 * A new brand name with a word mark and a logo mark, both ticked, and NO class
 * yet — so the proposal cannot be approved until someone describes what the
 * brand is used for, and no placeholder wording can reach a client.
 */
export function newBrandName(name: string, taken: Set<string>, rand: () => string): ProposalName {
  const id = cleanId("", "n", taken, rand);
  return {
    id,
    name,
    marks: [
      { id: cleanId("", "m", taken, rand), kind: "word", desc: MARK_KIND_DEFAULT_DESC.word, preselected: true },
      { id: cleanId("", "m", taken, rand), kind: "logo", desc: MARK_KIND_DEFAULT_DESC.logo, preselected: true },
    ],
    classes: [],
  };
}

/** Every id (names, marks, classes) already in the document. */
export function takenIds(content: ProposalContent): Set<string> {
  const taken = new Set<string>();
  for (const nm of content.names ?? []) {
    taken.add(nm.id);
    for (const m of nm.marks ?? []) taken.add(m.id);
    for (const c of nm.classes ?? []) taken.add(c.id);
  }
  for (const a of content.adjustments ?? []) taken.add(a.id);
  return taken;
}

/**
 * Adjustments: `adj.<n>.{id,label,kind,value}`. An amount is typed in dollars
 * and stored as cents; a percent is stored as the number itself.
 */
export function parseAdjustments(form: FormData, rand: () => string): Parsed<ProposalAdjustment[]> {
  const taken = new Set<string>();
  const out: ProposalAdjustment[] = [];
  const rows = collectRows(form, "adj", ["id", "label", "kind", "value"]);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const where = `Adjustment ${i + 1}`;
    if (row.kind !== "amount" && row.kind !== "percent") return fail(`${where}: choose a dollar amount or a percent.`);
    const value = row.kind === "amount" ? parseMoney(row.value, `${where} amount`) : parsePercent(row.value, `${where} percent`);
    if (!value.ok) return value;
    out.push({ id: cleanId(row.id, "a", taken, rand), label: row.label, kind: row.kind, value: value.value });
  }
  return ok(out);
}

/** The "What your package includes" table: `inc.<n>.{label,value,included,note,highlight}`. */
export function parseIncludes(form: FormData): Parsed<ProposalInclude[]> {
  const out: ProposalInclude[] = [];
  for (const row of collectRows(form, "inc", ["label", "value", "included", "note", "highlight"])) {
    // A row nobody typed in (the blank one "Add row" makes) is dropped, not an error.
    if (!row.label && !row.value && !row.included && !row.note) continue;
    out.push({
      label: row.label,
      ...(row.value ? { value: row.value } : {}),
      included: row.included,
      ...(row.note ? { note: row.note } : {}),
      ...(row.highlight === "on" ? { highlight: true } : {}),
    });
  }
  return ok(out);
}

/* ─────────────────────────── a new proposal ─────────────────────────────── */

export type StandardPricing = {
  pricing: ProposalPricing;
  includes: ProposalInclude[];
  office_action_note: string;
};

export function defaultGreeting(firstName: string): string {
  const hello = firstName.trim() ? `Hi ${firstName.trim()}, thank` : "Thank";
  return `${hello} you again for meeting with us for your strategy call. Your proposal is outlined below for your review and acceptance.`;
}

/**
 * The document a new proposal starts as: the firm's standard prices and
 * includes (`standardProposalPricing`), the client's names, and — if one was
 * typed — a brand name. Deep-copies the standard so editing one proposal never
 * touches the settings object.
 */
export function buildNewContent(input: {
  firstName: string;
  fullName: string;
  company?: string;
  brandName?: string;
  standard: StandardPricing;
  rand: () => string;
}): ProposalContent {
  const company = input.company?.trim();
  const brand = input.brandName?.trim();
  return {
    client: { first_name: input.firstName.trim(), full_name: input.fullName.trim(), ...(company ? { company } : {}) },
    greeting: defaultGreeting(input.firstName),
    pricing: { ...input.standard.pricing },
    names: brand ? [newBrandName(brand, new Set<string>(), input.rand)] : [],
    adjustments: [],
    includes: input.standard.includes.map((r) => ({ ...r })),
    office_action_note: input.standard.office_action_note,
  };
}

/* ─────────────────────────── settings ───────────────────────────────────── */

/**
 * The firm's standard prices, from the settings form, merged over what is
 * already stored (so a key this form does not know about survives a save).
 */
export function parseSettingsPricing(form: FormData, existing: Record<string, unknown>): Parsed<ProposalSettingPricing & Record<string, unknown>> {
  const pricing = parsePricing(form);
  if (!pricing.ok) return pricing;
  const includes = parseIncludes(form);
  if (!includes.ok) return includes;
  const note = optionalText(form, "officeActionNote");
  const next: Record<string, unknown> = { ...existing, ...pricing.value, includes: includes.value };
  if (note) next.office_action_note = note;
  else delete next.office_action_note;
  return ok(next as ProposalSettingPricing & Record<string, unknown>);
}

/** Cents as the text a money input is pre-filled with ("4950.00"); blank for none. */
export function moneyInput(cents: number | undefined | null): string {
  return typeof cents === "number" && Number.isFinite(cents) ? centsToInput(cents) : "";
}
