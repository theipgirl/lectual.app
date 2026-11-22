import { renderToStaticMarkup } from "react-dom/server";
import { ProposalDocument, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { TEST_DETAILS } from "../loe/full-letter-fixture";
import { generalWithLoe, twoBrandPerMark, withLoe } from "../loe/loe-fixtures";

/**
 * The letter steps and receipt of the in-app (0106) path, rendered the same way for the baseline (taken from 49efd5e, the
 * Sprint 5a base commit) and for the pin test. `extra` is what the page passes after Sprint 5a (the signing path).
 */
const LETTER = { dateText: "November 12, 2026", clientEmail: "callum@example.com" };

export type PinCase = { name: string; props: Partial<ProposalDocumentProps> };

export const PIN_CASES: PinCase[] = [
  { name: "tm-step1", props: {} },
  { name: "tm-step2", props: { initialLoe: { step: 2, details: TEST_DETAILS } } },
  { name: "tm-step3-empty", props: { initialLoe: { step: 3, details: TEST_DETAILS } } },
  { name: "tm-step3-ready", props: { initialLoe: { step: 3, details: TEST_DETAILS, typedName: "Jordan Sample", agree: true } } },
  {
    name: "tm-receipt",
    props: { initialLoe: { step: 3, details: TEST_DETAILS, typedName: "Jordan Sample", agree: true }, initialDone: { payUrl: "https://example.com/pay", signedLine: "Signed November 12, 2026 at 2:14 PM EST by Jordan Sample", letterDate: "November 12, 2026", letterVerified: true } },
  },
  { name: "general-step3", props: { content: generalWithLoe(), clientName: "Imogen Pellegrino", initialLoe: { step: 3, details: TEST_DETAILS, typedName: "Jordan Sample", agree: true } } },
];

export function renderPin(c: PinCase, extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    <ProposalDocument
      content={withLoe(twoBrandPerMark())}
      title="Trademark Proposal"
      clientName="Callum Ferreira"
      expiresOn="2026-12-01"
      firm={{ name: "RPB Law", slug: "rpb-law" }}
      mode="live"
      letter={LETTER}
      onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })}
      onDownloadReview={async () => ({ ok: false, message: "x" })}
      onDownloadSigned={async () => ({ ok: false, message: "x" })}
      {...c.props}
      {...extra}
    />,
  );
}
