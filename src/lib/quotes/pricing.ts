/**
 * Quote arithmetic — what a client owes, and WHEN.
 *
 * Pure module: no database, no server-only imports, no `new Date()`. Safe to
 * import from a `"use client"` component and from a plain vitest run with no
 * environment, same discipline as matters/workstream.ts.
 *
 * ── WHY THIS MODULE HAS TWO TOTALS AND NOT ONE ──────────────────────────────
 * "the USPTO fees are something separate that gets charged when we do the
 *  filing, not before or during signing the engagement letter." — Taylor,
 *  2026-09-09 (spec §0)
 *
 * A trademark quote legitimately contains the firm's flat legal fee (charged
 * when the engagement letter is signed, into the OPERATING account) and the
 * USPTO's per-class government fee (quoted so the client knows the full cost,
 * but charged later, at filing). A single "Total: $3,125" on a client-facing
 * page is therefore not a rounding nicety — it is a false statement about what
 * the client is paying today, on the page where they type their signature.
 *
 * So this module deliberately DOES NOT export a `total`. `quoteTotals` returns
 * the split, and a caller that genuinely wants the whole project cost has to
 * ask for it by a name that says so: `fullProjectCost`. A bare `total` on a
 * client-facing surface reads as "what I am paying today"; making the caller
 * type the honest word is the cheapest possible guard against re-introducing
 * the dishonest one.
 *
 * ── THE GOVERNMENT-FEE RULE IS ENFORCED TWICE, ON PURPOSE ───────────────────
 * 0068 carries `check (kind <> 'government_fee' or charge_at <> 'signing')`.
 * This module is the second line: a `government_fee` whose `charge_at` says
 * `signing` is bucketed to filing anyway, so there is no code path — not a bad
 * migration, not a service-library row copied wrong, not a hand-written insert
 * through the service role — by which a USPTO fee can reach the amount a client
 * is charged at signing. It is also reported by `quoteBlockers` so the
 * violation is visible rather than quietly repaired.
 *
 * That override is scoped to `signing` and NOTHING ELSE, because `signing` is
 * the only schedule §0 is about. It used to fire on every `government_fee`
 * regardless of schedule, which meant a fee the firm had deliberately marked
 * `not_charged` — "USPTO filing fee (1 class) — included in your flat fee" —
 * was moved into `dueAtFiling` and billed to the client as "$350.00, charged
 * when your application is filed", then frozen there by
 * `accepted_snapshot.totals`. `government_fee` × `not_charged` is a real,
 * offered combination: 0068's check permits it, the Add Line dropdown filters
 * only `signing` out of the government-fee schedules, and `store.test.ts`
 * asserts it round-trips. Over-applying the §0 guard charged money the firm
 * had said it would not charge, which is the same class of lie §0 exists to
 * prevent — just pointed the other way.
 *
 * ── MONEY REPRESENTATION ────────────────────────────────────────────────────
 * Integer cents, `bigint` columns, plain JS numbers here. No floats anywhere.
 * Rounding happens exactly once in this file — in `percentDiscountCents`, at
 * the moment a percentage discount becomes a stored cents amount — and every
 * other figure in this module is a sum of integers and is exact.
 *
 * There is deliberately NO display formatter here. Formatting is `Intl` work
 * and belongs to the rendering slice; a pure module that formats invites a
 * caller to round-trip money through a string and back.
 *
 * ── TOLERANCE ───────────────────────────────────────────────────────────────
 * Every function here is total. Nothing throws — not on a null field, not on a
 * `kind` this build has never heard of, not on a `unit_amount_cents` that
 * arrived as a string. These rows come from a database whose schema will keep
 * moving, and a totals panel that throws takes the whole quote page down,
 * whereas one that reports a blocker takes the accept button down and says
 * why. `status.ts` is where throwing IS correct (an illegal transition is a
 * bug, not data); arithmetic over stored rows is not.
 */

/** Line kinds — `crm_quote_line.kind` (spec §3.3). */
export const QUOTE_LINE_KINDS = [
  "legal_fee",
  "government_fee",
  "expense",
  "discount",
] as const;

export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

/** Charge schedules — `crm_quote_line.charge_at`. THIS is the §0 column. */
export const QUOTE_CHARGE_SCHEDULES = ["signing", "filing", "not_charged"] as const;

export type QuoteChargeAt = (typeof QUOTE_CHARGE_SCHEDULES)[number];

/** How the client interacts with a line — `crm_quote_line.selection` (§4.2). */
export const QUOTE_LINE_SELECTIONS = ["included", "optional", "tier_option"] as const;

export type QuoteLineSelection = (typeof QUOTE_LINE_SELECTIONS)[number];

/** v1 renders USD only; `currency` is a column so the schema needn't change. */
export const DEFAULT_CURRENCY = "USD";

/**
 * A quote line, reduced to what pricing needs — and typed as loosely as the
 * wire actually is.
 *
 * `kind`, `charge_at` and `selection` are `string` rather than their unions
 * because that is what a PostgREST row hands you: a Postgres enum arrives as
 * text, and a value added by a later migration would not type-error, it would
 * simply be a string this build does not recognise. Typing them narrowly here
 * would move that problem from a branch we can handle to a lie the compiler
 * believes.
 *
 * `unit_amount_cents` and `quantity` accept `string` for the same reason:
 * `bigint` is not JSON-safe, and depending on the PostgREST/driver
 * configuration an int8 can arrive quoted. `Number(undefined)` is NaN, NaN
 * propagates silently through every sum, and the page renders "$NaN" or, worse,
 * a wrong number that looks fine. `intCents` below refuses anything that is not
 * a plain integer literal — note that it deliberately does NOT parse currency
 * ("$4,750.00" is rejected, not interpreted).
 */
export type QuoteLineInput = {
  id?: string | null;
  kind?: string | null;
  charge_at?: string | null;
  selection?: string | null;
  tier_group?: string | null;
  selected?: boolean | null;
  label?: string | null;
  quantity?: number | string | null;
  unit_amount_cents?: number | string | null;
};

/**
 * The signing / filing split. There is no fourth field summing these, and that
 * omission is the point — see the module header.
 *
 * `notCharged` is money named on the quote that the client is never billed
 * for: a waived fee, a courtesy line, an "included" item priced at zero for
 * transparency, or a USPTO fee the firm is absorbing into its flat fee. It is
 * NOT part of `fullProjectCost`, because the full project cost is what the
 * client will actually pay.
 */
export type QuoteTotals = {
  /** Sum of SELECTED lines with `charge_at === 'signing'`. Never a government fee. */
  dueAtSigning: number;
  /** Sum of SELECTED lines with `charge_at === 'filing'`, plus any government
   *  fee whose schedule wrongly said `signing` — see `bucketOf`. */
  dueAtFiling: number;
  /** Sum of SELECTED lines that are never charged — including a `government_fee`
   *  the firm marked `not_charged` — and of any line whose schedule this build
   *  does not recognise. See `bucketOf`. */
  notCharged: number;
  currency: string;
};

function isKnownChargeAt(value: unknown): value is QuoteChargeAt {
  return (
    typeof value === "string" && (QUOTE_CHARGE_SCHEDULES as readonly string[]).includes(value)
  );
}

export function isQuoteLineKind(value: unknown): value is QuoteLineKind {
  return typeof value === "string" && (QUOTE_LINE_KINDS as readonly string[]).includes(value);
}

export function isQuoteChargeAt(value: unknown): value is QuoteChargeAt {
  return isKnownChargeAt(value);
}

export function isQuoteLineSelection(value: unknown): value is QuoteLineSelection {
  return (
    typeof value === "string" && (QUOTE_LINE_SELECTIONS as readonly string[]).includes(value)
  );
}

/**
 * A cents amount, or 0 for anything that is not one.
 *
 * Accepts a JS number that is already an integer, or a bare integer STRING
 * (how an int8 can arrive over the wire). Everything else — NaN, Infinity,
 * a float, `null`, `"$4,750.00"`, `"4750.00"` — is 0.
 *
 * Zero rather than a throw, and zero rather than a best guess: a line whose
 * amount cannot be read is a line whose amount we do not know, and inventing
 * one is how a client gets charged a number nobody wrote down. The line is
 * separately reported by `quoteBlockers` as `unreadable_amount`, so it shows
 * up as a blocked accept button rather than as a quietly cheaper quote.
 */
function intCents(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : 0;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isSafeInteger(n) ? n : 0;
  }
  return 0;
}

/** True when `unit_amount_cents` held something this module could read. */
function hasReadableAmount(line: QuoteLineInput): boolean {
  const raw = line.unit_amount_cents;
  if (raw === null || raw === undefined) return false;
  if (typeof raw === "number") return Number.isSafeInteger(raw);
  return typeof raw === "string" && /^-?\d+$/.test(raw.trim()) && Number.isSafeInteger(Number(raw.trim()));
}

/**
 * Quantity, defaulting to 1.
 *
 * 1 rather than 0 for unreadable input because 0 would silently delete a line
 * from the total, and the column is `integer not null default 1 check (> 0)` —
 * so anything else here is data that should not exist, and the DB's own
 * default is the least surprising stand-in. A quantity of 0 or less is treated
 * as 1 for the same reason and flagged by `quoteBlockers`.
 */
function quantityOf(line: QuoteLineInput): number {
  const raw = line.quantity;
  const n = typeof raw === "string" ? (/^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN) : raw;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) return 1;
  return n;
}

/**
 * The signed cents this line contributes: `quantity × unit_amount_cents`.
 *
 * Discounts are stored negative (0068's `crm_quote_line_amount_sign` check), so
 * they subtract by arithmetic rather than by a branch — one fewer place for a
 * sign to be flipped.
 */
export function lineAmountCents(line: QuoteLineInput): number {
  return quantityOf(line) * intCents(line.unit_amount_cents);
}

/**
 * The line's `selection`, as a plain string.
 *
 * A MISSING value reads as `included`, matching the column's own
 * `not null default 'included'`. An unrecognised NON-EMPTY value is returned
 * verbatim rather than coerced to `included`, and the distinction is the whole
 * point: coercing it would mean a future `selection = 'bundle_option'` — a
 * choice the client is offered and has not made — silently counted as
 * always-in and charged for. Absent means "the default"; unknown means
 * "unknown", and unknown answers to `isLineSelected` with the stored boolean.
 */
function selectionOf(line: QuoteLineInput): string {
  const raw = line.selection;
  if (typeof raw !== "string" || !raw.trim()) return "included";
  return raw.trim();
}

/**
 * Whether a line counts toward the totals.
 *
 * `included` lines are always in and cannot be deselected (§4.2), so a stray
 * `selected: false` on one is ignored — the client was never offered the choice.
 * Everything else — `optional`, `tier_option`, and any selection kind a later
 * migration adds — follows the stored boolean, which is the database's record
 * of the choice the client actually made.
 */
export function isLineSelected(line: QuoteLineInput): boolean {
  if (selectionOf(line) === "included") return true;
  return line.selected === true;
}

export function selectedLines(lines: readonly QuoteLineInput[]): QuoteLineInput[] {
  return lines.filter(isLineSelected);
}

/**
 * Which bucket a selected line's money lands in.
 *
 * Two rules, both load-bearing:
 *
 *  1. A `government_fee` that claims `charge_at = 'signing'` goes to `filing`
 *     instead. This is the §0 guarantee stated as code: there is no input to
 *     this function that puts a USPTO fee into `dueAtSigning`.
 *
 *     It is deliberately conditioned on `'signing'` and not on `kind` alone.
 *     `government_fee` × `not_charged` is a combination the firm is offered
 *     and means something specific — a USPTO fee the firm is absorbing into
 *     its flat fee — and rewriting it to `filing` bills the client for money
 *     the quote says they will not be billed. §0 is about what may appear in
 *     `dueAtSigning`; it says nothing about `not_charged`, and reading it more
 *     broadly than it is written cost the client $350.
 *  2. A schedule this build does not recognise goes to `notCharged` — NOT to
 *     an amount due, and NOT to `filing` merely because the line is a
 *     government fee. If a later migration adds `charge_at = 'monthly'`, this
 *     build cannot know when that money is owed, and an amount presented as
 *     due today that is not due today is the exact failure §0 exists to
 *     prevent. It is reported as `unknown_charge_schedule` by `quoteBlockers`,
 *     so the quote is not acceptable while it contains money this build cannot
 *     place in time.
 */
function bucketOf(line: QuoteLineInput): QuoteChargeAt {
  if (line.kind === "government_fee" && line.charge_at === "signing") return "filing";
  return isKnownChargeAt(line.charge_at) ? line.charge_at : "not_charged";
}

/**
 * The split. Selected lines only; exact integer sums.
 *
 * `currency` is passed in rather than read off a line because currency lives on
 * `crm_quote`, not on the line — mixed-currency quotes are rejected at write
 * time (§2), so there is exactly one currency per quote and no place here to
 * "helpfully" reconcile two.
 *
 * Note that the buckets are NOT clamped at zero. A discount larger than the
 * fees it applies to produces a negative `dueAtSigning`, and this function
 * reports that honestly rather than flooring it: flooring would make
 * `dueAtSigning + dueAtFiling` stop equalling the lines, so the totals panel
 * and the line list would disagree with no indication why. `quoteBlockers`
 * flags it as `negative_amount_due` instead, and no charge should ever be
 * raised from a blocked quote.
 */
export function quoteTotals(
  lines: readonly QuoteLineInput[],
  currency: string = DEFAULT_CURRENCY,
): QuoteTotals {
  const totals: QuoteTotals = {
    dueAtSigning: 0,
    dueAtFiling: 0,
    notCharged: 0,
    currency: currency || DEFAULT_CURRENCY,
  };

  for (const line of lines) {
    if (!isLineSelected(line)) continue;
    const amount = lineAmountCents(line);
    switch (bucketOf(line)) {
      case "signing":
        totals.dueAtSigning += amount;
        break;
      case "filing":
        totals.dueAtFiling += amount;
        break;
      default:
        totals.notCharged += amount;
    }
  }

  return totals;
}

/**
 * The whole cost of the engagement: what is due at signing plus what will be
 * due at filing. Named so that a surface rendering it has to say the honest
 * words — "full project cost" — rather than "Total".
 *
 * Excludes `notCharged`, which by definition is money the client never pays.
 *
 * Takes the already-computed totals rather than the lines, so the relationship
 * between this figure and the two amounts due is visible at the call site
 * instead of being a second independent walk that could drift from the first.
 */
export function fullProjectCost(totals: QuoteTotals): number {
  return totals.dueAtSigning + totals.dueAtFiling;
}

/**
 * A percentage discount, as a NEGATIVE cents amount ready to store in
 * `unit_amount_cents`.
 *
 * This is the one and only rounding in the pricing module (§2). It happens
 * here, once, at the moment the percentage becomes money — not on display, not
 * per-render, not again at charge time. `Math.round` is specified by the spec;
 * a float that is rounded twice is a float that can disagree with itself, and
 * a quote whose discount is $712.50 on the client's screen and $712.49 on the
 * charge is a support ticket about honesty.
 *
 * `baseCents` is whatever the firm chose to discount (usually the legal-fee
 * subtotal), computed by the caller from integer cents. Percentages outside
 * 0–100 and non-finite input yield 0: a "discount" that adds money, or one
 * derived from NaN, is not a discount.
 */
export function percentDiscountCents(baseCents: number, percent: number): number {
  if (!Number.isFinite(baseCents) || !Number.isFinite(percent)) return 0;
  if (percent <= 0 || percent > 100) return 0;
  return -Math.round((baseCents * percent) / 100);
}

/**
 * The subtotal a percentage discount is normally taken against: selected,
 * non-discount lines, in a given bucket. Exported because the alternative is
 * every caller re-deriving "what does 10% off mean here", and two callers
 * deriving it differently is how a client sees two different discounts.
 */
export function discountBaseCents(
  lines: readonly QuoteLineInput[],
  chargeAt: QuoteChargeAt = "signing",
): number {
  let base = 0;
  for (const line of lines) {
    if (!isLineSelected(line)) continue;
    if (line.kind === "discount") continue;
    if (bucketOf(line) !== chargeAt) continue;
    base += lineAmountCents(line);
  }
  return base;
}

/* ────────────────────────────── tier groups ─────────────────────────────── */

/** One mutually-exclusive package choice (§4.2). */
export type TierGroup = {
  group: string;
  options: QuoteLineInput[];
  /** How many options in this group the client currently has ticked. */
  selectedCount: number;
};

/**
 * The tier groups on a quote, in first-appearance order (which is the order
 * `sort_index` produced when the caller read them — this module does not
 * re-sort, because the firm's chosen ordering is the one the client sees).
 *
 * A `tier_option` line with no `tier_group` is skipped here and reported by
 * `quoteBlockers`; grouping it under `""` or under its own label would invent
 * a package choice the firm did not author.
 */
export function tierGroups(lines: readonly QuoteLineInput[]): TierGroup[] {
  const groups = new Map<string, TierGroup>();
  for (const line of lines) {
    if (selectionOf(line) !== "tier_option") continue;
    const key = typeof line.tier_group === "string" ? line.tier_group.trim() : "";
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = { group: key, options: [], selectedCount: 0 };
      groups.set(key, group);
    }
    group.options.push(line);
    if (line.selected === true) group.selectedCount += 1;
  }
  return Array.from(groups.values());
}

/* ────────────────────────────── readiness ───────────────────────────────── */

/**
 * Why a quote cannot be accepted. A REASON, not a boolean, because the accept
 * button that is disabled has to be able to say why — "Choose a package" is an
 * instruction; a greyed-out button with no explanation is a dead end, and the
 * client's only recourse is to email the firm.
 */
export type QuoteBlockReason =
  /** Nothing to accept. */
  | "no_lines"
  /** A package group with nothing chosen — the ordinary, expected one. */
  | "tier_group_unselected"
  /** Two options ticked in one mutually-exclusive group. */
  | "tier_group_multiple"
  /** A `tier_option` line carrying no `tier_group` (0068 check violated). */
  | "tier_option_without_group"
  /** A USPTO fee marked `charge_at = 'signing'` (§0 / 0068 check violated). */
  | "government_fee_at_signing"
  /** A `charge_at` this build does not recognise — money it cannot place in time. */
  | "unknown_charge_schedule"
  /** `unit_amount_cents` that could not be read as an integer. */
  | "unreadable_amount"
  /** A discount stored positive, or a charge stored negative (0068 check violated). */
  | "amount_sign_mismatch"
  /** Discounts exceed charges: an amount due below zero. */
  | "negative_amount_due";

export type QuoteBlocker = {
  reason: QuoteBlockReason;
  /** Plain-language, safe to render to a client for the client-facing reasons. */
  message: string;
  /** The tier group at fault, for the tier reasons. */
  tierGroup?: string;
  /** The line at fault, where one line is to blame. */
  lineId?: string;
};

export type QuoteReadiness =
  | { ready: true }
  | ({ ready: false } & QuoteBlocker);

/**
 * Every reason this quote cannot be accepted, in the order they should be
 * fixed: data-integrity violations first (the firm's problem, and they make the
 * totals untrustworthy), then the client's own outstanding choices.
 *
 * All of them, not just the first, because the quote BUILDER needs the whole
 * list — a firm that fixes one violation, re-saves, and is shown the next one
 * learns about its own data one page-load at a time. The client-facing surface
 * takes `quoteReadiness` instead and shows exactly one.
 *
 * Note what is NOT here: an unselected `optional` add-on. An add-on the client
 * chose not to buy is an answer, not a missing one.
 */
export function quoteBlockers(lines: readonly QuoteLineInput[]): QuoteBlocker[] {
  const blockers: QuoteBlocker[] = [];

  if (lines.length === 0) {
    return [{ reason: "no_lines", message: "This quote has no line items yet." }];
  }

  for (const line of lines) {
    const lineId = line.id ?? undefined;

    if (line.kind === "government_fee" && line.charge_at === "signing") {
      // Cannot happen through the database (0068 check constraint), which is
      // exactly why it is worth reporting rather than assuming: if it is here,
      // something wrote past the constraint and the firm needs to know.
      blockers.push({
        reason: "government_fee_at_signing",
        message: "A government fee is marked as charged at signing. USPTO fees are charged at filing.",
        lineId,
      });
    }

    if (!isKnownChargeAt(line.charge_at)) {
      blockers.push({
        reason: "unknown_charge_schedule",
        message: "A line has a charge schedule this app does not recognise.",
        lineId,
      });
    }

    if (!hasReadableAmount(line)) {
      blockers.push({
        reason: "unreadable_amount",
        message: "A line has an amount that could not be read.",
        lineId,
      });
    } else {
      const unit = intCents(line.unit_amount_cents);
      const isDiscount = line.kind === "discount";
      if ((isDiscount && unit > 0) || (!isDiscount && unit < 0)) {
        blockers.push({
          reason: "amount_sign_mismatch",
          message: isDiscount
            ? "A discount line is stored as a positive amount."
            : "A charge line is stored as a negative amount.",
          lineId,
        });
      }
    }

    if (selectionOf(line) === "tier_option") {
      const key = typeof line.tier_group === "string" ? line.tier_group.trim() : "";
      if (!key) {
        blockers.push({
          reason: "tier_option_without_group",
          message: "A package option is not assigned to a package group.",
          lineId,
        });
      }
    }
  }

  for (const group of tierGroups(lines)) {
    if (group.selectedCount === 0) {
      blockers.push({
        reason: "tier_group_unselected",
        message: "Choose a package.",
        tierGroup: group.group,
      });
    } else if (group.selectedCount > 1) {
      blockers.push({
        reason: "tier_group_multiple",
        message: "Choose only one option in each package.",
        tierGroup: group.group,
      });
    }
  }

  const totals = quoteTotals(lines);
  if (totals.dueAtSigning < 0 || totals.dueAtFiling < 0) {
    blockers.push({
      reason: "negative_amount_due",
      message: "Discounts on this quote exceed the amount charged.",
    });
  }

  return blockers;
}

/**
 * Whether the quote can be accepted, and if not, the single reason to show.
 *
 * The first blocker wins, and `quoteBlockers` orders integrity problems ahead
 * of the client's outstanding choices deliberately: telling a client to
 * "choose a package" on a quote whose totals are wrong would get a signature on
 * a number the firm does not stand behind.
 */
export function quoteReadiness(lines: readonly QuoteLineInput[]): QuoteReadiness {
  const [first] = quoteBlockers(lines);
  return first ? { ready: false, ...first } : { ready: true };
}
