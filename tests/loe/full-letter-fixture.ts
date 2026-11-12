import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderLetter, type LetterBlock } from "@/lib/loe/render";
import type { SignerDetails } from "@/lib/loe/signing";
import { emptyDetails } from "@/lib/loe/signing";

/**
 * The full-length RPB trademark letter (about 2,300 words) from `docs/rpb/engagement-letter-trademark.md`: everything under
 * the first `---` line. Tests and renders use THIS, never a few placeholder paragraphs, so a truncated letter cannot pass.
 */
export function fullLetterBody(): string {
  const raw = readFileSync(join(process.cwd(), "docs", "rpb", "engagement-letter-trademark.md"), "utf8");
  const at = raw.indexOf("\n---\n");
  if (at < 0) throw new Error("The letter file has no --- line.");
  return raw.slice(at + 5).trim();
}

export const TEST_DETAILS: SignerDetails = {
  ...emptyDetails(),
  client_name: "Sevetri Wilson",
  entity_name: "Prosperall Inc.",
  title: "Founder",
  street: "100 Example Street",
  street2: "Suite 4",
  city: "Miami",
  region: "FL",
  postal: "33101",
};

export function fullLetterBlocks(over: { details?: SignerDetails; typedName?: string; dateText?: string } = {}): LetterBlock[] {
  const d = over.details ?? TEST_DETAILS;
  const result = renderLetter(fullLetterBody(), {
    date: over.dateText ?? "November 12, 2026",
    client_name: d.client_name,
    entity_name: d.entity_name || d.client_name,
    address_block: [d.street, d.street2, `${d.city}, ${d.region} ${d.postal}`].filter(Boolean).join("\n"),
    client_email: "sevetri@example.com",
    signer_name: over.typedName ?? d.client_name,
    signed_date: over.dateText ?? "November 12, 2026",
  });
  if (!result.ok) throw new Error("The full letter did not merge.");
  return result.blocks;
}

/** One paragraph as plain text, the way the page and the PDF draw it. */
export function paragraphText(b: LetterBlock): string {
  return b.lead ? `${b.lead} ${b.text}` : b.text;
}

export function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
