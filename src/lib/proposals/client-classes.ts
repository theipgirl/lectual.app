/**
 * Classes the CLIENT describes on `/p/<token>` (Spec 3, 2026-10-28; replaces Sprint 28's free "Add a class"). Pure:
 * no database, safe in a `"use client"` component, the accept path and a plain vitest run.
 *
 * Two things in the content let a client write their own goods and services:
 *  - an OPEN class (`ProposalClass.client_entry: true`): its `label` is the PROMPT the client reads
 *    ("Describe what you sell or offer under this mark"), and they type the description under it;
 *  - `ProposalName.client_add: { max }`: the client may add up to `max` more open classes to that brand name.
 *    With no `client_add` the default is 5, or 0 on a fixed offer (`clientAddMax`).
 * Either is a class like any other: it is priced by `quoteProposal`, through the ONE effective-content builder
 * below, which the page's live total and the accept path both call. There is no second price calculation.
 *
 * ── WHAT THE BROWSER SENDS ──────────────────────────────────────────────────
 *   { entries: { <open class id>: "<text>" }, added: { <brand name id>: [{ text, on }] } }
 * The Sprint 28 shape `{ <brand name id>: string[] }` is still read, as `added`. The server is the authority
 * (`parseClientClassInput`): unknown ids, entries for classes that are not open, and adds past a brand name's
 * `clientAddMax` (0 on a fixed offer, or when the firm set 0) are DROPPED; every text is cleaned
 * (`cleanClientText`). A ticked open or added class with no text is refused by the caller (`missing`).
 *
 * ── THE EFFECTIVE CONTENT ───────────────────────────────────────────────────
 * Open classes carry the client's text as their `label` (the prompt kept in `prompt`, the `client_entry`
 * marker kept); added classes are appended with server-made ids `ca-<nameId>-<n>` and `client_added: true`.
 * That content is what is quoted and what `accepted_snapshot.content` stores, so the receipt, the staff view and
 * the LOE adapter read the client's words from the class labels. The Lawmatics note, the in-app notice and the
 * timeline carry only COUNTS (Sprint 28: what the client typed never leaves the staff pages).
 *
 * Client text is untrusted: React renders it as text, it is never logged, and it reaches no model prompt here.
 */

import { repairSelection } from "./class-lock";
import { isFixedOffer, quoteProposal } from "./pricing";
import type { ProposalClass, ProposalContent, ProposalName, ProposalQuote, Selection } from "./types";

/** The longest description a client may type for one class. */
export const MAX_CLIENT_TEXT_CHARS = 200;
/** The most classes a firm may let a client add to one brand name (`client_add.max`). */
export const MAX_CLIENT_ADD = 10;
/** Firm-listed classes plus the most a client may add, for one brand name. */
export const MAX_CLASSES_TOTAL_PER_BRAND = 10;
/** What an open class asks when staff leave the prompt blank. */
export const DEFAULT_CLIENT_ENTRY_PROMPT = "Describe what you sell or offer under this mark";
/** Shown beside a disabled Accept, and the server's refusal for the same case. */
export const DESCRIBE_BEFORE_ACCEPT = "Describe each selected class before accepting.";

export type ClientAddedEntry = { text: string; on: boolean };

/** What the client wrote: open-class descriptions by class id, and added classes by brand name id. */
export type ClientClassInput = {
  entries: Record<string, string>;
  added: Record<string, ClientAddedEntry[]>;
};

export function emptyClientClassInput(): ClientClassInput {
  return { entries: {}, added: {} };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Added classes a brand name allows when the firm set nothing (`client_add` absent): Sprint 28's limit. */
export const DEFAULT_CLIENT_ADD = 5;

/**
 * The firm's own `client_add.max` for this brand name, clamped to 0..10; `null` when the firm set nothing
 * (absent, or not a whole number), so the default applies.
 */
export function explicitClientAddMax(name: Pick<ProposalName, "client_add"> | null | undefined): number | null {
  const raw = isObj(name?.client_add) ? (name.client_add as Record<string, unknown>).max : undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return Math.min(MAX_CLIENT_ADD, Math.max(0, raw));
}

/**
 * How many classes the client may add to this brand name. An explicit `client_add.max` wins. With none, the
 * default is Sprint 28's 5 for any offer that is NOT fixed, and 0 for a fixed offer (one name, one mark, one class,
 * no open class: "just show the proposal"). `isFixedOffer` reads only the firm's content and ignores an absent
 * `client_add`, so the default never feeds back into it.
 */
export function clientAddMax(content: ProposalContent, name: Pick<ProposalName, "client_add"> | null | undefined): number {
  const explicit = explicitClientAddMax(name);
  if (explicit !== null) return explicit;
  return isFixedOffer(content) ? 0 : DEFAULT_CLIENT_ADD;
}

export function isOpenClass(c: Pick<ProposalClass, "client_entry"> | null | undefined): boolean {
  return c?.client_entry === true;
}

/** True for a class whose label is the client's own words (an open class or one they added). */
export function isClientWordedClass(c: Pick<ProposalClass, "client_entry" | "client_added"> | null | undefined): boolean {
  return c?.client_entry === true || c?.client_added === true;
}

function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/**
 * One description, cleaned: control characters become spaces, `<` and `>` are removed, runs of whitespace
 * collapse to one space, the ends are trimmed, and it is cut to 200 characters. Anything not a string is "".
 */
export function cleanClientText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let out = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "<" || ch === ">") continue;
    out += isControl(code) ? " " : ch;
  }
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > MAX_CLIENT_TEXT_CHARS) {
    // Cut on UTF-16 length (what the input's maxLength counts), never leaving half of a surrogate pair.
    out = out.slice(0, MAX_CLIENT_TEXT_CHARS).replace(/[\uD800-\uDBFF]$/, "").trim();
  }
  return out;
}

/**
 * Whatever the browser posted, reduced to what the stored content allows. Never refuses: what is not allowed is
 * dropped. An added class with no text that is not ticked is dropped too (nothing was asked for). A plain string
 * in an `added` list (the Sprint 28 shape) reads as a ticked class with that text.
 */
export function parseClientClassInput(content: ProposalContent, raw: unknown): ClientClassInput {
  const out = emptyClientClassInput();
  const body = isObj(raw) ? raw : {};
  // The Sprint 28 shape, `{ <brand name id>: string[] }`, posted by a page loaded before Spec 3: read as `added`.
  const legacy = isObj(raw) && !("entries" in body) && !("added" in body);
  const entries = !legacy && isObj(body.entries) ? body.entries : {};
  const added = legacy ? body : isObj(body.added) ? body.added : {};
  for (const nm of Array.isArray(content?.names) ? content.names : []) {
    for (const c of Array.isArray(nm?.classes) ? nm.classes : []) {
      if (isOpenClass(c) && typeof c.id === "string" && Object.prototype.hasOwnProperty.call(entries, c.id)) {
        const text = cleanClientText(entries[c.id]);
        if (text) out.entries[c.id] = text;
      }
    }
    const max = clientAddMax(content, nm);
    const list = typeof nm?.id === "string" && Object.prototype.hasOwnProperty.call(added, nm.id) ? added[nm.id] : undefined;
    if (max === 0 || !Array.isArray(list)) continue;
    const kept: ClientAddedEntry[] = [];
    for (const item of list.slice(0, max)) {
      const entry: ClientAddedEntry =
        typeof item === "string"
          ? { text: cleanClientText(item), on: true }
          : isObj(item)
            ? { text: cleanClientText(item.text), on: item.on === true }
            : { text: "", on: false };
      if (!entry.text && !entry.on) continue;
      kept.push(entry);
    }
    if (kept.length > 0) out.added[nm.id] = kept;
  }
  return out;
}

/** The id of the nth (0-based) added class of a brand name: `ca-<nameId>-<n+1>`, never one the content already uses. */
export function clientAddedClassId(used: ReadonlySet<string>, nameId: string, index: number): string {
  let id = `ca-${nameId}-${index + 1}`;
  while (used.has(id)) id = `${id}x`;
  return id;
}

/**
 * The content the client is quoted on, and the selection that goes with it. Open classes take the client's text as
 * their label (`prompt` keeps the firm's question; no text = an empty label); added classes are appended in order with
 * their ids, ticked as the client left them. The input is used as given: `parseClientClassInput` is where it is checked.
 * Returns copies; the content passed in is never changed.
 */
export function buildEffectiveContent(
  content: ProposalContent,
  selection: Selection,
  input: ClientClassInput,
): { content: ProposalContent; selection: Selection } {
  const nextSelection: Selection = { ...selection };
  const used = new Set<string>();
  for (const nm of Array.isArray(content?.names) ? content.names : []) {
    for (const m of Array.isArray(nm?.marks) ? nm.marks : []) used.add(m.id);
    for (const c of Array.isArray(nm?.classes) ? nm.classes : []) used.add(c.id);
  }
  const names = (Array.isArray(content?.names) ? content.names : []).map((nm) => {
    const classes: ProposalClass[] = (Array.isArray(nm?.classes) ? nm.classes : []).map((c) => {
      if (!isOpenClass(c)) return c;
      const prompt = typeof c.prompt === "string" ? c.prompt : c.label;
      return { ...c, label: input.entries?.[c.id] ?? "", prompt, client_entry: true as const };
    });
    (input.added?.[nm.id] ?? []).forEach((entry, i) => {
      const id = clientAddedClassId(used, nm.id, i);
      used.add(id);
      classes.push({ id, label: entry.text, preselected: entry.on, client_added: true });
      nextSelection[id] = entry.on === true;
    });
    return { ...nm, classes };
  });
  return { content: { ...content, names }, selection: nextSelection };
}

/** Ids of ticked classes that the client must describe and has not (open or added, empty label). */
export function missingClientText(content: ProposalContent, selection: Selection): string[] {
  const out: string[] = [];
  for (const nm of Array.isArray(content?.names) ? content.names : []) {
    for (const c of Array.isArray(nm?.classes) ? nm.classes : []) {
      if (isClientWordedClass(c) && selection?.[c.id] === true && !String(c.label ?? "").trim()) out.push(c.id);
    }
  }
  return out;
}

export type PricedWithClientClasses =
  | { ok: true; content: ProposalContent; selection: Selection; quote: ProposalQuote; missing: string[] }
  /** `repair` was asked for and a ticked mark has no class to fall back on. */
  | { ok: false; nameId: string };

/**
 * THE shared priced-quote helper: the page's live total and the accept path both call this, and it prices only
 * through `quoteProposal` over the effective content. `repair` (the accept path) first ticks the first class of
 * any brand name whose mark is ticked with no class; the page leaves it off and warns instead. `missing` lists the
 * ticked classes still waiting for the client's words.
 */
export function quoteWithClientClasses(
  content: ProposalContent,
  selection: Selection,
  input: ClientClassInput,
  options: { repair?: boolean } = {},
): PricedWithClientClasses {
  const effective = buildEffectiveContent(content, selection, input);
  let picked = effective.selection;
  if (options.repair) {
    const fixed = repairSelection(effective.content, picked);
    if (!fixed.ok) return fixed;
    picked = fixed.selection;
  }
  return {
    ok: true,
    content: effective.content,
    selection: picked,
    quote: quoteProposal(effective.content, picked),
    missing: missingClientText(effective.content, picked),
  };
}

/** How many classes the client added, across all brand names (what notes and notices count); with a selection, only the ticked ones. */
export function addedClassCount(content: ProposalContent, selection?: Selection | null): number {
  return (content?.names ?? []).reduce(
    (sum, nm) => sum + (nm.classes ?? []).filter((c) => c.client_added === true && (selection == null || selection[c.id] === true)).length,
    0,
  );
}
