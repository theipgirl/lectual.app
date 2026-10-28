import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { INTEGRATIONS_PATH } from "@/lib/setup/routes";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Settings") };

/**
 * The Settings rail link. It always opens Settings (Integrations), for every
 * role. Setup is a tab inside Settings with its own progress; it no longer
 * takes over this link, so an admin whose remaining steps are Lectual's to
 * switch on is never held in the checklist. Nothing is read here.
 */
export default function SettingsIndex() {
  redirect(INTEGRATIONS_PATH);
}
