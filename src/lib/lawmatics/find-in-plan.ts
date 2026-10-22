import type { ImportPlan } from "./import-plan";

/**
 * "Find a person in this pull": which bucket of the import plan is a person in, and why. Pure, so the
 * wording is tested and the preview can search on the screen without another trip to Lawmatics.
 *
 * Every person the plan accounts for appears exactly once: create, stage-decision (created in the first open
 * stage, needs a human), contact-only (a Lawmatics contact with no prospect), update, unchanged, unmapped
 * (only a firm with no open stage) or skipped. Matching is case- and accent-insensitive over name, business
 * and email, and a term is trimmed and capped before it is used.
 */

export type PlanBucket = "create" | "stage-decision" | "contact-only" | "update" | "unchanged" | "unmapped" | "skipped";

export const BUCKET_LABEL: Record<PlanBucket, string> = {
  create: "New lead",
  "stage-decision": "New lead, stage needs a decision",
  "contact-only": "New lead from a Lawmatics contact",
  update: "Update to an existing lead",
  unchanged: "Already current",
  unmapped: "Not imported: no stage to file them in",
  skipped: "Skipped",
};

export type PlanPerson = {
  bucket: PlanBucket;
  name: string | null;
  business: string | null;
  email: string | null;
  /** The Lawmatics id (or `contact:<id>`), so two people with one name stay distinguishable. */
  ref: string;
  /** The Lawmatics stage, when the record has one. */
  stage: string | null;
  reason: string;
};

export const SEARCH_TERM_MAX = 80;
export const SEARCH_RESULT_MAX = 20;

const joined = (a: string | null | undefined, b: string | null | undefined) => [a, b].filter(Boolean).join(" ").trim() || null;

/** Everyone the plan accounts for, one entry each. */
export function planPeople(plan: ImportPlan): PlanPerson[] {
  const out: PlanPerson[] = [];
  for (const c of plan.creates) {
    const decision = c.stageDecision;
    out.push({
      bucket: decision ? "stage-decision" : "create",
      name: joined(c.fields.first_name, c.fields.last_name) ?? c.matterName,
      business: c.fields.business_name,
      email: c.fields.email,
      ref: c.lawmaticsId,
      stage: c.sourceStageName,
      reason: decision ? `${decision.label}. Filed in ${c.stageName} for you to place.` : `Will be created as a new lead in ${c.stageName}.`,
    });
  }
  for (const c of plan.contactCreates) {
    out.push({
      bucket: "contact-only",
      name: joined(c.fields.first_name, c.fields.last_name),
      business: c.fields.business_name,
      email: c.fields.email,
      ref: `contact:${c.contactId}`,
      stage: null,
      reason: `A Lawmatics contact with no prospect. Will be created as a lead in ${c.stageName}, source "Lawmatics contact".`,
    });
  }
  for (const u of plan.updates) {
    const n = u.changes.length;
    out.push({
      bucket: "update",
      name: u.name ?? u.matterName,
      business: u.business ?? null,
      email: u.email ?? null,
      ref: u.lawmaticsId,
      stage: u.sourceStageName,
      reason: `Already a lead here. ${u.linksRecord ? "Will be linked to this Lawmatics record. " : ""}${n} ${n === 1 ? "field" : "fields"} will change.`.trim(),
    });
  }
  for (const u of plan.unchanged) {
    out.push({
      bucket: "unchanged",
      name: u.name ?? u.matterName,
      business: u.business ?? null,
      email: u.email ?? null,
      ref: u.lawmaticsId,
      stage: null,
      reason: "Already a lead here and already current. Nothing to write.",
    });
  }
  for (const u of plan.unmapped) {
    out.push({ bucket: "unmapped", name: u.name ?? u.matterName, business: u.business, email: u.email, ref: u.lawmaticsId, stage: u.sourceStageName, reason: u.reason });
  }
  for (const s of plan.skipped) {
    out.push({ bucket: "skipped", name: s.name ?? s.matterName, business: s.business, email: s.email, ref: s.lawmaticsId, stage: null, reason: s.reason });
  }
  return out;
}

/** Trimmed, capped, lower-cased, accents folded. Empty when there is nothing to search for. */
export function foldTerm(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_TERM_MAX)
    .trim();
}

export function searchPeople(people: readonly PlanPerson[], rawTerm: string, limit = SEARCH_RESULT_MAX): PlanPerson[] {
  const term = foldTerm(rawTerm);
  if (!term) return [];
  const words = term.split(" ");
  return people
    .filter((p) => {
      const hay = foldTerm([p.name, p.business, p.email].filter(Boolean).join(" "));
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

export function findInPlan(plan: ImportPlan, rawTerm: string, limit = SEARCH_RESULT_MAX): PlanPerson[] {
  return searchPeople(planPeople(plan), rawTerm, limit);
}

/** What a search with no match says: not in this pull, and what could have left them out. */
export function notInPullMessage(ctx: { truncated: boolean; practiceAreaFilterOn: boolean; includeDropped: boolean }): string {
  const causes = [
    "the pull was cut short (only part of Lawmatics was read)" + (ctx.truncated ? " — and it was, this time" : ""),
    "the practice-area filter is on" + (ctx.practiceAreaFilterOn ? " — and it is" : ""),
    "the person has no email address and no prospect in Lawmatics",
  ];
  if (ctx.includeDropped) causes.unshift("Lawmatics didn't return related records this time");
  return `Not in this pull. Possible causes: ${causes.join("; ")}.`;
}
