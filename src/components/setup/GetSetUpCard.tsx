import { loadSetupState } from "@/lib/setup/load";
import { setupChecklist } from "@/lib/setup/checklist";
import { canSeeSetup } from "@/lib/setup/roles";
import { todaySetupCard, type SetupReading } from "@/lib/setup/today-card";
import type { SetupChecklist } from "@/lib/setup/types";
import { GettingStartedCard } from "@/components/onboarding/GettingStartedCard";
import { FinishSetupView } from "./FinishSetupCard";

/**
 * The one "get set up" card on Today: the Setup card while the admin tier has items left, otherwise Getting
 * started. It reads setup once (admin tier only); a failed read falls back to Getting started, which still
 * shows its link, so Today never loses the card and never shows two.
 */
export async function GetSetUpCard({ role }: { role: string | null | undefined }) {
  let reading: SetupReading = "unreadable";
  let checklist: SetupChecklist | null = null;
  if (canSeeSetup(role)) {
    try {
      checklist = setupChecklist(await loadSetupState());
      reading = checklist.complete ? "complete" : "items-left";
    } catch {
      reading = "unreadable";
    }
  }
  if (todaySetupCard(role, reading) === "setup" && checklist) return <FinishSetupView checklist={checklist} />;
  return <GettingStartedCard />;
}
