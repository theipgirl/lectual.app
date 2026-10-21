// Every surface picks questions and scorer here, so stored answers are read with the card they were given on.
//
// Ported from lectual src/lib/booth/variants.ts (see PORTED_FROM.md). The event codes and the
// Urban-Golf/Story2Profit date switch are dropped: here the EVENT is the intake itself, and its
// source tag is what Lawmatics sees.

import { boothQuestions, questionsFor, Q_TRACK, type BoothQuestion, type BoothTrack } from "./questions";
import { calculateBoothScore, type BoothAnswers, type BoothScore } from "./score";
import { ipQuestions, ipQuestionsFor, IP_Q_TRACK } from "./ip-questions";
import { calculateIpBoothScore } from "./ip-score";

export type BoothVariantId = "business" | "ip";

export interface BoothVariant {
  id: BoothVariantId;
  title: string;
  shareTitle: string;
  shareDescription: string;
  trackQuestionId: number;
  /** Full list, business-track copy. */
  questions: BoothQuestion[];
  questionsFor(track: BoothTrack): BoothQuestion[];
  score(answers: BoothAnswers): BoothScore;
}

const VARIANTS: Record<BoothVariantId, BoothVariant> = {
  business: {
    id: "business",
    title: "Brand & Business Assessment",
    shareTitle: "Take the Brand & Business Assessment",
    shareDescription: "Eight quick questions about your business and your brand.",
    trackQuestionId: Q_TRACK,
    questions: boothQuestions,
    questionsFor,
    score: calculateBoothScore,
  },
  ip: {
    id: "ip",
    title: "Trademark & Copyright Assessment",
    shareTitle: "Take the Trademark & Copyright Assessment",
    shareDescription: "A few quick questions about your name, your brand and your content.",
    trackQuestionId: IP_Q_TRACK,
    questions: ipQuestions,
    questionsFor: ipQuestionsFor,
    score: calculateIpBoothScore,
  },
};

export const BOOTH_VARIANT_IDS = Object.keys(VARIANTS) as BoothVariantId[];

export function isBoothVariantId(v: unknown): v is BoothVariantId {
  // Not Object.hasOwn: booth iPads may run Safari older than 15.4.
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(VARIANTS, v);
}

export function boothVariant(id: BoothVariantId): BoothVariant {
  return VARIANTS[id];
}
