import type { OrgModule } from "@/lib/org/modules";
import { ASSISTANTS_NAME } from "@/lib/ui/words";

/**
 * What Settings -> Features says about each feature, in under 15 words each (a test counts). `crm_org.modules` is
 * Lectual's to set; lectual-only modules (inbox, lawmatics-import) aren't listed because this app has no surface behind them.
 */
export const MODULES: ReadonlyArray<{ key: OrgModule; name: string; what: string }> = [
  { key: "mailbox", name: "Mailboxes", what: "Connect Gmail and Outlook, match client mail to leads, and use My Mail." },
  { key: "agents", name: ASSISTANTS_NAME, what: "Assistants that read new leads and draft follow-ups into Approvals." },
  { key: "document-center", name: "Document Center", what: "Generate engagement and opinion letters from your templates, into Approvals." },
  { key: "agent-toolkit", name: "Agent toolkit", what: "Welcome emails and filing follow-ups, written in your firm's voice." },
  { key: "proposals", name: "Client proposals", what: "The trademark proposal clients review and accept after a strategy call." },
  { key: "litigation", name: "Litigation", what: "Litigation matters, with case numbers, hearings and case details." },
];
