import { buildAcceptedSnapshot } from "@/lib/proposals/public";
import { quoteProposal } from "@/lib/proposals/pricing";
import type { AcceptedSnapshot, ProposalAdjustment, ProposalContent, ProposalPricing } from "@/lib/proposals/types";
import { sevetri } from "./fixture";

/**
 * A real-shaped ACCEPTED snapshot (content + selection + the recomputed quote), built with the
 * production `quoteProposal` and `buildAcceptedSnapshot`, for the Sprint 19 tests. One brand name
 * (Prosperall) by default so the LOE adapter has exactly one mark to draft.
 */

export const ACCEPTED_AT = "2026-10-21T15:00:00.000Z";

export const CONCIERGE: ProposalPricing = {
  package: "Concierge",
  base_cents: 495_000,
  included_classes: 3,
  per_class_cents: 82_500,
  second_mark_discount_pct: 20,
  gov_per_class_cents: 35_000,
};

export function acceptedSnapshot(
  opts: {
    /** Brand names to include: `p` (Prosperall) and/or `t` (Tech4PublicGood). Default: p only. */
    brands?: Array<"p" | "t">;
    /** How many of Prosperall's classes are picked (1..3). Default 1. */
    classes?: number;
    /** Prosperall's picked marks. Default: word only. */
    marks?: Array<"word" | "logo">;
    adjustments?: ProposalAdjustment[];
    packageName?: string;
    includes?: ProposalContent["includes"];
    company?: string | null;
    acceptedAt?: string;
  } = {},
): AcceptedSnapshot {
  const content = sevetri();
  const brands = opts.brands ?? ["p"];
  const classes = opts.classes ?? 1;
  const marks = opts.marks ?? ["word"];

  const p = content.names.find((n) => n.id === "p")!;
  p.classes = [
    { id: "p-c1", label: "Cloud-Based Software as a Service (SaaS)", preselected: true },
    { id: "p-c2", label: "Consulting & Professional Services", preselected: true },
    { id: "p-c3", label: "Software Development", preselected: true },
  ];
  content.names = content.names.filter((n) => brands.includes(n.id as "p" | "t"));
  if (opts.packageName) content.pricing.package = opts.packageName;
  if (opts.adjustments) content.adjustments = opts.adjustments;
  if (opts.includes) content.includes = opts.includes;
  if (opts.company !== undefined) content.client.company = opts.company ?? undefined;

  const selection: Record<string, boolean> = {};
  for (const name of content.names) {
    for (const m of name.marks) selection[m.id] = name.id === "p" ? marks.includes(m.kind as "word" | "logo") : true;
    name.classes.forEach((c, i) => {
      selection[c.id] = name.id === "p" ? i < classes : true;
    });
  }
  const quote = quoteProposal(content, selection);
  return buildAcceptedSnapshot({ version: 1, content, selection, quote, acceptedAt: opts.acceptedAt ?? ACCEPTED_AT });
}
