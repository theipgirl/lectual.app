import type { Metadata } from "next";
import { EngagementLetterSettings } from "@/components/loe/EngagementLetterSettings";
import { loadLetterPage } from "@/lib/loe/page-load";
import { pageTitle } from "@/lib/ui/page-title";
import { ENGAGEMENT_LETTER_NAME } from "@/lib/ui/words";
import { requireProposalsModule } from "../../../proposals/gate";
import "../../../proposals/proposals.css";

export const metadata: Metadata = { title: pageTitle(ENGAGEMENT_LETTER_NAME) };

export const dynamic = "force-dynamic";

/**
 * Settings -> Client proposals -> Engagement letter. Every member of a firm with the proposals feature
 * reads the versions; the admin tier writes a draft and a named approver approves it (the actions and
 * lectual 0106's trigger enforce both). A firm without proposals gets `notFound()`, which names nothing.
 */
export default async function EngagementLetterPage() {
  await requireProposalsModule();
  const model = await loadLetterPage();
  return <EngagementLetterSettings model={model} />;
}
