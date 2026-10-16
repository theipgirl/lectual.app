import { redirect } from "next/navigation";

/** Integrations is the only live settings section, and every firm has it. */
export default function SettingsIndex() {
  redirect("/dashboard/settings/integrations/");
}
