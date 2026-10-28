import { canSeeSetup } from "./roles";

/** What the setup reading said: items left, nothing left, or the state could not be read. */
export type SetupReading = "items-left" | "complete" | "unreadable";

/**
 * Today shows exactly ONE "get set up" card. The admin tier gets the Setup card while it has items left;
 * everyone else, and the admin tier once setup is complete or could not be read, gets Getting started
 * (which still draws, without a count, when its own read fails).
 */
export function todaySetupCard(role: string | null | undefined, setup: SetupReading): "setup" | "getting-started" {
  return canSeeSetup(role) && setup === "items-left" ? "setup" : "getting-started";
}
