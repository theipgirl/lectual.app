import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { INTAKE_NAME } from "@/lib/ui/words";
import { pageTitle } from "@/lib/ui/page-title";
import { intakeListHref } from "@/lib/intake/list-href";

export const metadata: Metadata = { title: pageTitle(INTAKE_NAME) };

/**
 * The lead list is Intake now (/dashboard/intake/: table, board by stage,
 * board by owner). A lead's own page stays at /dashboard/leads/[id]. Old
 * links and bookmarks keep working: `stage` and `q` mean the same thing
 * on Intake, so they are carried across.
 */
export default async function LeadsRedirect({ searchParams }: { searchParams: Promise<{ stage?: string; q?: string }> }) {
  const { stage, q } = await searchParams;
  const params = new URLSearchParams();
  if (stage) params.set("stage", stage);
  if (q) params.set("q", q);
  const query = params.toString();
  redirect(intakeListHref(query));
}
