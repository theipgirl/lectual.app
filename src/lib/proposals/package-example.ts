import { parseCount, parseMoney, parsePercent } from "@/lib/proposal-editor/form";
import type { PricingValues } from "@/components/proposal-editor/PricingFields";
import { formatCents } from "@/lib/quotes/money";
import { quoteProposal } from "./pricing";
import type { ProposalContent, Selection } from "./types";

/** The example every package row shows under its fields: one mark, two classes. */
export const EXAMPLE_MARKS = 1;
export const EXAMPLE_CLASSES = 2;

export type PackageExample = { ok: true; legalCents: number; govCents: number; text: string } | { ok: false; text: string };

const NOT_READY = "Fill in the prices to see an example.";

/**
 * "1 mark, 2 classes = $X legal + $Y USPTO" for the package as typed. The numbers come from the same
 * `quoteProposal` a client's page and the accept path use: this builds a one-name, one-mark, two-class proposal
 * from the form values and reads the quote's own legal and USPTO totals. Nothing is calculated here.
 */
export function packageExample(values: PricingValues): PackageExample {
  const base = parseMoney(values.base, "Price");
  const perClass = parseMoney(values.perClass, "Price per extra class");
  const gov = parseMoney(values.govPerClass, "USPTO fee");
  const included = parseCount(values.includedClasses, "Classes included");
  const pct = parsePercent(values.secondMarkPct, "Second mark discount");
  if (!base.ok || !perClass.ok || !gov.ok || !included.ok || !pct.ok) return { ok: false, text: NOT_READY };

  const marks = Array.from({ length: EXAMPLE_MARKS }, (_, i) => ({ id: `m${i}`, kind: "word" as const, desc: "", preselected: true }));
  const classes = Array.from({ length: EXAMPLE_CLASSES }, (_, i) => ({ id: `c${i}`, label: `Class ${i + 1}`, preselected: true }));
  const content: ProposalContent = {
    client: { first_name: "", full_name: "" },
    greeting: "",
    pricing: {
      package: values.package,
      base_cents: base.value,
      included_classes: included.value,
      per_class_cents: perClass.value,
      second_mark_discount_pct: pct.value,
      gov_per_class_cents: gov.value,
    },
    names: [{ id: "n0", name: "Example", marks, classes }],
    adjustments: [],
    includes: [],
  };
  const selection: Selection = Object.fromEntries([...marks, ...classes].map((x) => [x.id, true]));
  const quote = quoteProposal(content, selection);
  const text = `${EXAMPLE_MARKS} mark, ${EXAMPLE_CLASSES} classes = ${formatCents(quote.legal_total_cents)} legal + ${formatCents(quote.gov_total_cents)} USPTO`;
  return { ok: true, legalCents: quote.legal_total_cents, govCents: quote.gov_total_cents, text };
}
