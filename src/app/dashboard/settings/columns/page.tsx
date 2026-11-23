import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { currentRole } from "@/lib/auth/current-role";
import { getScopedClient } from "@/lib/db/scoped-client";
import { canSeeSetup } from "@/lib/setup/roles";
import { pageTitle } from "@/lib/ui/page-title";
import { COLUMNS_SETTINGS_NAME, COLUMNS_SETTINGS_SUB } from "@/lib/ui/words";
import { PageHeader } from "@/components/ui/PageHeader";
import { loadColumnsSettings, type ColumnsSettingsState } from "@/lib/custom-columns/settings-load";
import { ColumnsSettings } from "@/components/settings/ColumnsSettings";

export const metadata: Metadata = { title: pageTitle(COLUMNS_SETTINGS_NAME) };

export const dynamic = "force-dynamic";

/**
 * Settings -> Columns: the firm's own columns on the Weekly review List. The admin tier only (owner, admin, senior_admin); anyone else,
 * an unreadable role and a signed-out caller get notFound. Every action behind it re-checks the role itself.
 */
export default async function ColumnsSettingsPage() {
  if (!canSeeSetup(await currentRole())) notFound();
  let state: ColumnsSettingsState;
  try {
    state = await loadColumnsSettings(await getScopedClient());
  } catch {
    state = { status: "unavailable" };
  }
  return (
    <>
      <PageHeader title={COLUMNS_SETTINGS_NAME} sub={COLUMNS_SETTINGS_SUB} tour="columns-head" />
      <ColumnsSettings state={state} />
    </>
  );
}
