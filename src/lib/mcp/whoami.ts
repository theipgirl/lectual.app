import { roleLabel } from "@/lib/auth/roles";
import type { OrgModule } from "@/lib/org/modules";
import { MODULES } from "@/lib/settings/modules-copy";
import type { OkSession } from "./gate";

/**
 * `whoami`: which firm answered, who you are there, and what is switched on. Pure: the per-feature
 * answers are passed in. The text begins with the firm's name, as every connector result does.
 */
export const WHOAMI_FEATURES: ReadonlyArray<{ key: OrgModule; name: string }> = MODULES.map(({ key, name }) => ({ key, name }));

export function whoamiText(session: OkSession, features: ReadonlyArray<{ name: string; on: boolean }>): string {
  const lines = [
    `${session.org.name}: you are connected as ${session.displayName} (${roleLabel(session.role)}).`,
    "Claude connector: on.",
    ...features.map((f) => `${f.name}: ${f.on ? "on" : "off"}.`),
    "Nothing is sent from Claude. Drafts wait for approval in Lectual.",
  ];
  return lines.join("\n");
}
