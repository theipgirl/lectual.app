import { formatDollars } from "@/lib/proposal-editor/events";
import { defaultSelection, quoteProposal } from "./pricing";
import { MARK_KIND_LABEL, isMarkKind, type ProposalContent, type ProposalEventRow } from "./types";

/**
 * The proposal card: one summary of an agent-drafted (or hand-made) proposal so
 * an approver can check it in seconds. Pure and total: the content is jsonb an
 * agent or a person edited, and the events carry model output, so every part is
 * read defensively and a malformed one reads as "no receipts", never an error.
 *
 * Prices are the saved ones, worked out by `quoteProposal` at the firm's
 * pre-ticked offer. The two fees are two figures and are never added together:
 * the legal fee is due at signing, the USPTO fees at filing.
 *
 * Only a brand's classes are counted ("2 classes heard"); an International Class
 * number is never shown. A class is named by its plain-language label.
 */

/** The consult agent's own `edited` event (see `agent-create.ts`). */
const CONSULT_SOURCE = "consult-proposal";
const MAX_QUOTES = 12;
const MAX_QUOTE_CHARS = 300;

export type ProposalCardBrand = {
  name: string;
  /** "Word mark", "Logo mark", in content order. */
  marks: string[];
  classesHeard: number;
  classLabels: string[];
  /** "5 classes heard · Concierge covers 3, the rest bill at $825 each". */
  coverage: string;
};

export type ProposalCardReceipts =
  /** No consult-agent event: nothing to show (a hand-made proposal). */
  | { status: "none" }
  /** The events could not be read. Not the same as none. */
  | { status: "unavailable" }
  | { status: "ok"; verified: string[]; unverified: string[]; notes: string | null; more: number };

export type ProposalCard = {
  client: string;
  company: string | null;
  package: string;
  brands: ProposalCardBrand[];
  /** The legal fee, due when the client accepts. */
  legalAtSigningCents: number;
  /** The USPTO fees, due at filing. Never added to the legal fee. */
  usptoAtFilingCents: number;
  expiresOn: string | null;
  receipts: ProposalCardReceipts;
};

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const wholeNumber = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The coverage sentence for one brand. Exported for tests. */
export function coverageLine(args: { heard: number; packageName: string; included: number; perClassCents: number }): string {
  const { heard, packageName, included, perClassCents } = args;
  const pkg = packageName || "The package";
  if (heard === 0) return `No classes heard yet · ${pkg} covers ${included}`;
  const base = `${plural(heard, "class", "classes")} heard · ${pkg} covers ${included}`;
  return heard > included ? `${base}, the rest bill at ${formatDollars(perClassCents)} each` : base;
}

function receiptsFrom(events: readonly ProposalEventRow[] | null): ProposalCardReceipts {
  if (events === null) return { status: "unavailable" };
  const event = events.find((e) => e && e.type === "edited" && e.actor === "agent" && obj(e.payload).source === CONSULT_SOURCE);
  if (!event) return { status: "none" };
  const payload = obj(event.payload);
  const verified: string[] = [];
  const unverified: string[] = [];
  for (const item of arr<unknown>(payload.evidence)) {
    const quote = text(obj(item).quote);
    if (!quote) continue;
    (obj(item).verified === true ? verified : unverified).push(clip(quote, MAX_QUOTE_CHARS));
  }
  const all = verified.length + unverified.length;
  const shownVerified = verified.slice(0, MAX_QUOTES);
  const shownUnverified = unverified.slice(0, MAX_QUOTES);
  return {
    status: "ok",
    verified: shownVerified,
    unverified: shownUnverified,
    notes: text(payload.notes) ? clip(String(payload.notes), 900) : null,
    more: all - shownVerified.length - shownUnverified.length,
  };
}

/**
 * `events`: the proposal's event rows (any order), `[]` when it has none, or
 * `null` when they could not be read (the card then says so instead of
 * implying there were no receipts).
 */
export function buildProposalCard(
  row: { client_name: string; content: ProposalContent; expires_on: string | null },
  events: readonly ProposalEventRow[] | null,
): ProposalCard {
  const content = (row.content ?? {}) as Partial<ProposalContent>;
  const pricing = obj(content.pricing);
  const packageName = text(pricing.package) ?? "";
  const included = wholeNumber(pricing.included_classes);
  const standardPerClass = wholeNumber(pricing.per_class_cents);
  const quote = quoteProposal(content as ProposalContent, defaultSelection(content as ProposalContent));

  const brands = arr<Record<string, unknown>>(content.names).map((n): ProposalCardBrand => {
    const classes = arr<Record<string, unknown>>(n.classes);
    const override = obj(n.price_override);
    return {
      name: text(n.name) ?? "Unnamed brand",
      marks: arr<Record<string, unknown>>(n.marks).map((m) => (isMarkKind(m.kind) ? MARK_KIND_LABEL[m.kind] : "Mark")),
      classesHeard: classes.length,
      classLabels: classes.map((c) => text(c.label)).filter((l): l is string => l !== null),
      coverage: coverageLine({
        heard: classes.length,
        packageName,
        included,
        perClassCents: override.per_class_cents == null ? standardPerClass : wholeNumber(override.per_class_cents),
      }),
    };
  });

  return {
    client: row.client_name,
    company: text(obj(content.client).company),
    package: packageName,
    brands,
    legalAtSigningCents: quote.legal_total_cents,
    usptoAtFilingCents: quote.gov_total_cents,
    expiresOn: row.expires_on,
    receipts: receiptsFrom(events),
  };
}
