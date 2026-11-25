// Output schemas for the two model calls behind the full consult brief.
//
// PORTED from lawmatics-mcp src/consult-brief/ai/schemas.ts (see PORTED_FROM.md). Changes: zod 4 from the repo's own `zod`; the package
// is a NAME from the firm's own list (or HELD / NONE), so the judgment schema is made per firm by `makeJudgmentSchema(names)`.
//
// There is deliberately NO price field anywhere. The model picks a package name; every amount the brief prints is read from the firm's list.

import { z } from "zod";

const text = (max: number) => z.string().min(1).max(max);
const niceClass = z.number().int().min(1).max(45);

export const ROUTES = ["TRADEMARK", "GENERAL", "DISPUTE"] as const;
export type Route = (typeof ROUTES)[number];

export const MARK_STATUSES = ["confirmed", "tbd", "none"] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];

/** The two answers that are not a package: nothing is quoted yet, or packages don't fit the matter. */
export const PACKAGE_HELD = "HELD";
export const PACKAGE_NONE = "NONE";
export const RESERVED_CHOICES = [PACKAGE_HELD, PACKAGE_NONE] as const;

/** Call 1: route the matter and plan the USPTO knockout search. */
export const RoutePlanSchema = z.object({
  route: z.enum(ROUTES),
  routeReason: text(600),
  /** A second deliverable to note as a future separate matter, or null. */
  secondaryMatter: text(400).nullable(),
  markStatus: z.enum(MARK_STATUSES),
  mark: text(120).nullable(),
  /** The distinctive word for the tier-2 stem search. */
  stem: text(60).nullable(),
  /** Spaced / expanded forms for tier 1. More than 5 are trimmed in code, not refused. */
  variants: z.array(text(240)).max(20),
  /** More than 3 are trimmed (and duplicates removed) in code. */
  likelyClasses: z.array(z.object({ classNumber: niceClass, rationale: text(400) })).max(10),
});
export type RoutePlan = z.infer<typeof RoutePlanSchema>;

const PdfCategorySchema = z.object({
  /** Plain business language, no class number (the renderer appends "(Class NN)"). */
  text: text(600),
  classNumber: niceClass,
  priority: z.boolean(),
});

const PdfMarkSchema = z.object({
  mark: text(120),
  categories: z.array(PdfCategorySchema).max(20),
});

const likelyClassesSchema = z.array(z.object({ classNumber: niceClass, rationale: text(400) })).max(10);

/** The package part of the judgment, for a firm whose packages are `names`. `choice` is one of those names, HELD or NONE. */
export function makePackageSchema(names: readonly string[]) {
  const choices = [...names, ...RESERVED_CHOICES] as unknown as [string, ...string[]];
  return z.object({
    choice: z.enum(choices),
    reasoning: text(1500),
    classesToFileNow: z.array(niceClass).max(10),
    priorityClass: niceClass.nullable(),
    /** What is still open (mark TBD, class count unsettled). Required when the choice is HELD. */
    pending: text(400).nullable(),
    pdfMarks: z.array(PdfMarkSchema).max(10),
  });
}

export function makeTrademarkBlockSchema(names: readonly string[]) {
  return z.object({
    likelyClasses: likelyClassesSchema,
    /** Why no class can be named yet, when likelyClasses is empty. */
    noClassesReason: text(300).nullable(),
    riskRead: text(2000),
    package: makePackageSchema(names),
  });
}

export const GeneralBlockSchema = z.object({
  scopeAndEngagement: text(2000),
  documentsNeeded: z.array(text(300)).max(10),
  jurisdictionNote: text(400).nullable(),
});
export type GeneralBlock = z.infer<typeof GeneralBlockSchema>;

export const DisputeBlockSchema = z.object({
  disputeSnapshot: text(2000),
});
export type DisputeBlock = z.infer<typeof DisputeBlockSchema>;

/** Call 2: the judgment sections of the brief, for a firm whose packages are `names`. */
export function makeJudgmentSchema(names: readonly string[]) {
  return z.object({
    clientSnapshot: text(1500),
    markSubmitted: text(500),
    natureOfMatter: text(1000),
    flagsToProbe: z.array(text(400)).min(0).max(8),
    questions: z.array(text(400)).min(3).max(5),
    trademark: makeTrademarkBlockSchema(names).nullish(),
    general: GeneralBlockSchema.nullish(),
    dispute: DisputeBlockSchema.nullish(),
  });
}

export type Judgment = z.infer<ReturnType<typeof makeJudgmentSchema>>;
export type TrademarkBlock = NonNullable<Judgment["trademark"]>;
export type PackageJudgment = TrademarkBlock["package"];
/** A package name from the firm's list, or HELD or NONE. */
export type PackageChoice = string;
