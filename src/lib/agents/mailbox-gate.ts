import type { AgentContext } from "./types";

/**
 * The Mailboxes module, as an agent sees it at run time.
 *
 * Modules fail closed (AGENTS.md): the mailbox-sync cron only runs for firms holding `mailbox`, and
 * every Outlook read on a page sits behind `orgHasModule` for the Mailboxes module. An agent that reads a connected
 * mailbox or the Outlook calendar rows is a read of the same data, so it asks the same question on every
 * run, not only when the Agents page draws its label. The module list rides on the `crm_org` read the
 * runner already makes (`ctx.orgModules`), so there is no extra query and no second definition.
 *
 * Three states, never two: a list that could not be read is not "the module is off" and is not "on".
 * It blocks the same work (fail closed) but with its own words.
 */

/** The one place an agent file names the module. Same string `orgHasModule` and the mailbox-sync cron use. */
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

/**
 * The summary for an agent that cannot write because no queue key was found. When the module list could
 * not be read the whole `crm_org` read failed, so the missing key is not evidence that the firm has no
 * queue: say that the firm's settings could not be read, not that nothing is connected.
 */
export function noQueueSummary(ctx: Pick<AgentContext, "orgModules">, written: string): string {
  if (mailboxModuleState(ctx) === "unreadable") {
    return `Skipped: the firm's settings couldn't be read (${MAILBOX_GATE_REASON.unreadable}), so no approval queue was found and no ${written} was written.`;
  }
  return `No approval queue is connected for this firm, so no ${written} was written.`;
}
