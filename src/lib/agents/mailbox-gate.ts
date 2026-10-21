import type { AgentContext } from "./types";

/**
 * The Mailboxes module, as an agent sees it at run time.
 *
 * Modules fail closed (AGENTS.md): the mailbox-sync cron only runs for firms holding `mailbox`, and
 * every Outlook read on a page sits behind `orgHasModule("mailbox")`. An agent that reads a connected
 * mailbox or the Outlook calendar rows is a read of the same data, so it asks the same question on every
 * run, not only when the Agents page draws its label. The module list rides on the `crm_org` read the
 * runner already makes (`ctx.orgModules`), so there is no extra query and no second definition.
 *
 * Three states, never two: a list that could not be read is not "the module is off" and is not "on".
 * It blocks the same work (fail closed) but with its own words.
 */

/** The one place an agent file names the module. Matches `orgHasModule("mailbox")` and the cron. */
export const MAILBOX_MODULE = "mailbox";

export type MailboxModuleState = "on" | "off" | "unreadable";

export function mailboxModuleState(ctx: Pick<AgentContext, "orgModules">): MailboxModuleState {
  const modules = ctx.orgModules;
  if (!Array.isArray(modules)) return "unreadable";
  return modules.includes(MAILBOX_MODULE) ? "on" : "off";
}

/** The reason a run (or a section) gives when the module blocks it. */
export const MAILBOX_GATE_REASON: Record<Exclude<MailboxModuleState, "on">, string> = {
  off: "the Mailboxes module is off",
  unreadable: "couldn't check the Mailboxes module",
};
