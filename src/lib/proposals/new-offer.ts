/**
 * Sprint 3: the firm's "New proposals offer": what a new proposal starts with, from every way of starting one.
 *
 * Stored under ONE key inside the existing settings pricing jsonb (`pricing.new_offer`), so no migration. It holds
 * package NAMES only, never a number: the prices always come from the firm's package list. Pure (no database).
 *
 *   { mode: "one" | "choice", per: "brand" | "mark", options: string[] (1..3), start: string }
 *
 * `one` offers a single package (`options` is just `[start]`); `choice` lets the client pick among up to three
 * named packages, starting on `start`, per brand name or per mark. No key at all = one package, the firm's first.
 */

import { normalisePackages } from "./package-list";
import { NEW_OFFER_WORDS } from "@/lib/proposal-editor/vocabulary";

export const NEW_OFFER_KEY = "new_offer";
export const MAX_NEW_OFFER_OPTIONS = 3;
/** The settings jsonb's own cap (lectual 0089). */
export const MAX_SETTINGS_PRICING_BYTES = 64 * 1024;

export type NewOffer = {
  mode: "one" | "choice";
  per: "brand" | "mark";
  options: string[];
  start: string;
};

export const NEW_OFFER_TOO_LARGE = NEW_OFFER_WORDS.tooLarge;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function firmNamesOf(pricing: unknown): string[] {
  return normalisePackages(pricing).map((p) => p.package);
}

/**
 * The stored value as a usable offer: unknown package names are dropped, at most three options are kept, and a
 * start that is not among them becomes the first. Nothing usable = null (the firm's first package).
 */
export function parseNewOffer(raw: unknown, firmNames: readonly string[]): NewOffer | null {
  if (!isObj(raw)) return null;
  const mode = raw.mode === "choice" ? "choice" : raw.mode === "one" ? "one" : null;
  if (!mode) return null;
  const per = raw.per === "mark" ? "mark" : "brand";
  const known = new Set(firmNames);
  const seen = new Set<string>();
  const options: string[] = [];
  for (const o of Array.isArray(raw.options) ? raw.options : []) {
    if (typeof o !== "string" || !known.has(o) || seen.has(o)) continue;
    seen.add(o);
    options.push(o);
    if (options.length === MAX_NEW_OFFER_OPTIONS) break;
  }
  if (options.length === 0) return null;
  const start = typeof raw.start === "string" && options.includes(raw.start) ? raw.start : options[0];
  if (mode === "one") return { mode, per, options: [start], start };
  return { mode, per, options, start };
}

/** The firm's setting, read from its settings pricing against its CURRENT package list. */
export function readNewOffer(settingPricing: unknown): NewOffer | null {
  return parseNewOffer(isObj(settingPricing) ? settingPricing[NEW_OFFER_KEY] : undefined, firmNamesOf(settingPricing));
}

/** The marker the settings form posts, so a post from an older caller leaves the key alone. */
export const NEW_OFFER_MARKER = "newOffer.present";

/**
 * The settings form's fields: `newOffer.mode` (default | one | choice), `newOffer.per`, `newOffer.option` (one per
 * ticked package), `newOffer.start`. `undefined` = the form did not carry the control (leave the key alone);
 * `null` = clear the setting. A package not on `firmNames` is refused, never silently kept.
 */
export function parseNewOfferForm(form: FormData, firmNames: readonly string[]): Parsed<NewOffer | null | undefined> {
  if (form.get(NEW_OFFER_MARKER) !== "1") return { ok: true, value: undefined };
  const mode = form.get("newOffer.mode");
  if (mode === "default" || mode === null) return { ok: true, value: null };
  if (mode !== "one" && mode !== "choice") return { ok: false, error: "Pick how new proposals offer packages." };
  const per = form.get("newOffer.per") === "mark" ? "mark" : "brand";
  const options = [...new Set(form.getAll("newOffer.option").filter((v): v is string => typeof v === "string"))];
  const startRaw = form.get("newOffer.start");
  const start = typeof startRaw === "string" ? startRaw : "";
  if (mode === "one") {
    const name = start || options[0] || "";
    if (!name) return { ok: false, error: NEW_OFFER_WORDS.needsOne };
    if (!firmNames.includes(name)) return { ok: false, error: "That package isn't one of your firm's packages. Pick one from the list." };
    return { ok: true, value: { mode, per, options: [name], start: name } };
  }
  if (options.length === 0) return { ok: false, error: NEW_OFFER_WORDS.needsOne };
  if (options.length > MAX_NEW_OFFER_OPTIONS) return { ok: false, error: NEW_OFFER_WORDS.tooMany };
  if (options.some((o) => !firmNames.includes(o))) return { ok: false, error: "That package isn't one of your firm's packages. Pick one from the list." };
  const chosenStart = options.includes(start) ? start : options[0];
  return { ok: true, value: { mode, per, options, start: chosenStart } };
}

/**
 * `pricing` with the offer set (or removed for `null`). Every other key is carried as it was, by reference-free copy.
 * Refuses, writing nothing, when the serialised jsonb would pass 64 KB.
 */
export function withNewOffer(pricing: Record<string, unknown>, offer: NewOffer | null): Parsed<Record<string, unknown>> {
  const next: Record<string, unknown> = { ...pricing };
  if (offer) next[NEW_OFFER_KEY] = { mode: offer.mode, per: offer.per, options: [...offer.options], start: offer.start };
  else delete next[NEW_OFFER_KEY];
  if (new TextEncoder().encode(JSON.stringify(next)).length > MAX_SETTINGS_PRICING_BYTES) return { ok: false, error: NEW_OFFER_TOO_LARGE };
  return { ok: true, value: next };
}
