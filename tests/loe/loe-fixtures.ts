import type { ProposalContent } from "@/lib/proposals/types";
import { fold, DESIGN_OPTIONS, WORD_OPTIONS } from "../proposals/mark-fixture";
import { faithe } from "../proposals/general-fixture";
import { fullLetterBody } from "./full-letter-fixture";

/** A proposal's `loe` block as the stored content carries it (public reads keep title, body and kind only). */
export function withLoe(content: ProposalContent, kind: "trademark" | "general" = "trademark"): ProposalContent {
  return {
    ...content,
    loe: {
      kind,
      template_id: "11111111-1111-4111-8111-111111111111",
      template_version: 3,
      title: "Engagement letter",
      body: fullLetterBody(),
    },
  };
}

/** Two brand names, a package per mark on each (the Danielle-shaped offer with a second brand). */
export function twoBrandPerMark(): ProposalContent {
  const base = fold();
  return {
    ...base,
    names: [
      ...base.names,
      {
        id: "ci",
        name: "The Confidence Interval",
        marks: [
          { id: "ci-word", kind: "word", desc: "Protects the words.", preselected: true, package_choice: { options: [...WORD_OPTIONS], default: "Concierge" } },
          { id: "ci-logo", kind: "logo", desc: "Protects the design.", preselected: false, package_choice: { options: [...DESIGN_OPTIONS], default: "Enhanced" } },
        ],
        classes: [
          { id: "ci-c1", label: "Software", preselected: true },
          { id: "ci-c2", label: "Consulting", preselected: false },
        ],
      },
    ],
  };
}

export function generalWithLoe(): ProposalContent {
  return withLoe(faithe(), "general");
}
