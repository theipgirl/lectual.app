/**
 * The shape of a firm's public intake — `crm_intake_form.config` (lectual
 * 0079) — and the one place that decides what a prospect may see of it.
 *
 * Pure: no DB, no `server-only`. The setup page's client editor, the server
 * action that saves it, and the public `/i/<slug>` page all import this, so
 * the three can never disagree about a length limit or a default.
 *
 * ── PRIVATE vs PUBLIC ───────────────────────────────────────────────────────
 * The config holds things a prospect must never see: the assistant's firm
 * notes (`knows`) and the fit criteria a prospect is screened against
 * (`fitIp`, `fitJur`, `fitText`). The design labels each "Only you see this",
 * and 0079's column comment says the public page is served a PUBLIC SUBSET.
 * `publicConfig()` below IS that subset. It is an allowlist, not a delete of
 * the private keys: a key added to the config later stays private until
 * someone adds it here on purpose.
 *
 * ── STORED vs DISPLAYED ─────────────────────────────────────────────────────
 * Blank intro fields (firm name, headline, disclaimer, consent) are stored
 * blank and filled from the defaults when shown ("Leave blank to use the
 * standard wording"), so improving the standard wording reaches every firm
 * that never changed it.
 *
 * ── FEES ARE NOT IN HERE ────────────────────────────────────────────────────
 * Only WHICH of the firm's service-library items are shown is stored
 * (`visiblePackageIds`). Names and prices are read from `crm_service_item` at
 * render time, so a price is always the library's price exactly as written —
 * never a copy that drifted, never an estimate. See `packages.ts`.
 */

export const IP_TYPES = ["Trademark", "Patent", "Copyright", "Trade secret"] as const;
export type IpType = (typeof IP_TYPES)[number];

export const JURS = ["US federal", "State", "EU", "UK", "Canada", "Worldwide (Madrid)"] as const;
export type Jurisdiction = (typeof JURS)[number];

/** Starter questions per IP type (design/Intake_Forms.dc.html, `PACKS`). */
export const PACKS: Record<IpType, readonly string[]> = {
  Trademark: [
    "What name, logo or slogan do you want to protect?",
    "Have you used this name publicly yet?",
    "Which products or services will it cover?",
  ],
  Patent: [
    "Describe the invention in a few sentences.",
    "Has it been shown, sold or published anywhere?",
    "Is anyone else named as an inventor?",
  ],
  Copyright: [
    "What is the work: software, art, writing or music?",
    "Who created it, and were they an employee or contractor?",
  ],
  "Trade secret": ["What information do you need to keep confidential?", "Who has access to it today?"],
};

export const INTAKE_MODES = ["conversation", "form"] as const;
export type IntakeMode = (typeof INTAKE_MODES)[number];

export const INTAKE_THEMES = ["auto", "light", "dark"] as const;
export type IntakeTheme = (typeof INTAKE_THEMES)[number];

/** The contact block, always asked first and never editable (design: "Always asked first"). */
export const CONTACT_FIELDS = [
  { key: "name", label: "Full name", required: true },
  { key: "email", label: "Email", required: true },
  { key: "phone", label: "Phone", required: false },
  { key: "company", label: "Company", required: false },
] as const;

/** Standard wording for the intro fields left blank. No firm names: the
 * design's "RPB Law" default is one firm's name, so the firm-name default is
 * the caller's own firm (see `displayIntro`). */
export const INTRO_DEFAULTS = {
  headline: "Tell us about your IP. We reply within one business day.",
  disclaimer:
    "Submitting this form does not create an attorney–client relationship. Please don't share confidential details until we confirm there is no conflict.",
  consent: "I agree to be contacted about my inquiry by email or phone.",
} as const;

export const DEFAULT_OPENING = "Hi — thanks for stopping by. Tell me a little about what you're building.";
export const DEFAULT_CLOSING =
  "Thanks. An attorney reads every intake. You'll hear from us by email within one business day with next steps, even if we're not the right fit.";

/** Hard limits. The editor's `maxLength`s and the server's validation both read these. */
export const LIMITS = {
  opening: 280,
  knows: 4000,
  firmName: 120,
  headline: 200,
  disclaimer: 1000,
  consent: 500,
  question: 200,
  questions: 40,
  fitText: 2000,
  closing: 600,
  office: 300,
  packages: 100,
  // 0079: crm_intake_form_domains_len.
  domains: 25,
  domain: 253,
} as const;

export type IntakeQuestion = {
  id: string;
  text: string;
  required: boolean;
  /** The pack it came from, until someone edits its text. */
  pack: IpType | null;
  /** Edited questions survive their pack being switched off. */
  edited: boolean;
};

export type IntakeColors = { lightBg: string; lightAcc: string; darkBg: string; darkAcc: string };

export type IntakeFormConfig = {
  version: 1;
  mode: IntakeMode;
  opening: string;
  /** PRIVATE. The assistant's notes about the firm. */
  knows: string;
  firmName: string;
  headline: string;
  disclaimer: string;
  consent: string;
  questions: IntakeQuestion[];
  packs: IpType[];
  feesOn: boolean;
  /** Service-library item ids shown to prospects. New library items start hidden. */
  visiblePackageIds: string[];
  /** PRIVATE. */
  fitIp: IpType[];
  /** PRIVATE. */
  fitJur: Jurisdiction[];
  /** PRIVATE. */
  fitText: string;
  closing: string;
  /** Shown to referred founders only (compliance). */
  office: string;
  theme: IntakeTheme;
  colors: IntakeColors;
  powered: boolean;
};

export const DEFAULT_COLORS: IntakeColors = {
  lightBg: "#FFFDF7",
  lightAcc: "#6A1F2B",
  darkBg: "#1E0A0E",
  darkAcc: "#E0A9B0",
};

let counter = 0;
/** A question id: short, unique within a form, safe in the DOM and in JSON. */
export function newQuestionId(): string {
  counter = (counter + 1) % 1_000_000;
  return `q${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** The design's starting point for a new draft. */
export function defaultIntakeConfig(visiblePackageIds: string[] = []): IntakeFormConfig {
  return {
    version: 1,
    mode: "conversation",
    opening: DEFAULT_OPENING,
    knows: "",
    firmName: "",
    headline: "",
    disclaimer: "",
    consent: "",
    questions: [
      ...PACKS.Trademark.map((text) => ({ id: newQuestionId(), text, required: true, pack: "Trademark" as const, edited: false })),
      { id: newQuestionId(), text: "When do you hope to launch or file?", required: false, pack: null, edited: false },
    ],
    packs: ["Trademark"],
    feesOn: true,
    visiblePackageIds: visiblePackageIds.slice(0, LIMITS.packages),
    fitIp: ["Trademark"],
    fitJur: ["US federal"],
    fitText: "",
    closing: DEFAULT_CLOSING,
    office: "",
    theme: "auto",
    colors: { ...DEFAULT_COLORS },
    powered: true,
  };
}

// ── reading stored JSON (lenient) ────────────────────────────────────────────

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number, fallback = ""): string => (typeof v === "string" ? v.slice(0, max) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;
const subset = <T extends string>(v: unknown, list: readonly T[]): T[] =>
  Array.isArray(v) ? list.filter((x) => v.includes(x)) : [];

const HEX = /^#[0-9a-f]{6}$/i;
const QID = /^[A-Za-z0-9_-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX.test(v);
}

/**
 * Stored JSON → a complete config. Never throws: a key that is missing or the
 * wrong shape takes its default, so a config written by an older version of
 * this app (or `{}` from 0079's column default) still renders. Over-long text
 * is cut, not rejected — rejecting is `validateIntakeConfig`'s job, on save.
 */
export function parseIntakeConfig(raw: unknown): IntakeFormConfig {
  const d = defaultIntakeConfig();
  if (!isRec(raw)) return d;
  const colorsRaw = isRec(raw.colors) ? raw.colors : {};
  const seen = new Set<string>();
  const questions: IntakeQuestion[] = Array.isArray(raw.questions)
    ? raw.questions
        .filter(isRec)
        .map((q) => ({
          id: typeof q.id === "string" && QID.test(q.id) ? q.id : newQuestionId(),
          text: str(q.text, LIMITS.question),
          required: bool(q.required, false),
          pack: oneOf<IpType | "">(q.pack, IP_TYPES, "") || null,
          edited: bool(q.edited, false),
        }))
        .filter((q) => (seen.has(q.id) ? false : (seen.add(q.id), true)))
        .slice(0, LIMITS.questions)
    : d.questions;
  return {
    version: 1,
    mode: oneOf(raw.mode, INTAKE_MODES, d.mode),
    opening: str(raw.opening, LIMITS.opening, d.opening),
    knows: str(raw.knows, LIMITS.knows),
    firmName: str(raw.firmName, LIMITS.firmName),
    headline: str(raw.headline, LIMITS.headline),
    disclaimer: str(raw.disclaimer, LIMITS.disclaimer),
    consent: str(raw.consent, LIMITS.consent),
    questions,
    packs: Array.isArray(raw.packs) ? subset(raw.packs, IP_TYPES) : d.packs,
    feesOn: bool(raw.feesOn, d.feesOn),
    visiblePackageIds: Array.isArray(raw.visiblePackageIds)
      ? [...new Set(raw.visiblePackageIds.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, LIMITS.packages)
      : [],
    fitIp: Array.isArray(raw.fitIp) ? subset(raw.fitIp, IP_TYPES) : d.fitIp,
    fitJur: Array.isArray(raw.fitJur) ? subset(raw.fitJur, JURS) : d.fitJur,
    fitText: str(raw.fitText, LIMITS.fitText),
    closing: str(raw.closing, LIMITS.closing, d.closing),
    office: str(raw.office, LIMITS.office),
    theme: oneOf(raw.theme, INTAKE_THEMES, d.theme),
    colors: {
      lightBg: isHexColor(colorsRaw.lightBg) ? colorsRaw.lightBg : DEFAULT_COLORS.lightBg,
      lightAcc: isHexColor(colorsRaw.lightAcc) ? colorsRaw.lightAcc : DEFAULT_COLORS.lightAcc,
      darkBg: isHexColor(colorsRaw.darkBg) ? colorsRaw.darkBg : DEFAULT_COLORS.darkBg,
      darkAcc: isHexColor(colorsRaw.darkAcc) ? colorsRaw.darkAcc : DEFAULT_COLORS.darkAcc,
    },
    powered: bool(raw.powered, d.powered),
  };
}

// ── validating a save (strict) ───────────────────────────────────────────────

export type ConfigValidation = { ok: true; config: IntakeFormConfig } | { ok: false; errors: string[] };

/**
 * What the server runs on every save. The payload came from a browser, so
 * every field is checked for type AND length; anything wrong is refused with
 * a reason, never silently trimmed (a firm should not find its closing
 * message cut in half on the public page).
 */
export function validateIntakeConfig(raw: unknown): ConfigValidation {
  if (!isRec(raw)) return { ok: false, errors: ["The intake settings were not readable."] };
  const errors: string[] = [];
  const text = (key: keyof typeof LIMITS, label: string) => {
    const v = raw[key];
    if (typeof v !== "string") errors.push(`${label} is missing.`);
    else if (v.length > LIMITS[key]) errors.push(`${label} is longer than ${LIMITS[key].toLocaleString("en-US")} characters.`);
  };
  text("opening", "The opening message");
  text("knows", "What the assistant knows");
  text("firmName", "The firm name");
  text("headline", "The headline");
  text("disclaimer", "The disclaimer");
  text("consent", "The consent notice");
  text("fitText", "The fit criteria");
  text("closing", "The closing message");
  text("office", "The office location");

  if (!(INTAKE_MODES as readonly unknown[]).includes(raw.mode)) errors.push("Choose conversation or form.");
  if (!(INTAKE_THEMES as readonly unknown[]).includes(raw.theme)) errors.push("Choose a theme.");
  for (const k of ["feesOn", "powered"] as const) if (typeof raw[k] !== "boolean") errors.push("A switch was not readable.");

  if (!Array.isArray(raw.questions)) errors.push("The questions were not readable.");
  else {
    if (raw.questions.length > LIMITS.questions) errors.push(`Keep it to ${LIMITS.questions} questions.`);
    const ids = new Set<string>();
    raw.questions.forEach((q, i) => {
      if (!isRec(q) || typeof q.id !== "string" || !QID.test(q.id) || typeof q.text !== "string" || typeof q.required !== "boolean") {
        errors.push(`Question ${i + 1} was not readable.`);
        return;
      }
      if (ids.has(q.id)) errors.push(`Question ${i + 1} is a duplicate.`);
      ids.add(q.id);
      if (q.text.length > LIMITS.question) errors.push(`Question ${i + 1} is longer than ${LIMITS.question} characters.`);
      if (q.pack !== null && q.pack !== undefined && !(IP_TYPES as readonly unknown[]).includes(q.pack)) errors.push(`Question ${i + 1} names an unknown pack.`);
    });
  }
  for (const [k, list] of [["packs", IP_TYPES], ["fitIp", IP_TYPES], ["fitJur", JURS]] as const) {
    const v = raw[k];
    if (!Array.isArray(v) || v.some((x) => !(list as readonly unknown[]).includes(x))) errors.push("A choice list was not readable.");
  }
  const pk = raw.visiblePackageIds;
  if (!Array.isArray(pk) || pk.length > LIMITS.packages || pk.some((x) => typeof x !== "string" || !UUID.test(x))) {
    errors.push("The fee package choices were not readable.");
  }
  const c = raw.colors;
  if (!isRec(c) || !["lightBg", "lightAcc", "darkBg", "darkAcc"].every((k) => isHexColor(c[k]))) {
    errors.push("Colors must be six-digit hex values like #6A1F2B.");
  }

  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  const cleaned = parseIntakeConfig(raw);
  // Blank question rows are editor scratch, not questions.
  cleaned.questions = cleaned.questions.filter((q) => q.text.trim() !== "").map((q) => ({ ...q, text: q.text.trim() }));
  return { ok: true, config: cleaned };
}

// ── allowed domains ──────────────────────────────────────────────────────────

const DOMAIN = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * "https://www.Example.com/contact" → "www.example.com"; "*.example.com"
 * stays a wildcard. Null when what's left isn't a domain (design: "Use a
 * domain like example.com or *.example.com").
 */
export function normalizeDomain(input: string): string | null {
  const v = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
  if (!v || v.length > LIMITS.domain || !DOMAIN.test(v)) return null;
  if (v.split(".").some((label) => label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return null;
  return v;
}

export function validateAllowedDomains(raw: unknown): { ok: true; domains: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "The allowed domains were not readable." };
  if (raw.length > LIMITS.domains) return { ok: false, error: `Allow at most ${LIMITS.domains} domains.` };
  const out: string[] = [];
  for (const d of raw) {
    const n = typeof d === "string" ? normalizeDomain(d) : null;
    if (!n) return { ok: false, error: `"${String(d).slice(0, 80)}" isn't a domain like example.com or *.example.com.` };
    if (!out.includes(n)) out.push(n);
  }
  return { ok: true, domains: out };
}

// ── editor helpers (pure, so they are tested) ────────────────────────────────

/**
 * The design's pack switch. Turning a pack ON appends its questions that
 * aren't already asked. Turning it OFF removes that pack's questions — except
 * ones the firm edited, which stay as the firm's own (pack cleared).
 */
export function togglePack(
  config: IntakeFormConfig,
  pack: IpType,
): { config: IntakeFormConfig; added: string[]; removed: number; kept: number } {
  if (config.packs.includes(pack)) {
    const mine = config.questions.filter((q) => q.pack === pack);
    const kept = mine.filter((q) => q.edited).length;
    return {
      config: {
        ...config,
        packs: config.packs.filter((p) => p !== pack),
        questions: config.questions
          .filter((q) => q.pack !== pack || q.edited)
          .map((q) => (q.pack === pack ? { ...q, pack: null } : q)),
      },
      added: [],
      removed: mine.length - kept,
      kept,
    };
  }
  const have = new Set(config.questions.map((q) => q.text.trim()));
  const room = LIMITS.questions - config.questions.length;
  const add = PACKS[pack]
    .filter((t) => !have.has(t))
    .slice(0, Math.max(0, room))
    .map((text) => ({ id: newQuestionId(), text, required: true, pack, edited: false }));
  return {
    config: { ...config, packs: IP_TYPES.filter((p) => p === pack || config.packs.includes(p)), questions: [...config.questions, ...add] },
    added: add.map((q) => q.id),
    removed: 0,
    kept: 0,
  };
}

/** Swaps question `i` with its neighbour; out of range is a no-op. */
export function moveQuestion(questions: IntakeQuestion[], i: number, delta: -1 | 1): IntakeQuestion[] {
  const j = i + delta;
  if (i < 0 || i >= questions.length || j < 0 || j >= questions.length) return questions;
  const out = questions.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Drag-and-drop: moves question `fromId` to where `toId` sits. */
export function reorderQuestion(questions: IntakeQuestion[], fromId: string, toId: string): IntakeQuestion[] {
  const from = questions.findIndex((q) => q.id === fromId);
  const to = questions.findIndex((q) => q.id === toId);
  if (from < 0 || to < 0 || from === to) return questions;
  const out = questions.slice();
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

// ── what a prospect sees ─────────────────────────────────────────────────────

/** The intro copy as displayed: blanks filled from the standard wording. */
export function displayIntro(config: IntakeFormConfig, orgName: string) {
  return {
    firmName: config.firmName.trim() || orgName,
    headline: config.headline.trim() || INTRO_DEFAULTS.headline,
    disclaimer: config.disclaimer.trim() || INTRO_DEFAULTS.disclaimer,
    consent: config.consent.trim() || INTRO_DEFAULTS.consent,
  };
}

/**
 * Florida Bar rule 4-7.22 disclosure, shown to every founder Lectual refers.
 * Wording from the design; the firm cannot edit it.
 */
export function referralDisclosure(firmName: string): string {
  return `You were referred to ${firmName} through Lectual, a lawyer referral service. ${firmName} pays Lectual a fee to take part. Lectual is not a law firm, has not reviewed your matter, and does not vouch for any lawyer's skill.`;
}

export type PublicIntakeConfig = {
  mode: IntakeMode;
  opening: string;
  firmName: string;
  headline: string;
  disclaimer: string;
  consent: string;
  contactFields: typeof CONTACT_FIELDS;
  questions: { id: string; text: string; required: boolean }[];
  feesOn: boolean;
  closing: string;
  theme: IntakeTheme;
  colors: IntakeColors;
  powered: boolean;
  /** Present only when the firm receives Lectual referrals. */
  referral: { office: string; disclosure: string } | null;
};

/**
 * EVERYTHING the public page may send to a browser, and nothing else.
 *
 * Excluded on purpose: `knows` (the firm's private notes), `fitIp`, `fitJur`,
 * `fitText` (a prospect must not see what they're screened against), `packs`
 * and each question's `pack`/`edited` (editor bookkeeping), and
 * `visiblePackageIds` (the public page resolves those server-side through
 * `packages.ts`, so library ids never reach a browser either).
 */
export function publicConfig(
  config: IntakeFormConfig,
  ctx: { orgName: string; receivesReferrals: boolean },
): PublicIntakeConfig {
  const intro = displayIntro(config, ctx.orgName);
  return {
    mode: config.mode,
    opening: config.opening.trim() || DEFAULT_OPENING,
    ...intro,
    contactFields: CONTACT_FIELDS,
    questions: config.questions
      .filter((q) => q.text.trim())
      .map((q) => ({ id: q.id, text: q.text.trim(), required: q.required })),
    feesOn: config.feesOn,
    closing: config.closing.trim() || DEFAULT_CLOSING,
    theme: config.theme,
    colors: { ...config.colors },
    powered: config.powered,
    referral: ctx.receivesReferrals
      ? { office: config.office.trim(), disclosure: referralDisclosure(intro.firmName) }
      : null,
  };
}
