/**
 * Pure referral-source classification (blueprint §4.2). Buckets a free-text
 * "Source" cell (sheet import or Lawmatics `referral_source`/`source`/
 * `lead_source`/`referred_by`) into one of REFERRAL_SOURCES, keeping the
 * verbatim text as `detail` for the tooltip/search. No getScopedClient, no
 * server-only imports — see scope.ts's header for why that matters here.
 */

export const REFERRAL_SOURCES = [
  "UGW",
  "Melanin Money",
  "Flourish Media",
  "Instagram",
  "Referral",
  "Event",
  "Inbound",
] as const;

export type ReferralSource = (typeof REFERRAL_SOURCES)[number];

export type ReferralClassification = {
  source: ReferralSource;
  detail: string | null;
  recognized: boolean;
};

// Order matters: UGW's own patterns ("Urban Golf Weekend", "Event (UGW ...)")
// must be checked before the generic "Event (...)" pattern below, since an
// unqualified substring match on "event" would otherwise swallow "Event (UGW
// 2026)" into the Event bucket.
const UGW_PATTERNS = [/^ugw$/i, /urban golf weekend/i, /\bugw\b/i];

const EXACT_BUCKETS: Array<{ source: ReferralSource; test: (norm: string) => boolean }> = [
  { source: "Melanin Money", test: (n) => n === "melanin money" },
  { source: "Flourish Media", test: (n) => n === "flourish media" },
  { source: "Instagram", test: (n) => n === "instagram" },
];

// Referral: "Referral (Dean)", "Referral(Rayn)" (no space), "Friend/PDM".
const REFERRAL_PATTERNS = [/^referral\b/i, /^friend\/pdm$/i];

// Event: "Event (Render ATL)", named-person/mastermind mentions, "HerKind".
// These are content-specific (real names from the sheet) rather than a clean
// rule, per §4.2's table — kept as an explicit allowlist rather than a broad
// heuristic that might swallow unrelated free text into Event.
const EVENT_PATTERNS = [
  /^event\b/i,
  /marcus hobson/i,
  /milk\s*&\s*cookies music festival/i,
  /andy henriquez'?s mastermind/i,
  /^herkind$/i,
];

/** Collapses whitespace and trims, for matching only — `detail` keeps the original text. */
function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

export function classifyReferralSource(raw: string | null | undefined): ReferralClassification {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") {
    // Blank is Inbound, not "unknown" — Rebecca's rule: the absence of a
    // source *is* the source ("they reached out to us").
    return { source: "Inbound", detail: null, recognized: true };
  }

  const norm = normalize(trimmed);

  if (UGW_PATTERNS.some((re) => re.test(norm))) {
    return { source: "UGW", detail: trimmed, recognized: true };
  }
  for (const bucket of EXACT_BUCKETS) {
    if (bucket.test(norm)) return { source: bucket.source, detail: trimmed, recognized: true };
  }
  if (REFERRAL_PATTERNS.some((re) => re.test(norm))) {
    return { source: "Referral", detail: trimmed, recognized: true };
  }
  if (EVENT_PATTERNS.some((re) => re.test(norm))) {
    return { source: "Event", detail: trimmed, recognized: true };
  }

  // Unknown non-blank token: Inbound, but flagged so the importer can list it
  // for a human to rename (§4.2).
  return { source: "Inbound", detail: trimmed, recognized: false };
}
