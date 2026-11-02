/**
 * Hired-matter sync: the decision engine. PURE, no I/O.
 *
 * Given the hired Lawmatics records of ONE firm and that firm's own matters, leads and matter
 * stages, it decides which matters to create, which unlinked matters to link, and which records to
 * leave alone (each with a reason). ./hired-sync.ts does the reading and writing.
 *
 * This is a separate create path from ./matters-import-plan.ts, which stays update-only.
 *
 * The rules, in order, for a record that is hired AND dated on/after HIRED_SYNC_CUTOFF:
 *   1. Its Lawmatics id is already on a matter                      -> skip, already in Lectual.
 *   2. No usable title and the owner already has any matter         -> skip, needs a look.
 *   3. Owner AND title match matters with no Lawmatics id:
 *      exactly one -> link; several -> skip, ambiguous.
 *   4. Owner AND title match a matter linked to a DIFFERENT id      -> skip, never create.
 *   5. Otherwise                                                    -> create.
 * Same owner with a different title is a NEW matter (one client often has several marks).
 */

/** Hired before this date came from the spreadsheet or were reconciled by hand. */
export const HIRED_SYNC_CUTOFF = "2026-10-28";
export const MAX_CREATES_PER_RUN = 50;
export const TM_HIRED_STAGE_LABEL = "Signed LOE / Deposit Received";

export type MatterType = "TM" | "CR" | "PATENT" | "LIT" | "BL";

/** A sanitized hired-candidate Lawmatics record. Null means "Lawmatics didn't give us this". */
export type HiredProspect = {
  lawmaticsId: string;
  name: string | null;
  email: string | null;
  status: string | null;
  /** YYYY-MM-DD. */
  convertedDate: string | null;
  caseNumber: string | null;
  caseTitle: string | null;
  /** Custom field "Name of Trademark". */
  trademarkName: string | null;
  /** Custom field "Practice Area". */
  practiceAreaField: string | null;
  /** Resolved name of the practice_area relationship. */
  practiceAreaName: string | null;
};

export type PlanMatter = {
  id: string;
  owner_name: string | null;
  title: string | null;
  mark_text: string | null;
  matter_number: string;
  lawmatics_id: string | null;
};
export type PlanLead = { id: string; email: string | null; lawmatics_id: string | null };
export type PlanStage = { id: string; label: string };

export type PlannedHiredCreate = {
  lawmaticsId: string;
  type: MatterType;
  title: string;
  mark_text: string | null;
  owner_name: string;
  matter_number: string;
  stage_id: string | null;
  lead_id: string | null;
  notes: string;
  hiredDate: string;
};
export type PlannedHiredLink = { lawmaticsId: string; matterId: string };
export type SkippedHired = { lawmaticsId: string; reason: string };

export type HiredSyncPlan = {
  create: PlannedHiredCreate[];
  link: PlannedHiredLink[];
  skipped: SkippedHired[];
};

export const SKIP = {
  linked: "already in Lectual",
  anotherRecord: "already in Lectual under another Lawmatics record",
  ambiguous: "more than one matter here could be this one",
  needsLook: "needs a look: no mark name, and this client already has a matter here",
  noDate: "no hired date in Lawmatics",
  noName: "no client name in Lawmatics",
  overLimit: "over the per-run limit",
} as const;

// ── Normalising ──────────────────────────────────────────────────────────────

const MARK_KIND = /\(\s*(?:word|design|logo|standard character|stylized)\s*mark\s*\)/g;
const MARK_PREFIX = /^\s*(?:word|design|logo)\s+mark\s*[-–—:]\s*/;

function squash(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’.]/g, "") // "O'Brien" -> "obrien", "E.N.G" -> "eng"
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Owner: lowercase, parentheticals dropped, punctuation stripped, spaces collapsed. */
export function normalizeOwner(raw: string | null | undefined): string {
  if (!raw) return "";
  return squash(raw.replace(/\([^)]*\)/g, " "));
}

/** Title or mark: "(word mark)" / "word mark -" decoration removed, then punctuation and spacing. */
export function normalizeTitle(raw: string | null | undefined): string {
  if (!raw) return "";
  return squash(raw.toLowerCase().replace(MARK_KIND, " ").replace(MARK_PREFIX, ""));
}

const MIN_CONTAIN = 3;

function contains(a: string, b: string): boolean {
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < MIN_CONTAIN) return false;
  return long.includes(short);
}

/** First and last tokens equal, or one name contains the other. */
export function ownersMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.split(" ");
  const tb = b.split(" ");
  if (ta.length >= 2 && tb.length >= 2 && ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1]) return true;
  return contains(a, b);
}

export function titlesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || contains(a, b);
}

function slug(s: string, max = 40): string {
  return squash(s).replace(/ /g, "-").slice(0, max).replace(/-+$/, "");
}

// ── Fields ───────────────────────────────────────────────────────────────────

export function matterTypeFor(p: Pick<HiredProspect, "practiceAreaName" | "practiceAreaField" | "trademarkName">): MatterType {
  const area = (p.practiceAreaName ?? "").trim().toLowerCase();
  if (area) {
    if (area.startsWith("trademark")) return "TM";
    if (area.startsWith("copyright")) return "CR";
    if (area.startsWith("patent")) return "PATENT";
    if (area.startsWith("litigation")) return "LIT";
    return "BL"; // Contracts, General Counsel Services, Business Law, Other, anything else
  }
  if (/trademark/i.test(p.practiceAreaField ?? "") || p.trademarkName) return "TM";
  return "BL";
}

function titleSource(p: HiredProspect): string | null {
  return p.caseTitle ?? p.trademarkName;
}

function cap(s: string, n: number): string {
  return s.trim().slice(0, n).trim();
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export type PlanInput = {
  prospects: HiredProspect[];
  matters: PlanMatter[];
  leads: PlanLead[];
  stages: PlanStage[];
  /** Overridable for tests; defaults to HIRED_SYNC_CUTOFF. */
  cutoff?: string;
};

export function planHiredSync(input: PlanInput): HiredSyncPlan {
  const cutoff = input.cutoff ?? HIRED_SYNC_CUTOFF;
  const create: PlannedHiredCreate[] = [];
  const link: PlannedHiredLink[] = [];
  const skipped: SkippedHired[] = [];

  const byLawmaticsId = new Set(input.matters.map((m) => m.lawmatics_id).filter((x): x is string => !!x));
  const numbers = new Set(input.matters.map((m) => m.matter_number));
  const claimedMatters = new Set<string>();
  const seenProspects = new Set<string>();

  const existing = input.matters.map((m) => ({
    m,
    owner: normalizeOwner(m.owner_name),
    titles: [normalizeTitle(m.title), normalizeTitle(m.mark_text)].filter(Boolean),
  }));
  const stage = input.stages.find((s) => s.label === TM_HIRED_STAGE_LABEL) ?? null;
  const stageId = stage?.id ?? null;

  const leadFor = (p: HiredProspect): string | null => {
    const byId = input.leads.filter((l) => l.lawmatics_id && l.lawmatics_id === p.lawmaticsId);
    if (byId.length === 1) return byId[0].id;
    if (byId.length > 1) return null;
    const email = p.email?.trim().toLowerCase();
    if (!email) return null;
    const byEmail = input.leads.filter((l) => l.email?.trim().toLowerCase() === email);
    return byEmail.length === 1 ? byEmail[0].id : null;
  };

  const candidates = input.prospects
    .filter((p) => (p.status ?? "").trim().toLowerCase() === "hired")
    .filter((p) => {
      if (seenProspects.has(p.lawmaticsId)) return false;
      seenProspects.add(p.lawmaticsId);
      return true;
    });

  for (const p of candidates) {
    if (!p.convertedDate) {
      skipped.push({ lawmaticsId: p.lawmaticsId, reason: SKIP.noDate });
      continue;
    }
    if (p.convertedDate < cutoff) continue; // older: came from the sheet or was done by hand
    if (byLawmaticsId.has(p.lawmaticsId)) {
      skipped.push({ lawmaticsId: p.lawmaticsId, reason: SKIP.linked });
      continue;
    }
    const ownerName = p.name ? cap(p.name, 200) : "";
    if (!ownerName) {
      skipped.push({ lawmaticsId: p.lawmaticsId, reason: SKIP.noName });
      continue;
    }
    const owner = normalizeOwner(ownerName);
    const src = titleSource(p);
    const ownerMatters = existing.filter((e) => ownersMatch(owner, e.owner));

    if (!src || !normalizeTitle(src)) {
      if (ownerMatters.length > 0) {
        skipped.push({ lawmaticsId: p.lawmaticsId, reason: SKIP.needsLook });
        continue;
      }
    } else {
      const want = normalizeTitle(src);
      const hits = ownerMatters.filter((e) => e.titles.some((t) => titlesMatch(want, t)));
      const free = hits.filter((e) => e.m.lawmatics_id === null && !claimedMatters.has(e.m.id));
      if (free.length === 1) {
        claimedMatters.add(free[0].m.id);
        link.push({ lawmaticsId: p.lawmaticsId, matterId: free[0].m.id });
        continue;
      }
      if (free.length > 1) {
        skipped.push({ lawmaticsId: p.lawmaticsId, reason: SKIP.ambiguous });
        continue;
      }
      if (hits.length > 0) {
        // Linked to a different Lawmatics record (or already claimed this run): never create.
        skipped.push({ lawmaticsId: p.lawmaticsId, reason: SKIP.anotherRecord });
        continue;
      }
    }

    // Create.
    if (create.length >= MAX_CREATES_PER_RUN) {
      skipped.push({ lawmaticsId: p.lawmaticsId, reason: SKIP.overLimit });
      continue;
    }
    const type = matterTypeFor(p);
    const rawTitle = src ?? p.practiceAreaName ?? `Lawmatics matter #${p.caseNumber ?? p.lawmaticsId}`;
    const title = cap(rawTitle, 200);
    let number = `${type}-${slug(ownerName)}-${slug(title)}`;
    if (numbers.has(number)) number = `${number}-${p.caseNumber ?? p.lawmaticsId}`;
    if (numbers.has(number)) number = `${number}-${p.lawmaticsId}`;
    numbers.add(number);
    create.push({
      lawmaticsId: p.lawmaticsId,
      type,
      title,
      mark_text: type === "TM" && src ? cap(src, 512) : null,
      owner_name: ownerName,
      matter_number: number,
      stage_id: type === "TM" ? stageId : null,
      lead_id: leadFor(p),
      notes: `Added from Lawmatics (case #${p.caseNumber ?? p.lawmaticsId}, hired ${p.convertedDate}).`,
      hiredDate: p.convertedDate,
    });
  }
  return { create, link, skipped };
}
