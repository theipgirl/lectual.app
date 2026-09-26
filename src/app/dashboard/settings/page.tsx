import { redirect } from "next/navigation";
import { orgHasModule } from "@/lib/org/modules";
import { NotBuilt } from "@/components/shell/NotBuilt";

export default async function SettingsIndex() {
  if (await orgHasModule("mailbox")) redirect("/dashboard/settings/integrations/");
  return <NotBuilt label="Settings" step={6} />;
}
