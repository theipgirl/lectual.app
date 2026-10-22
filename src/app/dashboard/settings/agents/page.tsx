import { notFound, redirect } from "next/navigation";
import { orgHasModule } from "@/lib/org/modules";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Agents settings") };

/**
 * Agents live on the rail (/dashboard/agents/); this keeps the old Settings
 * tab and any bookmark working. A firm without the module gets a 404, not an
 * explanation. notFound() and redirect() throw, so neither sits in a try/catch.
 */
export default async function SettingsAgentsPage() {
  if (!(await orgHasModule("agents"))) notFound();
  redirect("/dashboard/agents/");
}
